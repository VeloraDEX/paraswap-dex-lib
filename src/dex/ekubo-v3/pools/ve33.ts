import { Result } from '@ethersproject/abi';
import { BigNumber } from 'ethers';
import { hexDataSlice } from 'ethers/lib/utils';
import { DeepReadonly } from 'ts-essentials';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { Logger } from '../../../types';
import { BasicQuoteData, EkuboContracts } from '../types';
import {
  ConcentratedPoolBase,
  ConcentratedPoolState,
  quoteConcentrated,
} from './concentrated';
import {
  FullRangePoolBase,
  FullRangePoolState,
  quoteFullRange,
} from './full-range';
import { amountBeforeFee, computeFee } from './math/swap';
import { NamedEventHandlers, Quote } from './pool';
import {
  quoteStableswap,
  StableswapPoolBase,
  computeStableswapBounds,
} from './stableswap';
import {
  ConcentratedPoolTypeConfig,
  PoolKey,
  StableswapPoolTypeConfig,
  SwappedEvent,
} from './utils';

const EXTRA_BASE_GAS_COST_OF_ONE_VE33_SWAP = 30_000;

export type Ve33PoolState<S> = S & { swapFee: bigint };

export function quoteVe33<S extends object>(
  quote: Quote<S>,
  amount: bigint,
  swapFee: bigint,
): Quote<S & { swapFee: bigint }> {
  const statefulQuote = quote as Quote<S> & { stateAfter: S };
  let calculatedAmount = quote.calculatedAmount;

  if (swapFee !== 0n && calculatedAmount !== 0n) {
    if (amount >= 0n) {
      calculatedAmount -= computeFee(calculatedAmount, swapFee);
    } else {
      calculatedAmount = amountBeforeFee(calculatedAmount, swapFee);
    }
  }

  return {
    ...statefulQuote,
    calculatedAmount,
    gasConsumed: quote.gasConsumed + EXTRA_BASE_GAS_COST_OF_ONE_VE33_SWAP,
    stateAfter: { ...statefulQuote.stateAfter, swapFee },
  } as Quote<S & { swapFee: bigint }>;
}

function ve33EventHandlers<S extends { swapFee: bigint }>(
  contracts: EkuboContracts,
  key: PoolKey<any>,
): Record<string, NamedEventHandlers<S>> {
  const { contract, interface: iface } = contracts.ve33;

  return {
    [contract.address]: new NamedEventHandlers(iface, {
      VoteWeightApplied: (args, oldState) =>
        BigInt(args.poolId) === key.numId
          ? { ...oldState, swapFee: args.swapFee.toBigInt() }
          : null,
    }),
  };
}

async function fetchVe33State(
  contracts: EkuboContracts,
  key: PoolKey<any>,
  tickSpacings: number,
  blockNumber?: number | 'latest',
): Promise<[BasicQuoteData, bigint]> {
  const [quoteData, swapFees] = await Promise.all([
    contracts.core.quoteDataFetcher.getQuoteData([key.toAbi()], tickSpacings, {
      blockTag: blockNumber,
    }) as Promise<BasicQuoteData[]>,
    contracts.ve33.quoteDataFetcher.getPoolSwapFees([key.numId], {
      blockTag: blockNumber,
    }) as Promise<BigNumber[]>,
  ]);

  return [quoteData[0], swapFees[0].toBigInt()];
}

export class Ve33FullRangePool extends FullRangePoolBase<
  Ve33PoolState<FullRangePoolState.Object>
> {
  private readonly ve33Contracts: EkuboContracts;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<StableswapPoolTypeConfig>,
  ) {
    super(
      parentName,
      dexHelper,
      logger,
      contracts,
      initBlockNumber,
      key,
      ve33EventHandlers(contracts, key),
    );
    this.ve33Contracts = contracts;
  }

  public override async generateState(
    blockNumber?: number | 'latest',
  ): Promise<DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>> {
    const [data, swapFee] = await fetchVe33State(
      this.ve33Contracts,
      this.key,
      0,
      blockNumber,
    );
    return { ...FullRangePoolState.fromQuoter(data), swapFee };
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>,
    sqrtRatioLimit?: bigint,
  ) {
    return quoteVe33(
      quoteFullRange(this.key, amount, isToken1, state, sqrtRatioLimit),
      amount,
      state.swapFee,
    );
  }

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>,
  ) {
    const state = FullRangePoolState.fromPositionUpdatedEvent(
      oldState,
      args.liquidityDelta.toBigInt(),
    );
    return state === null ? null : { ...state, swapFee: oldState.swapFee };
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    oldState: DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>,
  ) {
    return {
      ...FullRangePoolState.fromSwappedEvent(ev),
      swapFee: oldState.swapFee,
    };
  }
}

export class Ve33StableswapPool extends StableswapPoolBase<
  Ve33PoolState<FullRangePoolState.Object>
> {
  private readonly ve33Contracts: EkuboContracts;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<StableswapPoolTypeConfig>,
  ) {
    super(
      parentName,
      dexHelper,
      logger,
      contracts,
      initBlockNumber,
      key,
      ve33EventHandlers(contracts, key),
    );
    this.ve33Contracts = contracts;
  }

  public override async generateState(blockNumber?: number | 'latest') {
    const [data, swapFee] = await fetchVe33State(
      this.ve33Contracts,
      this.key,
      0,
      blockNumber,
    );
    return { ...FullRangePoolState.fromQuoter(data), swapFee };
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>,
    sqrtRatioLimit?: bigint,
  ) {
    return quoteVe33(
      quoteStableswap(
        this.key.config.fee,
        computeStableswapBounds(this.key.config.poolTypeConfig),
        amount,
        isToken1,
        state,
        sqrtRatioLimit,
      ),
      amount,
      state.swapFee,
    );
  }

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>,
  ) {
    const state = FullRangePoolState.fromPositionUpdatedEvent(
      oldState,
      args.liquidityDelta.toBigInt(),
    );
    return state === null ? null : { ...state, swapFee: oldState.swapFee };
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    oldState: DeepReadonly<Ve33PoolState<FullRangePoolState.Object>>,
  ) {
    return {
      ...FullRangePoolState.fromSwappedEvent(ev),
      swapFee: oldState.swapFee,
    };
  }
}

export class Ve33ConcentratedPool extends ConcentratedPoolBase<
  Ve33PoolState<ConcentratedPoolState.Object>
> {
  private readonly ve33Contracts: EkuboContracts;

  public constructor(
    parentName: string,
    dexHelper: IDexHelper,
    logger: Logger,
    contracts: EkuboContracts,
    initBlockNumber: number,
    key: PoolKey<ConcentratedPoolTypeConfig>,
  ) {
    super(
      parentName,
      dexHelper,
      logger,
      contracts,
      initBlockNumber,
      key,
      ve33EventHandlers(contracts, key),
    );
    this.ve33Contracts = contracts;
  }

  public override async generateState(blockNumber?: number | 'latest') {
    const [data, swapFee] = await fetchVe33State(
      this.ve33Contracts,
      this.key,
      10,
      blockNumber,
    );
    return { ...ConcentratedPoolState.fromQuoter(data), swapFee };
  }

  protected override _quote(
    amount: bigint,
    isToken1: boolean,
    state: DeepReadonly<Ve33PoolState<ConcentratedPoolState.Object>>,
    sqrtRatioLimit?: bigint,
  ) {
    return quoteVe33(
      quoteConcentrated(this.key, amount, isToken1, state, sqrtRatioLimit),
      amount,
      state.swapFee,
    );
  }

  protected override handlePositionUpdated(
    args: Result,
    oldState: DeepReadonly<Ve33PoolState<ConcentratedPoolState.Object>>,
  ) {
    const state = ConcentratedPoolState.fromPositionUpdatedEvent(
      oldState,
      [
        BigNumber.from(hexDataSlice(args.positionId, 24, 28))
          .fromTwos(32)
          .toNumber(),
        BigNumber.from(hexDataSlice(args.positionId, 28, 32))
          .fromTwos(32)
          .toNumber(),
      ],
      args.liquidityDelta.toBigInt(),
    );
    return state === null ? null : { ...state, swapFee: oldState.swapFee };
  }

  protected override handleSwappedEvent(
    ev: SwappedEvent,
    oldState: DeepReadonly<Ve33PoolState<ConcentratedPoolState.Object>>,
  ) {
    return {
      ...ConcentratedPoolState.fromSwappedEvent(oldState, ev),
      swapFee: oldState.swapFee,
    };
  }
}
