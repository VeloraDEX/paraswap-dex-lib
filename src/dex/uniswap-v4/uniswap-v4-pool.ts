import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import { DexParams, PoolPairsInfo, PoolState, TickInfo } from './types';
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
import { MultiResult } from '../../lib/multi-wrapper';
import { NumberAsString } from '@paraswap/core';
import { extractSuccessAndValue } from '../../lib/decoders';
import { IBaseHook } from './hooks/types';

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
    public tickSpacing: string,
    public readonly hook?: IBaseHook,
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
