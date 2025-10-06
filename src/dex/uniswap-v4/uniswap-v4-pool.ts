import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import {
  DexParams,
  FeeGrowthGlobals,
  PoolPairsInfo,
  PoolState,
  Slot0,
  SubgraphTick,
  TickInfo,
} from './types';
import { IDexHelper } from '../../dex-helper';
import { Log, Logger } from '../../types';
import { BytesLike, Interface } from 'ethers/lib/utils';
import UniswapV4StateViewABI from '../../abi/uniswap-v4/state-view.abi.json';
import UniswapV4PoolManagerABI from '../../abi/uniswap-v4/pool-manager.abi.json';
import UniswapV4StateMulticallABI from '../../abi/uniswap-v4/state-multicall.abi.json';
import { BlockHeader } from 'web3-eth';
import { DeepReadonly } from 'ts-essentials';
import _ from 'lodash';
import { catchParseLogError } from '../../utils';
import { uniswapV4PoolMath } from './contract-math/uniswap-v4-pool-math';
import {
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_TO_USE_BY_CHAIN,
} from './constants';
import { TickBitMap } from './contract-math/TickBitMap';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { NumberAsString } from '@paraswap/core';
import { extractSuccessAndValue, uint256ToBigInt } from '../../lib/decoders';
import { LPFeeLibrary } from './contract-math/LPFeeLibrary';
import { queryTicksForPool } from './subgraph';

export class UniswapV4Pool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      pool: PoolState,
      log: Log,
      blockHeader: Readonly<BlockHeader>,
    ) => PoolState;
  } = {};

  logDecoder: (log: Log) => any;

  stateViewIface: Interface;

  poolManagerIface: Interface;

  stateMulticallIface: Interface;

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    private readonly network: number,
    private readonly config: DexParams,
    protected logger: Logger,
    mapKey: string = '',
    public readonly poolId: string,
    public readonly token0: string,
    public readonly token1: string,
    public readonly fee: string,
    public readonly hooks: string,
    // TODO: can be removed after state generation would become Multicall only
    public sqrtPriceX96: bigint,
    // TODO: can be removed after state generation would become Multicall only
    public tick: string,
    public tickSpacing: string,
  ) {
    super(parentName, poolId, dexHelper, logger, true, mapKey);

    this.stateViewIface = new Interface(UniswapV4StateViewABI);
    this.poolManagerIface = new Interface(UniswapV4PoolManagerABI);
    this.stateMulticallIface = new Interface(UniswapV4StateMulticallABI);

    this.addressesSubscribed = [this.config.poolManager];

    this.logDecoder = (log: Log) => this.poolManagerIface.parseLog(log);

    // Add handlers
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);
    this.handlers['Donate'] = this.handleDonateEvent.bind(this);
    this.handlers['ProtocolFeeUpdated'] =
      this.handleProtocolFeeUpdatedEvent.bind(this);
    this.handlers['ModifyLiquidity'] =
      this.handleModifyLiquidityEvent.bind(this);
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<PoolState>,
  ) {
    await super.initialize(blockNumber, options);
  }

  getPoolIdentifierData(): PoolPairsInfo {
    return {
      poolId: this.poolId,
    };
  }

  protected _getStateRequestCallDataPerPool(
    poolId: string,
    tick: string,
    tickSpacing: string,
    ticks: SubgraphTick[],
  ) {
    let callData: MultiCallParams<
      bigint | Slot0 | FeeGrowthGlobals | TickInfo | [bigint, bigint]
    >[] = [
      {
        target: this.config.stateView,
        callData: this.stateViewIface.encodeFunctionData('getLiquidity', [
          poolId,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.config.stateView,
        callData: this.stateViewIface.encodeFunctionData('getSlot0', [poolId]),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike): Slot0 => {
          const [, toDecode] = extractSuccessAndValue(result);

          const decoded = this.stateViewIface.decodeFunctionResult(
            'getSlot0',
            toDecode,
          );

          return {
            sqrtPriceX96: BigInt(decoded[0]),
            tick: BigInt(decoded[1]),
            protocolFee: BigInt(decoded[2]),
            lpFee: BigInt(decoded[3]),
          };
        },
      },
      {
        target: this.config.stateView,
        callData: this.stateViewIface.encodeFunctionData(
          'getFeeGrowthGlobals',
          [poolId],
        ),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): FeeGrowthGlobals => {
          const [, toDecode] = extractSuccessAndValue(result);

          const decoded = this.stateViewIface.decodeFunctionResult(
            'getFeeGrowthGlobals',
            toDecode,
          );

          return {
            feeGrowthGlobal0: BigInt(decoded[0]),
            feeGrowthGlobal1: BigInt(decoded[1]),
          };
        },
      },
    ];

    // get ticks calldata
    ticks.map(tick => {
      callData.push({
        target: this.config.stateView,
        callData: this.stateViewIface.encodeFunctionData('getTickInfo', [
          poolId,
          tick.tickIdx,
        ]),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): TickInfo => {
          const [, toDecode] = extractSuccessAndValue(result);

          const decoded = this.stateViewIface.decodeFunctionResult(
            'getTickInfo',
            toDecode,
          );

          return {
            liquidityGross: BigInt(decoded[0]),
            liquidityNet: BigInt(decoded[1]),
          };
        },
      });
    });

    const [leftBitMapIndex, rightBitMapIndex] = this.getBitmapRangeToRequest(
      tick,
      tickSpacing,
    );

    // get tick bitmap calldata
    for (let i = leftBitMapIndex; i <= rightBitMapIndex; i++) {
      callData.push({
        target: this.config.stateView,
        callData: this.stateViewIface.encodeFunctionData('getTickBitmap', [
          poolId,
          i,
        ]),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): [bigint, bigint] => {
          const [, toDecode] = extractSuccessAndValue(result);

          const decoded = this.stateViewIface.decodeFunctionResult(
            'getTickBitmap',
            toDecode,
          );

          return [i, BigInt(decoded[0])];
        },
      });
    }

    ticks.map(tick => {
      const compressed = TickBitMap.compress(
        BigInt(tick.tickIdx),
        BigInt(tickSpacing),
      );
      const [wordPos] = TickBitMap.position(compressed);

      callData.push({
        target: this.config.stateView,
        callData: this.stateViewIface.encodeFunctionData('getTickBitmap', [
          poolId,
          wordPos,
        ]),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): [bigint, bigint] => {
          const [, toDecode] = extractSuccessAndValue(result);

          const decoded = this.stateViewIface.decodeFunctionResult(
            'getTickBitmap',
            toDecode,
          );

          return [wordPos, BigInt(decoded[0])];
        },
      });
    });

    return callData;
  }

  async getOrGenerateState(blockNumber: number): Promise<PoolState> {
    let state = this.getState(blockNumber);

    this.logger.warn(
      `${this.parentName}: No state found on block ${blockNumber} for pool ${this.poolId}, generating new one`,
    );
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  async generateStateWithSubgraph(blockNumber: number): Promise<PoolState> {
    const ticks = await this.getTicks(blockNumber);

    const callData = this._getStateRequestCallDataPerPool(
      this.poolId,
      this.tick,
      this.tickSpacing,
      ticks,
    );

    const results = await this.dexHelper.multiWrapper.tryAggregate<
      bigint | Slot0 | FeeGrowthGlobals | TickInfo | [bigint, bigint]
    >(
      false,
      callData,
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
      false,
    );

    const liquidityResult = results[0].returnData as bigint;
    const slot0Result = results[1].returnData as Slot0;
    const feeGrowthGlobalsResult = results[2].returnData as FeeGrowthGlobals;

    let tickCounter = 0;
    const ticksResults = ticks.reduce<Record<NumberAsString, TickInfo>>(
      (memo, tick) => {
        const curResults = results[3 + tickCounter] as {
          returnData: TickInfo;
        };

        const { liquidityNet, liquidityGross } = curResults.returnData;

        if (
          // skips ticks with 0n values to optimize state size
          !(liquidityNet === 0n && liquidityGross === 0n)
        ) {
          memo[tick.tickIdx] = {
            liquidityNet,
            liquidityGross,
          };
        }

        tickCounter++;

        return memo;
      },
      {},
    );

    const tickBitMapMinIndex = 3 + tickCounter;
    const [leftBitMapIndex, rightBitMapIndex] = this.getBitmapRangeToRequest(
      this.tick,
      this.tickSpacing,
    );

    let tickBitMapCounter = 0;
    const tickBitMapResults: Record<NumberAsString, bigint> = {};
    for (
      let i = leftBitMapIndex;
      i <= Number(rightBitMapIndex) + ticks.length;
      i++
    ) {
      const curResults = results[tickBitMapMinIndex + tickBitMapCounter] as {
        returnData: [bigint, bigint];
      };

      const [wordPos, tickBitMap] = curResults.returnData;

      tickBitMapResults[wordPos.toString()] = tickBitMap;

      tickBitMapCounter++;
    }

    return {
      id: this.poolId,
      token0: this.token0.toLowerCase(),
      token1: this.token1.toLowerCase(),
      fee: this.fee,
      hooks: this.hooks,
      feeGrowthGlobal0X128: feeGrowthGlobalsResult.feeGrowthGlobal0,
      feeGrowthGlobal1X128: feeGrowthGlobalsResult.feeGrowthGlobal1,
      liquidity: liquidityResult,
      slot0: {
        ...slot0Result,
        tick: slot0Result.tick === 0n ? BigInt(this.tick) : slot0Result.tick,
        lpFee:
          slot0Result.lpFee === 0n
            ? LPFeeLibrary.getInitialLPFee(BigInt(this.fee))
            : slot0Result.lpFee,
        sqrtPriceX96:
          slot0Result.sqrtPriceX96 === 0n
            ? this.sqrtPriceX96
            : slot0Result.sqrtPriceX96,
      },
      tickSpacing: parseInt(this.tickSpacing),
      ticks: ticksResults,
      tickBitmap: tickBitMapResults,
      isValid: true,
    };
  }

  async generateState(blockNumber: number): Promise<PoolState> {
    const poolKey = {
      currency0: this.token0,
      currency1: this.token1,
      fee: this.fee,
      tickSpacing: parseInt(this.tickSpacing),
      hooks: this.hooks,
    };

    const callData = this.stateMulticallIface.encodeFunctionData(
      'getFullStateWithRelativeBitmaps',
      [
        this.config.poolManager,
        poolKey,
        this.getBitmapRange(),
        this.getBitmapRange(),
      ],
    );

    const result = await this.dexHelper.multiWrapper.tryAggregate<any>(
      false,
      [
        {
          target: this.config.stateMulticall,
          callData,
          decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
            const [, toDecode] = extractSuccessAndValue(result);
            return this.stateMulticallIface.decodeFunctionResult(
              'getFullStateWithRelativeBitmaps',
              toDecode,
            );
          },
        },
      ],
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
      false,
    );

    const stateResult = result[0].returnData[0];

    const ticksResults: Record<NumberAsString, TickInfo> = {};
    stateResult.ticks.forEach((tick: any) => {
      if (tick.value.liquidityGross > 0n) {
        ticksResults[tick.index.toString()] = {
          liquidityGross: BigInt(tick.value.liquidityGross),
          liquidityNet: BigInt(tick.value.liquidityNet),
        };
      }
    });

    const tickBitMapResults: Record<NumberAsString, bigint> = {};
    stateResult.tickBitmap.forEach((bitmap: any) => {
      tickBitMapResults[bitmap.index.toString()] = BigInt(bitmap.value);
    });

    return {
      id: this.poolId,
      token0: this.token0.toLowerCase(),
      token1: this.token1.toLowerCase(),
      fee: this.fee,
      hooks: this.hooks,
      feeGrowthGlobal0X128: BigInt(stateResult.feeGrowthGlobal0X128),
      feeGrowthGlobal1X128: BigInt(stateResult.feeGrowthGlobal1X128),
      liquidity: BigInt(stateResult.liquidity),
      slot0: {
        sqrtPriceX96: BigInt(stateResult.slot0.sqrtPriceX96),
        tick: BigInt(stateResult.slot0.tick),
        protocolFee: BigInt(stateResult.slot0.protocolFee),
        lpFee: BigInt(stateResult.slot0.lpFee),
      },
      tickSpacing: parseInt(this.tickSpacing),
      ticks: ticksResults,
      tickBitmap: tickBitMapResults,
      isValid: true,
    };
  }

  async getTicks(blockNumber: number): Promise<SubgraphTick[]> {
    const defaultPerPageLimit = 1000;
    let curPage = 0;
    let ticks: SubgraphTick[] = [];

    let currentTicks = await queryTicksForPool(
      this.dexHelper,
      this.logger,
      this.parentName,
      this.config.subgraphURL,
      blockNumber,
      this.poolId,
      curPage * defaultPerPageLimit,
      defaultPerPageLimit,
    );

    ticks = ticks.concat(currentTicks);

    while (currentTicks.length === defaultPerPageLimit) {
      curPage++;
      currentTicks = await queryTicksForPool(
        this.dexHelper,
        this.logger,
        this.parentName,
        this.config.subgraphURL,
        blockNumber,
        this.poolId,
        curPage * defaultPerPageLimit,
        defaultPerPageLimit,
      );

      ticks = ticks.concat(currentTicks);
    }

    return ticks;
  }

  getBitmapRangeToRequest(tick: string, tickSpacing: string): [bigint, bigint] {
    const networkId = this.dexHelper.config.data.network;

    const tickBitMapToUse =
      TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
    const tickBitMapBuffer =
      TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;

    const range = tickBitMapToUse + tickBitMapBuffer;

    const compressedTick = TickBitMap.compress(
      BigInt(tick),
      BigInt(tickSpacing),
    );

    const [currentBitMapIndex] = TickBitMap.position(compressedTick);

    const leftBitMapIndex = currentBitMapIndex - range;
    const rightBitMapIndex = currentBitMapIndex + range;

    return [leftBitMapIndex, rightBitMapIndex];
  }

  getBitmapRange() {
    const networkId = this.dexHelper.config.data.network;

    const tickBitMapToUse =
      TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
    const tickBitMapBuffer =
      TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;

    return tickBitMapToUse + tickBitMapBuffer;
  }

  protected async processBlockLogs(
    state: DeepReadonly<PoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const newState = await super.processBlockLogs(state, logs, blockHeader);
    if (newState && !newState.isValid) {
      return await this.generateState(blockHeader.number);
    }
    return newState;
  }

  protected async processLog(
    state: PoolState,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState | null>> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        const id = event.args.id.toLowerCase();

        if (id && id !== this.poolId.toLowerCase()) return null; // skip not relevant events

        const _state = _.cloneDeep(state) as PoolState;

        try {
          return this.handlers[event.name](event, _state, log, blockHeader);
        } catch (e) {
          this.logger.error(
            `${this.parentName}: PoolManager ${this.config.poolManager} (pool id ${this.poolId}), ` +
              `network=${this.dexHelper.config.data.network}: Unexpected ` +
              `error while handling event on blockNumber=${blockHeader.number} for ${this.parentName}, txHash=${log.transactionHash}, logIndex=${log.logIndex}, event=${event?.name}`,
            e,
          );

          _state.isValid = false;
          return _state;
        }
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  handleProtocolFeeUpdatedEvent(event: any, poolState: PoolState) {
    const protocolFee = event.args.protocolFee;

    uniswapV4PoolMath.checkPoolInitialized(poolState);
    uniswapV4PoolMath.setProtocolFee(poolState, protocolFee);

    return poolState;
  }

  handleDonateEvent(event: any, poolState: PoolState) {
    const amount0 = BigInt(event.args.amount0);
    const amount1 = BigInt(event.args.amount1);

    uniswapV4PoolMath.checkPoolInitialized(poolState);
    uniswapV4PoolMath.donate(poolState, amount0, amount1);

    return poolState;
  }

  handleSwapEvent(event: any, poolState: PoolState) {
    const amount0 = BigInt(event.args.amount0);
    const amount1 = BigInt(event.args.amount1);

    const resultSqrtPriceX96 = BigInt(event.args.sqrtPriceX96);
    const resultLiquidity = BigInt(event.args.liquidity);
    const resultTick = BigInt(event.args.tick);
    const resultSwapFee = BigInt(event.args.fee);

    const zeroForOne = amount0 < 0n;

    uniswapV4PoolMath.checkPoolInitialized(poolState);

    uniswapV4PoolMath.swapFromEvent(
      poolState,
      zeroForOne,
      resultSqrtPriceX96,
      resultTick,
      resultLiquidity,
      resultSwapFee,
      amount0,
      amount1,
      this.logger,
    );

    return poolState;
  }

  handleModifyLiquidityEvent(event: any, poolState: PoolState, _: Log) {
    uniswapV4PoolMath.checkPoolInitialized(poolState);

    const tickLower = BigInt(event.args.tickLower);
    const tickUpper = BigInt(event.args.tickUpper);
    const liquidityDelta = BigInt(event.args.liquidityDelta);

    uniswapV4PoolMath.modifyLiquidity(poolState, {
      liquidityDelta,
      tickUpper,
      tickLower,
      tickSpacing: BigInt(poolState.tickSpacing),
    });

    return poolState;
  }
}
