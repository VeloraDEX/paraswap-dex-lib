import { Interface, defaultAbiCoder } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Address, BlockHeader, Log, Logger, Token } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import MaverickV2PoolABI from '../../abi/maverick-v2/MaverickV2Pool.json';
import MaverickV2PoolLensABI from '../../abi/maverick-v2/MaverickV2PoolLens.json';
import { MaverickPoolMath } from './maverick-math/maverick-pool-math';
import { MultiResult } from '../../lib/multi-wrapper';
import { BytesLike } from 'ethers';
import { extractSuccessAndValue } from '../../lib/decoders';
import { getTopicLogDecoder } from '../../lib/topic-log-decoder';

const BINS_PER_LENS_CALL = 5000n;

export const decodeMaverickFullState = (
  result: MultiResult<BytesLike> | BytesLike,
) => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    throw new Error('Could not extract value from struct TODO.');
  }

  const decoded = defaultAbiCoder.decode(
    [
      `
      tuple(
        tuple(
          uint128 reserveA,
          uint128 reserveB,
          uint128 totalSupply,
          uint32[4] binIdsByTick
        )[] tickStateMapping,
        tuple(
          uint128 mergeBinBalance,
          uint128 tickBalance,
          uint128 totalSupply,
          uint8 kind,
          int32 tick,
          uint32 mergeId
        )[] binStateMapping,
        tuple(
          uint128[4] values
        )[] binIdByTickKindMapping,
        tuple(
          uint128 reserveA,
          uint128 reserveB,
          int64 lastTwaD8,
          int64 lastLogPriceD8,
          uint40 lastTimestamp,
          int32 activeTick,
          bool isLocked,
          uint32 binCounter,
          uint8 protocolFeeRatioD3
        ) state,
        tuple(uint256 amountA, uint256 amountB) protocolFees
      ) poolState
    `,
    ],
    toDecode,
  );
  return decoded[0];
};

export class MaverickV2EventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
      blockHeader: BlockHeader,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  poolMath: MaverickPoolMath;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public tokenA: Token,
    public tokenB: Token,
    public feeAIn: bigint,
    public feeBIn: bigint,
    public tickSpacing: bigint,
    public lookback: bigint,
    public activeTick: bigint,
    public address: Address,
    public poolLensAddress: Address,
    protected maverickV2Iface = new Interface(MaverickV2PoolABI),
    protected maverickV2LensIface = new Interface(MaverickV2PoolLensABI),
  ) {
    const name = `${parentName.toLowerCase()}-${tokenA.symbol}-${
      tokenB.symbol
    }-${address.toLowerCase()}-${feeAIn}-${feeBIn}-${tickSpacing}-${lookback}`;

    super(parentName, name, dexHelper, logger);

    // TODO: make logDecoder decode logs that
    this.logDecoder = (log: Log) =>
      getTopicLogDecoder(this.maverickV2Iface).decode(log);
    this.addressesSubscribed = [address];

    // Add handlers
    this.handlers['PoolAddLiquidity'] = this.handleAddLiquidityEvent.bind(this);
    this.handlers['PoolRemoveLiquidity'] =
      this.handleRemoveLiquidityEvent.bind(this);
    this.handlers['PoolSwap'] = this.handleSwapEvent.bind(this);
    this.handlers['PoolSetVariableFee'] =
      this.handleSetVariableFeeEvent.bind(this);
    this.handlers['PoolSetProtocolFeeRatio'] =
      this.handleSetProtocolFeeRatioEvent.bind(this);

    this.poolMath = new MaverickPoolMath(
      BigInt(lookback),
      BigInt(tickSpacing),
      BigInt(activeTick),
      BigInt(tokenA.decimals),
      BigInt(tokenB.decimals),
    );
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log, blockHeader);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */

  private lensCall(binStart: bigint) {
    return {
      target: this.poolLensAddress,
      callData: this.maverickV2LensIface.encodeFunctionData(
        'getFullPoolState',
        [this.address, binStart, binStart + BINS_PER_LENS_CALL - 1n],
      ),
      decodeFunction: (data: MultiResult<BytesLike> | BytesLike) => {
        const [, returnData] = extractSuccessAndValue(data);
        return returnData === '0x' ? null : decodeMaverickFullState(returnData);
      },
    };
  }

  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    // Pool params and the first page of bins in one round-trip; only pools
    // with more than BINS_PER_LENS_CALL bins need a second one
    const [stateResult, feeAInResult, feeBInResult, firstLensPage] =
      await this.dexHelper.multiWrapper.tryAggregate<any>(
        false,
        [
          {
            target: this.address,
            callData: this.maverickV2Iface.encodeFunctionData('getState'),
            decodeFunction: (data: MultiResult<BytesLike> | BytesLike) => {
              const [, returnData] = extractSuccessAndValue(data);
              return returnData === '0x'
                ? null
                : this.maverickV2Iface.decodeFunctionResult(
                    'getState',
                    returnData,
                  )[0];
            },
          },
          ...[true, false].map(tokenAIn => ({
            target: this.address,
            callData: this.maverickV2Iface.encodeFunctionData('fee', [
              tokenAIn,
            ]),
            decodeFunction: (data: MultiResult<BytesLike> | BytesLike) => {
              const [, returnData] = extractSuccessAndValue(data);
              return returnData === '0x'
                ? null
                : BigInt(
                    this.maverickV2Iface
                      .decodeFunctionResult('fee', returnData)[0]
                      .toString(),
                  );
            },
          })),
          this.lensCall(0n),
        ],
        blockNumber,
        undefined,
        false,
      );

    // The pool is not deployed yet at this block (call fails or returns no
    // data): empty state with the creation parameters, so that logs from the
    // creation block replay
    if (!stateResult.success || stateResult.returnData == null) {
      return {
        activeTick: BigInt(this.activeTick),
        binCounter: 0n,
        reserveA: 0n,
        reserveB: 0n,
        lastTwaD8: 0n,
        lastLogPriceD8: 0n,
        lastTimestamp: 0n,
        feeAIn: BigInt(this.feeAIn),
        feeBIn: BigInt(this.feeBIn),
        protocolFeeRatioD3: 0n,
        bins: {},
        ticks: {},
      };
    }

    const poolContractState = stateResult.returnData;
    const poolState: PoolState = {
      activeTick: BigInt(poolContractState.activeTick),
      binCounter: BigInt(poolContractState.binCounter),
      reserveA: BigInt(poolContractState.reserveA.toString()),
      reserveB: BigInt(poolContractState.reserveB.toString()),
      lastTwaD8: BigInt(poolContractState.lastTwaD8.toString()),
      lastLogPriceD8: BigInt(poolContractState.lastLogPriceD8.toString()),
      lastTimestamp: BigInt(poolContractState.lastTimestamp),
      protocolFeeRatioD3: BigInt(poolContractState.protocolFeeRatioD3),
      feeAIn: feeAInResult.returnData,
      feeBIn: feeBInResult.returnData,
      bins: {},
      ticks: {},
    };

    const poolLensStates = [firstLensPage.returnData];

    const calls = [];
    for (
      let binStart = BINS_PER_LENS_CALL;
      binStart <= poolState.binCounter;
      binStart += BINS_PER_LENS_CALL
    ) {
      calls.push(this.lensCall(binStart));
    }
    if (calls.length) {
      poolLensStates.push(
        ...(await this.dexHelper.multiWrapper.aggregate<any>(
          calls,
          blockNumber,
        )),
      );
    }

    // The lens returns arrays indexed relative to binStart, not by bin id
    poolLensStates.forEach((poolLensState, page) => {
      const binStart = BigInt(page) * BINS_PER_LENS_CALL;

      poolLensState.binStateMapping.forEach((bin: any, i: number) => {
        const binId = binStart + BigInt(i);
        if (binId === 0n) return;

        const tick = poolLensState.tickStateMapping[i];
        const tickKey = bin.tick.toString();

        poolState.bins[binId.toString()] = {
          mergeBinBalance: BigInt(bin.mergeBinBalance),
          mergeId: BigInt(bin.mergeId),
          totalSupply: BigInt(bin.totalSupply),
          kind: BigInt(bin.kind),
          tick: BigInt(bin.tick),
          tickBalance: BigInt(bin.tickBalance),
        };

        poolState.ticks[tickKey] = {
          reserveA: BigInt(tick.reserveA),
          reserveB: BigInt(tick.reserveB),
          totalSupply: BigInt(tick.totalSupply),
          binIdsByTick: {},
        };

        tick.binIdsByTick.forEach((id: any, kind: number) => {
          const tickBinId = BigInt(id.toString());
          if (tickBinId !== 0n) {
            poolState.ticks[tickKey].binIdsByTick[kind.toString()] = tickBinId;
          }
        });
      });
    });

    return poolState;
  }

  handleSetVariableFeeEvent(event: any, state: PoolState) {
    state.feeAIn = BigInt(event.args.newFeeAIn.toString());
    state.feeBIn = BigInt(event.args.newFeeBIn.toString());
    return state;
  }

  handleSetProtocolFeeRatioEvent(event: any, state: PoolState) {
    state.protocolFeeRatioD3 = BigInt(event.args.protocolFeeRatioD3.toString());
    return state;
  }

  handleRemoveLiquidityEvent(
    event: any,
    state: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const blockTimestamp = BigInt(blockHeader.timestamp);
    this.poolMath.removeLiquidity(state, blockTimestamp, {
      binIds: event.args.params.binIds.map((id: any) => BigInt(id)),
      amounts: event.args.params.amounts.map((amount: any) => BigInt(amount)),
    });
    return state;
  }

  handleAddLiquidityEvent(
    event: any,
    state: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const blockTimestamp = BigInt(blockHeader.timestamp);
    this.poolMath.addLiquidity(state, blockTimestamp, {
      ticks: event.args.params.ticks.map((amount: any) => BigInt(amount)),
      amounts: event.args.params.amounts.map((amount: any) => BigInt(amount)),
      kind: BigInt(event.args.params.kind),
    });
    return state;
  }

  handleSwapEvent(
    event: any,
    state: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const blockTimestamp = BigInt(blockHeader.timestamp);
    this.poolMath.swap(
      state,
      blockTimestamp,
      BigInt(event.args.params.amount),
      event.args.params.tokenAIn,
      event.args.params.exactOutput,
      BigInt(event.args.params.tickLimit),
    );
    return state;
  }

  swap(
    amount: bigint,
    from: Token,
    to: Token,
    exactOutput: boolean,
  ): [bigint, bigint] {
    try {
      const s = this.state!;
      // Copy-on-write overlay: estimateSwap only reads ticks by key and
      // replaces the ones it touches, so a prototype-chained object avoids
      // copying the whole ticks map on every quote. The estimate path must
      // never iterate or delete ticks for this to stay correct.
      const tempState: PoolState = {
        ...s,
        ticks: Object.create(s.ticks),
      };

      const preActiveTick = tempState.activeTick;

      const [amountIn, amountOut] = this.poolMath.estimateSwap(
        tempState,
        amount,
        from.address.toLowerCase() === this.tokenA.address.toLowerCase(),
        exactOutput,
        from.address.toLowerCase() === this.tokenA.address.toLowerCase()
          ? tempState.activeTick + 100n
          : tempState.activeTick - 100n,
      );

      if (exactOutput && amountOut < amount) {
        return [0n, 0n];
      }

      if (amountIn === 0n && amountOut === 0n) {
        this.logger.trace(
          `Reached max swap iteration calculation for address=${this.address} amount=${amount}, from=${from.address}, to=${to.address}, exactOutput=${exactOutput}`,
        );
        return [0n, 0n];
      }

      const postActiveTick = tempState.activeTick;
      const tickDiff = Math.abs(Number(postActiveTick) - Number(preActiveTick));

      return [
        exactOutput ? amountIn : amountOut,
        // Tick calculation must be started from 1 to account at least one tick
        BigInt(tickDiff + 1),
      ];
    } catch (e) {
      this.logger.debug(
        `Failed to calculate swap for address=${this.address} amount=${amount}, from=${from.address}, to=${to.address}, exactOutput=${exactOutput} math: ${e}`,
      );
      return [0n, 0n];
    }
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolState> | null> {
    const state = this.getState(blockNumber);
    if (state) {
      return state;
    }

    this.logger.error(
      `No state found for ${this.name} ${this.addressesSubscribed[0]}, generating new one`,
    );
    const newState = await this.generateState(blockNumber);

    if (!newState) {
      this.logger.error(
        `Could not generate state for ${this.name} ${this.addressesSubscribed[0]}`,
      );
      return null;
    }
    this.setState(newState, blockNumber);
    return newState;
  }
}
