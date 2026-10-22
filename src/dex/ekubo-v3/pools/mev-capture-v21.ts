import { Interface, Result } from '@ethersproject/abi';
import { hexZeroPad, hexlify } from 'ethers/lib/utils';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { BlockHeader, Log, Logger } from '../../../types';
import { EkuboSupportedNetwork } from '../config';
import { BasicQuoteData, EkuboContracts } from '../types';
import { ConcentratedPoolState } from './concentrated';
import { MevCaptureV21QuoteError } from './math/mev-capture-v21-core';
import {
  MevCaptureV21Anchor,
  MevCaptureV21Config,
  MevCaptureV21PoolModel,
  MevCaptureV21Resources,
  validateMevCaptureV21Config,
} from './math/mev-capture-v21';
import { floatSqrtRatioToFixed } from './math/sqrt-ratio';
import { EkuboPool, Quote } from './pool';
import { estimatedCurrentTime } from './timed';
import { ConcentratedPoolTypeConfig, PoolKey, SwappedEvent } from './utils';

import MevCaptureV21ABI from '../../../abi/ekubo-v3/mev-capture-v21.json';
import MultiV2ABI from '../../../abi/multi-v2.json';

// Gas of one forwarded swap, in the convention of the other pools here (the
// marginal gas of the pool inside the router call). Fitted by Ekubo's quoter
// on forge against the deployed configuration: a forwarded swap pays the
// Core swap overhead, a cold access to the extension and the extension's own
// base cost, plus per Core call, per extra Core swap step, per initialized
// tick crossed, per `accumulateAsFees` and once per timestamp for the anchor
// update and its state write.
const BASE_GAS_COST_OF_ONE_MEV_CAPTURE_V21_SWAP = 7_900 + 2_500 + 8_250;
const GAS_COST_OF_ONE_MEV_CAPTURE_V21_CORE_CALL = 12_350;
const GAS_COST_OF_ONE_MEV_CAPTURE_V21_EXTRA_CORE_STEP = 2_850;
const GAS_COST_OF_ONE_MEV_CAPTURE_V21_TICK_CROSSED = 13_150;
const GAS_COST_OF_ONE_MEV_CAPTURE_V21_FEE_ACCUMULATION = 7_950;
const GAS_COST_OF_MEV_CAPTURE_V21_ANCHOR_UPDATE = 4_650;

// Same window as the other concentrated pools' `generateState`
const BITMAPS_SEARCHED = 10;

const mevCaptureV21Iface = new Interface(MevCaptureV21ABI);
const multiV2Iface = new Interface(MultiV2ABI);

export function mevCaptureV21GasCost(r: MevCaptureV21Resources): number {
  return (
    BASE_GAS_COST_OF_ONE_MEV_CAPTURE_V21_SWAP +
    GAS_COST_OF_ONE_MEV_CAPTURE_V21_CORE_CALL * r.coreCalls +
    GAS_COST_OF_ONE_MEV_CAPTURE_V21_EXTRA_CORE_STEP *
      Math.max(0, r.coreSteps - r.coreCalls) +
    GAS_COST_OF_ONE_MEV_CAPTURE_V21_TICK_CROSSED * r.initializedTicksCrossed +
    GAS_COST_OF_ONE_MEV_CAPTURE_V21_FEE_ACCUMULATION * r.accumulateAsFees +
    GAS_COST_OF_MEV_CAPTURE_V21_ANCHOR_UPDATE * r.anchorUpdates
  );
}

/**
 * A concentrated pool of the MEVCapture v2.1 extension. Swaps are only
 * possible through `Core.forward(extension, ...)`, which splits them into
 * several Core swaps and charges a surcharge that grows with the distance from
 * an anchor price. The anchor lives in the extension's storage and changes on
 * the first swap of each block timestamp and on position updates without an
 * event of its own, so the whole state (Core price, initialized ticks, anchor
 * and configuration) is re-read in one multicall at the end of every block in
 * which Core emitted an event for the pool.
 */
export class MevCaptureV21Pool extends EkuboPool<
  ConcentratedPoolTypeConfig,
  MevCaptureV21PoolState.Object
> {
  private readonly quoteDataFetcher;
  private readonly chainId: EkuboSupportedNetwork;
  private readonly extension: string;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<ConcentratedPoolTypeConfig>,
  ) {
    const {
      contract: { address },
      interface: iface,
      quoteDataFetcher,
    } = contracts.core;

    super(parentName, dexHelper, logger, initBlockNumber, key, address, iface);

    this.quoteDataFetcher = quoteDataFetcher;
    this.chainId = dexHelper.config.data.network;
    this.extension = hexZeroPad(hexlify(key.config.extension), 20);
  }

  public override async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<MevCaptureV21PoolState.Object>> {
    const fetcher = this.quoteDataFetcher;
    const poolId = hexZeroPad(hexlify(this.key.numId), 32);

    const [quoteData, anchor, config, timestamp] =
      await this.dexHelper.multiWrapper.aggregate<any>(
        [
          {
            target: fetcher.address,
            callData: fetcher.interface.encodeFunctionData('getQuoteData', [
              [this.key.toAbi()],
              BITMAPS_SEARCHED,
            ]),
            decodeFunction: (result: any): BasicQuoteData =>
              fetcher.interface.decodeFunctionResult('getQuoteData', result)
                .results[0],
          },
          {
            target: this.extension,
            callData: mevCaptureV21Iface.encodeFunctionData('getAnchor', [
              poolId,
            ]),
            decodeFunction: (result: any): Result =>
              mevCaptureV21Iface.decodeFunctionResult('getAnchor', result),
          },
          {
            target: this.extension,
            callData: mevCaptureV21Iface.encodeFunctionData('getConfig'),
            decodeFunction: (result: any): Result =>
              mevCaptureV21Iface.decodeFunctionResult('getConfig', result)[0],
          },
          {
            target: this.dexHelper.config.data.multicallV2Address,
            callData: multiV2Iface.encodeFunctionData(
              'getCurrentBlockTimestamp',
            ),
            decodeFunction: (result: any): number =>
              multiV2Iface
                .decodeFunctionResult('getCurrentBlockTimestamp', result)[0]
                .toNumber(),
          },
        ],
        blockNumber,
      );

    return MevCaptureV21PoolState.fromQuoter(
      quoteData,
      MevCaptureV21PoolState.anchorFromAbi(anchor),
      MevCaptureV21PoolState.configFromAbi(config),
      timestamp,
    );
  }

  // Every Core event of the pool can change the extension's anchor, which has
  // no event, so the state is read again at the end of the block.
  protected override async processBlockLogs(
    _state: DeepReadonly<MevCaptureV21PoolState.Object>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<MevCaptureV21PoolState.Object> | null> {
    if (logs.length === 0) return null;
    return this.generateState(blockHeader.number);
  }

  /**
   * Quotes a forwarded swap as the first swap of the next block: the anchor
   * update runs at the estimated next block timestamp (at least one slot after
   * the block the state was read at, see `estimatedCurrentTime`).
   */
  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<MevCaptureV21PoolState.Object>,
  ): Quote {
    return quoteMevCaptureV21(
      this.key,
      amount,
      isToken1,
      state,
      Number(estimatedCurrentTime(BigInt(state.blockTimestamp), this.chainId)),
    );
  }

  protected override _computeTvl(
    state: DeepReadonly<MevCaptureV21PoolState.Object>,
  ): [bigint, bigint] {
    return [state.tvl[0], state.tvl[1]];
  }

  // Unused: `processBlockLogs` re-reads the state instead of applying events.
  protected override handlePositionUpdated(): null {
    return null;
  }

  protected override handleSwappedEvent(
    _ev: SwappedEvent,
  ): DeepReadonly<MevCaptureV21PoolState.Object> | null {
    return null;
  }
}

export function quoteMevCaptureV21(
  key: PoolKey<ConcentratedPoolTypeConfig>,
  amount: bigint,
  isToken1: boolean,
  state: DeepReadonly<MevCaptureV21PoolState.Object>,
  now: number,
): Quote & { resources?: MevCaptureV21Resources } {
  const pool = new MevCaptureV21PoolModel(
    state.config,
    key.config.fee,
    key.config.poolTypeConfig.tickSpacing,
    state.sortedTicks,
    state.checkedTicksBounds,
  );

  let swap;
  try {
    swap = pool.simulateSwap(
      {
        sqrtRatio: state.sqrtRatio,
        tick: state.tick,
        liquidity: state.liquidity,
      },
      state.anchor,
      { isToken1, amount },
      now,
    );
  } catch (err) {
    // Not enough known ticks to quote exactly: report nothing as filled.
    if (
      err instanceof MevCaptureV21QuoteError &&
      err.code === 'TickRangeExceeded'
    ) {
      return {
        consumedAmount: 0n,
        calculatedAmount: 0n,
        gasConsumed: 0,
        skipAhead: 0,
      };
    }
    throw err;
  }

  const [specified, calculated] = isToken1
    ? [swap.delta1, swap.delta0]
    : [swap.delta0, swap.delta1];

  return {
    consumedAmount: specified,
    calculatedAmount: calculated < 0n ? -calculated : calculated,
    gasConsumed: mevCaptureV21GasCost(swap.resources),
    // the extension's calls are cut at Core's tick events assuming no skip-ahead
    skipAhead: 0,
    resources: swap.resources,
  };
}

export namespace MevCaptureV21PoolState {
  export type Object = {
    sqrtRatio: bigint;
    tick: number;
    liquidity: bigint;
    // Every initialized tick within `checkedTicksBounds`, including ones whose
    // net liquidity delta is zero
    sortedTicks: { number: number; liquidityDelta: bigint }[];
    checkedTicksBounds: [number, number];
    config: MevCaptureV21Config;
    anchor: MevCaptureV21Anchor;
    // Timestamp of the block the state was read at
    blockTimestamp: number;
    tvl: [bigint, bigint];
  };

  export function anchorFromAbi(r: Result): MevCaptureV21Anchor {
    return {
      lastUpdateTime: Number(r.lastUpdateTime),
      lRefTime: Number(r.lRefTime),
      lastPosTime: Number(r.lastPosTime),
      lRefBits: Number(r.lRefBits),
      snapBits: Number(r.snapBits),
      lRefRaiseTime: Number(r.lRefRaiseTime),
      anchorX16: BigInt(r.anchorX16.toString()),
    };
  }

  export function configFromAbi(r: Result): MevCaptureV21Config {
    const config = validateMevCaptureV21Config({
      halfLife: Number(r.halfLife),
      slopeK: Number(r.slopeK),
      segmentExp: Number(r.segmentExp),
      jLin: Number(r.jLin),
      maxFee: BigInt(r.maxFee.toString()),
      clampTicks: Number(r.clampTicks),
      mGate: Number(r.mGate),
    });
    if (Number(r.segmentWidthMultiplier) !== 2 ** config.segmentExp) {
      throw new Error('MEVCaptureV21: unexpected segment width multiplier');
    }
    return config;
  }

  export function fromQuoter(
    data: BasicQuoteData,
    anchor: MevCaptureV21Anchor,
    config: MevCaptureV21Config,
    blockTimestamp: number,
  ): Object {
    return {
      sqrtRatio: floatSqrtRatioToFixed(data.sqrtRatio.toBigInt()),
      tick: data.tick,
      liquidity: data.liquidity.toBigInt(),
      sortedTicks: data.ticks.map(({ number, liquidityDelta }) => ({
        number,
        liquidityDelta: liquidityDelta.toBigInt(),
      })),
      checkedTicksBounds: [data.minTick, data.maxTick],
      config,
      anchor,
      blockTimestamp,
      tvl: ConcentratedPoolState.computeTvl(
        ConcentratedPoolState.fromQuoter(data),
      ),
    };
  }
}
