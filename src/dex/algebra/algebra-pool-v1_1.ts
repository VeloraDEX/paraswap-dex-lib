import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import { DeepReadonly, assert } from 'ts-essentials';
import { Address, BlockHeader, Log, Logger } from '../../types';
import { bigIntify, catchParseLogError, int16 } from '../../utils';
import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  DecodedGlobalStateV1_1,
  PoolStateV1_1,
  TickBitMapMappingsWithBigNumber,
  TickInfoMappingsWithBigNumber,
  TickInfoWithBigNumber,
} from './types';
import { BigNumber, ethers } from 'ethers';
import { Contract } from 'web3-eth-contract';
import AlgebraABI from '../../abi/algebra/AlgebraPool-v1_1.abi.json';
import FactoryABI from '../../abi/algebra/AlgebraFactory-v1_1.abi.json';
import { DecodedStateMultiCallResultWithRelativeBitmapsV1_1 } from './types';
import { OUT_OF_RANGE_ERROR_POSTFIX } from '../uniswap-v3/constants';
import {
  addressDecode,
  uint256ToBigInt,
  uint128ToBigNumber,
  int24ToNumber,
} from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';
import {
  decodeGlobalStateV1_1,
  decodeStateMultiCallResultWithRelativeBitmapsV1_1,
  decodeTicksV1_1,
} from './utils';
import { AlgebraMath } from './lib/AlgebraMath';
import {
  _reduceTickBitmap,
  _reduceTicks,
} from '../uniswap-v3/contract-math/utils';
import { Network, NULL_ADDRESS } from '../../constants';
import { TickTable } from './lib/TickTable';
import {
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_TO_USE_BY_CHAIN,
} from './constants';

const BN_ZERO = BigNumber.from(0);
const MAX_BATCH_SIZE = 100;
const MAX_NUMBER_OF_BATCH_REQUEST_HALVING = 3;

export class AlgebraEventPoolV1_1 extends StatefulEventSubscriber<PoolStateV1_1> {
  protected handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolStateV1_1>,
      log: Readonly<Log>,
      blockHeader: BlockHeader,
    ) => DeepReadonly<PoolStateV1_1> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  private _poolAddress?: Address;
  readonly token0: Address;
  readonly token1: Address;

  public readonly poolIface = new Interface(AlgebraABI);
  public readonly factoryIface = new Interface(FactoryABI);

  private readonly cachedStateMultiCalls: MultiCallParams<
    string | bigint | BigNumber | number | DecodedGlobalStateV1_1
  >[];

  private optimalTickRequestBatchSize?: number;

  public initFailed = false;
  public initRetryAttemptCount = 0;

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    readonly stateMultiContract: Contract,
    readonly erc20Interface: Interface,
    protected readonly factoryAddress: Address,
    token0: Address,
    token1: Address,
    logger: Logger,
    mapKey: string = '',
    readonly poolInitCodeHash: string,
    readonly poolDeployer: string,
    private readonly forceManualStateGeneration: boolean = false,
    private readonly areTicksCompressed: boolean = true,
  ) {
    super(parentName, `${token0}_${token1}`, dexHelper, logger, true, mapKey);
    this.token0 = token0.toLowerCase();
    this.token1 = token1.toLowerCase();

    this.logDecoder = (log: Log) => this.poolIface.parseLog(log);
    this.addressesSubscribed = new Array<Address>(1);

    this.handlers['Fee'] = this.handleNewFee.bind(this);
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);
    this.handlers['Mint'] = this.handleMintEvent.bind(this);
    this.handlers['Burn'] = this.handleBurnEvent.bind(this);
    this.handlers['Flash'] = this.handleFlashEvent.bind(this);
    this.handlers['Collect'] = this.handleCollectEvent.bind(this);
    this.handlers['CommunityFee'] = this.handleCommunityFee.bind(this);

    this.cachedStateMultiCalls = this._getStateMulticall();
  }

  get poolAddress() {
    if (this._poolAddress === undefined) {
      this._poolAddress = this._computePoolAddress(this.token0, this.token1);
    }
    return this._poolAddress;
  }

  set poolAddress(address: Address) {
    this._poolAddress = address.toLowerCase();
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<PoolStateV1_1>,
  ) {
    await super.initialize(blockNumber, options);
  }

  protected getPoolIdentifierData() {
    return {
      token0: this.token0,
      token1: this.token1,
    };
  }

  protected async processBlockLogs(
    state: DeepReadonly<PoolStateV1_1>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolStateV1_1> | null> {
    const newState = await super.processBlockLogs(state, logs, blockHeader);
    if (newState && !newState.isValid) {
      return await this.generateState(blockHeader.number);
    }
    return newState;
  }

  protected processLog(
    state: DeepReadonly<PoolStateV1_1>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolStateV1_1> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        // Because we have observations in array which is mutable by nature, there is a
        // ts compile error: https://stackoverflow.com/questions/53412934/disable-allowing-assigning-readonly-types-to-non-readonly-types
        // And there is no good workaround, so turn off the type checker for this line
        const _state = _.cloneDeep(state) as PoolStateV1_1;
        try {
          const newState = this.handlers[event.name](
            event,
            _state,
            log,
            blockHeader,
          );
          return newState;
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.endsWith(OUT_OF_RANGE_ERROR_POSTFIX)
          ) {
            this.logger.warn(
              `${this.parentName}: Pool ${this.poolAddress} on ${
                this.dexHelper.config.data.network
              } is out of TickBitmap requested range. Re-query the state. ${JSON.stringify(
                event,
              )}`,
              e,
            );
          } else {
            this.logger.error(
              `${this.parentName}: Pool ${this.poolAddress}, ` +
                `network=${this.dexHelper.config.data.network}: Unexpected ` +
                `error while handling event on blockNumber=${blockHeader.number}, ` +
                `blockHash=${blockHeader.hash} and parentHash=${
                  blockHeader.parentHash
                } for QuickSwapV3, ${JSON.stringify(event)}`,
              e,
            );
          }
          _state.isValid = false;
          return _state;
        }
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }
    return null; // ignore unrecognized event
  }

  getBitmapRangeToRequest() {
    const networkId = this.dexHelper.config.data.network;

    const tickBitmapToUse =
      TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
    const tickBitmapBuffer =
      TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;

    return tickBitmapToUse + tickBitmapBuffer;
  }

  async fetchPoolStateSingleStep(
    blockNumber: number,
  ): Promise<
    [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_1]
  > {
    const callData: MultiCallParams<
      bigint | DecodedStateMultiCallResultWithRelativeBitmapsV1_1
    >[] = [
      {
        target: this.token0,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.token1,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.stateMultiContract.options.address,
        callData: this.stateMultiContract.methods
          .getFullStateWithRelativeBitmaps(
            this.factoryAddress,
            this.token0,
            this.token1,
            this.getBitmapRangeToRequest(),
            this.getBitmapRangeToRequest(),
          )
          .encodeABI(),
        decodeFunction: decodeStateMultiCallResultWithRelativeBitmapsV1_1,
      },
    ];

    const [resBalance0, resBalance1, resState] =
      await this.dexHelper.multiWrapper.tryAggregate<
        bigint | DecodedStateMultiCallResultWithRelativeBitmapsV1_1
      >(
        false,
        callData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    assert(resState.success, 'Pool does not exist');

    const [balance0, balance1, _state] = [
      resBalance0.returnData,
      resBalance1.returnData,
      resState.returnData,
    ] as [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_1];

    return [balance0, balance1, _state];
  }

  private async _fetchPoolStateMultiStep(
    blockNumber: number,
  ): Promise<
    [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_1]
  > {
    const balancesAndGlobalStateCalldata: MultiCallParams<
      bigint | DecodedStateMultiCallResultWithRelativeBitmapsV1_1
    >[] = [
      {
        target: this.token0,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.token1,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.stateMultiContract.options.address,
        callData: this.stateMultiContract.methods
          .getFullStateWithoutTicks(
            this.factoryAddress,
            this.token0,
            this.token1,
            0,
            0,
          )
          .encodeABI(),
        decodeFunction: decodeStateMultiCallResultWithRelativeBitmapsV1_1,
      },
    ];

    const [resBalance0, resBalance1, stateWithoutTicksAndTickBitmap] =
      await this.dexHelper.multiWrapper.tryAggregate<
        bigint | DecodedStateMultiCallResultWithRelativeBitmapsV1_1
      >(
        false,
        balancesAndGlobalStateCalldata,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    assert(stateWithoutTicksAndTickBitmap.success, 'Pool does not exist');

    const [balance0, balance1, _stateWithoutTicksAndTickBitmap] = [
      resBalance0.returnData,
      resBalance1.returnData,
      stateWithoutTicksAndTickBitmap.returnData,
    ] as [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_1];

    const {
      globalState: { tick },
    } = _stateWithoutTicksAndTickBitmap;
    const currentBitmapIndex = int16(
      (BigInt(tick) / BigInt(_stateWithoutTicksAndTickBitmap.tickSpacing)) >>
        8n,
    );

    const buffer = this.getBitmapRangeToRequest();
    const startBitMapIndex = currentBitmapIndex - buffer;
    const endBitMapIndex = currentBitmapIndex + buffer;
    const allBitMapIndices = Array.from(
      { length: 2 * Number(buffer) + 1 },
      () => startBitMapIndex + endBitMapIndex,
    );

    const ticksAndBitMaps = await Promise.all(
      allBitMapIndices.map(relativeTick => {
        return this.stateMultiContract.methods
          .getAdditionalBitmapWithTicks(
            this.factoryAddress,
            this.token0,
            this.token1,
            relativeTick,
            relativeTick,
          )
          .call() as [
          TickBitMapMappingsWithBigNumber[],
          TickInfoMappingsWithBigNumber[],
        ];
      }),
    );

    const _state: DecodedStateMultiCallResultWithRelativeBitmapsV1_1 = {
      ..._stateWithoutTicksAndTickBitmap,
      tickBitmap: ticksAndBitMaps.flatMap(v => v[0]),
      ticks: ticksAndBitMaps.flatMap(v => v[1]),
    };

    return [balance0, balance1, _state];
  }

  async _fetchInitStateMultiStrategies(
    blockNumber: number,
  ): Promise<
    [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_1]
  > {
    try {
      return await this.fetchPoolStateSingleStep(blockNumber);
    } catch (e) {
      if (e instanceof Error && e.message.includes('Pool does not exist'))
        throw e;

      if (this.dexHelper.config.data.network != Network.ZKEVM) throw e;

      return this._fetchPoolStateMultiStep(blockNumber);
    }
  }

  private _getStateMulticall(): MultiCallParams<
    string | bigint | BigNumber | number | DecodedGlobalStateV1_1
  >[] {
    return [
      {
        target: this.factoryAddress,
        callData: this.factoryIface.encodeFunctionData('poolByPair', [
          this.token0,
          this.token1,
        ]),
        decodeFunction: addressDecode,
      },
      {
        target: this.token0,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.token1,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          this.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('liquidity', []),
        decodeFunction: uint128ToBigNumber,
      },
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('tickSpacing', []),
        decodeFunction: int24ToNumber,
      },
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('maxLiquidityPerTick', []),
        decodeFunction: uint128ToBigNumber,
      },
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('globalState', []),
        decodeFunction: decodeGlobalStateV1_1,
      },
    ];
  }

  async fetchStateManually(
    blockNumber: number,
  ): Promise<
    [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmapsV1_1]
  > {
    // Unfortunately I can not unite this call with the next one. For some reason even if pool does not exist
    // call succeeds and makes decoding function to throw. Otherwise, I should rewrite decoders in different which
    // require some time
    const [poolAddress] = (await this.dexHelper.multiWrapper.aggregate<
      string | bigint | BigNumber | number | DecodedGlobalStateV1_1
    >(this.cachedStateMultiCalls.slice(0, 1), blockNumber, MAX_BATCH_SIZE)) as [
      string,
    ];

    if (poolAddress === NULL_ADDRESS) {
      throw new Error('Pool does not exist');
    }

    const [
      balance0,
      balance1,
      liquidity,
      tickSpacing,
      maxLiquidityPerTick,
      globalState,
    ] = (await this.dexHelper.multiWrapper.aggregate<
      string | bigint | BigNumber | number | DecodedGlobalStateV1_1
    >(this.cachedStateMultiCalls.slice(1), blockNumber, MAX_BATCH_SIZE)) as [
      bigint,
      bigint,
      BigNumber,
      number,
      BigNumber,
      DecodedGlobalStateV1_1,
    ];

    assert(
      poolAddress.toLowerCase() === this.poolAddress.toLowerCase(),
      `Pool address mismatch: ${poolAddress.toLowerCase()} != ${this.poolAddress.toLowerCase()}`,
    );

    const currentBitMapIndex = TickTable.position(
      BigInt(BigInt(globalState.tick) / BigInt(tickSpacing)),
    )[0];

    const leftBitMapIndex = currentBitMapIndex - this.getBitmapRangeToRequest();
    const rightBitMapIndex =
      currentBitMapIndex + this.getBitmapRangeToRequest();

    const allTickBitMaps = await this.dexHelper.multiWrapper.aggregate(
      _.range(Number(leftBitMapIndex), Number(rightBitMapIndex + 1n)).map(
        index => {
          return {
            target: poolAddress,
            callData: this.poolIface.encodeFunctionData('tickTable', [
              int16(BigInt(index)),
            ]),
            decodeFunction: uint256ToBigInt,
          };
        },
      ),
      blockNumber,
      MAX_BATCH_SIZE,
    );

    const tickBitmap: TickBitMapMappingsWithBigNumber[] = [];

    let globalIndex = 0;
    for (let i = leftBitMapIndex; i <= rightBitMapIndex; i++) {
      const index = Number(int16(i));
      const bitmap = allTickBitMaps[globalIndex];
      globalIndex++;
      if (bitmap == 0n) continue;
      tickBitmap.push({ index: Number(index), value: BigNumber.from(bitmap) });
    }

    const tickIndexes: bigint[] = [];

    const tickRequests = tickBitmap
      .map(tb => {
        const allBits: MultiCallParams<TickInfoWithBigNumber>[] = [];
        if (tb.value === BN_ZERO) return allBits;

        _.range(0, 256).forEach(j => {
          if ((tb.value.toBigInt() & (1n << BigInt(j))) > 0n) {
            const populatedTick =
              (BigInt.asIntN(16, BigInt(tb.index) << 8n) + BigInt(j)) *
              BigInt(tickSpacing);

            tickIndexes.push(populatedTick);
            allBits.push({
              target: poolAddress,
              callData: this.poolIface.encodeFunctionData('ticks', [
                populatedTick,
              ]),
              decodeFunction: decodeTicksV1_1,
            });
          }
        });
        return allBits;
      })
      .flat();

    let ticksValues: TickInfoWithBigNumber[] = [];
    if (this.optimalTickRequestBatchSize) {
      ticksValues = await this.dexHelper.multiWrapper.aggregate(
        tickRequests,
        blockNumber,
        this.optimalTickRequestBatchSize,
      );
      // If we don't know what is optimal number of requests for this pool, we want to try it experimentally and save it
      // Maybe later to consider distant caching
    } else {
      for (const i of _.range(0, MAX_NUMBER_OF_BATCH_REQUEST_HALVING)) {
        const currentBatchSize = MAX_BATCH_SIZE / (+i + 1);
        try {
          // Some of the pools fails with 100 batch size, for them we want to try additionally with reduced batch size
          ticksValues = await this.dexHelper.multiWrapper.aggregate(
            tickRequests,
            blockNumber,
            currentBatchSize,
          );
          this.optimalTickRequestBatchSize = currentBatchSize;
          break;
        } catch (e) {
          if (+i + 1 === MAX_NUMBER_OF_BATCH_REQUEST_HALVING) {
            this.logger.warn(
              `Failed to fetch ticks for pool ${poolAddress} (${this.token0}_${this.token1}) with batch size ${currentBatchSize}`,
              e,
            );
            throw e;
          }
        }
      }
    }

    assert(
      tickIndexes.length === ticksValues.length,
      `Tick indexes mismatch: ${tickIndexes.length} != ${ticksValues.length}`,
    );

    const ticks: TickInfoMappingsWithBigNumber[] = new Array(
      tickIndexes.length,
    );

    tickIndexes.forEach((tickIndex, index) => {
      ticks[index] = {
        index: Number(tickIndex),
        value: ticksValues[index],
      };
    });

    return [
      balance0,
      balance1,
      {
        pool: poolAddress,
        blockTimestamp: BigNumber.from(Date.now()),
        globalState,
        liquidity,
        tickSpacing,
        maxLiquidityPerTick,
        tickBitmap,
        ticks,
      },
    ];
  }

  async generateState(blockNumber: number): Promise<Readonly<PoolStateV1_1>> {
    let balance0 = 0n;
    let balance1 = 0n;
    let _state: DecodedStateMultiCallResultWithRelativeBitmapsV1_1;
    if (this.forceManualStateGeneration) {
      [balance0, balance1, _state] = await this.fetchStateManually(blockNumber);
    } else {
      [balance0, balance1, _state] = await this._fetchInitStateMultiStrategies(
        blockNumber,
      );
    }

    const tickBitmap = {};
    const ticks = {};

    _reduceTickBitmap(tickBitmap, _state.tickBitmap);
    _reduceTicks(ticks, _state.ticks);
    const globalState: PoolStateV1_1['globalState'] = {
      communityFeeToken0: bigIntify(_state.globalState.communityFeeToken0),
      communityFeeToken1: bigIntify(_state.globalState.communityFeeToken1),
      fee: bigIntify(_state.globalState.fee),
      price: bigIntify(_state.globalState.price),
      tick: bigIntify(_state.globalState.tick),
    };
    const currentTick = globalState.tick;
    const startTickBitmap = TickTable.position(
      BigInt(currentTick) / BigInt(_state.tickSpacing),
    )[0];

    return {
      pool: _state.pool,
      blockTimestamp: bigIntify(_state.blockTimestamp),
      globalState,
      liquidity: bigIntify(_state.liquidity),
      tickSpacing: bigIntify(_state.tickSpacing),
      maxLiquidityPerTick: bigIntify(_state.maxLiquidityPerTick),
      tickBitmap,
      ticks,
      startTickBitmap,
      isValid: true,
      balance0,
      balance1,
      areTicksCompressed: this.areTicksCompressed,
    };
  }

  handleSwapEvent(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const newSqrtPriceX96 = bigIntify(event.args.price);
    const amount0 = bigIntify(event.args.amount0);
    const amount1 = bigIntify(event.args.amount1);
    const newTick = bigIntify(event.args.tick);
    const newLiquidity = bigIntify(event.args.liquidity);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    if (amount0 <= 0n && amount1 <= 0n) {
      this.logger.error(
        `${this.parentName}: amount0 <= 0n && amount1 <= 0n for ` +
          `${this.poolAddress} and ${blockHeader.number}. Check why it happened`,
      );
      pool.isValid = false;
      return pool;
    } else {
      const zeroForOne = amount0 > 0n;

      const [, , , , , communityFee] = AlgebraMath._calculateSwapAndLock(
        this.dexHelper.config.data.network,
        pool,
        zeroForOne,
        newSqrtPriceX96,
        newTick,
        newLiquidity,
      );

      if (zeroForOne) {
        if (amount1 < 0n) {
          pool.balance1 -= BigInt.asUintN(256, -amount1);
        } else {
          this.logger.error(
            `In swapEvent for pool ${pool.pool} received incorrect values ${zeroForOne} and ${amount1}`,
          );
          pool.isValid = false;
        }
        // This is not correct fully, because pool may get more tokens then it needs, but
        // it is not accounted in internal state, it should be good enough
        pool.balance0 += BigInt.asUintN(256, amount0);
      } else {
        if (amount0 < 0n) {
          pool.balance0 -= BigInt.asUintN(256, -amount0);
        } else {
          this.logger.error(
            `In swapEvent for pool ${pool.pool} received incorrect values ${zeroForOne} and ${amount0}`,
          );
          pool.isValid = false;
        }
        pool.balance1 += BigInt.asUintN(256, amount1);
      }

      if (communityFee > 0n) {
        // _payCommunityFee
        if (zeroForOne) {
          pool.balance0 -= communityFee;
        } else {
          pool.balance1 -= communityFee;
        }
      }

      return pool;
    }
  }
  handleMintEvent(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const bottomTick = bigIntify(event.args.bottomTick);
    const topTick = bigIntify(event.args.topTick);
    const liquidityActual = bigIntify(event.args.liquidityAmount);
    const amount0 = bigIntify(event.args.amount0);
    const amount1 = bigIntify(event.args.amount1);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    AlgebraMath._updatePositionTicksAndFees(
      this.dexHelper.config.data.network,
      pool,
      bottomTick,
      topTick,
      liquidityActual,
    );

    pool.balance0 += amount0;
    pool.balance1 += amount1;

    return pool;
  }

  handleBurnEvent(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const bottomTick = bigIntify(event.args.bottomTick);
    const topTick = bigIntify(event.args.topTick);
    const amount = bigIntify(event.args.liquidityAmount);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    AlgebraMath._updatePositionTicksAndFees(
      this.dexHelper.config.data.network,
      pool,
      bottomTick,
      topTick,
      -BigInt.asIntN(128, BigInt.asIntN(256, amount)),
    );

    // no balance change

    return pool;
  }

  handleNewFee(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const fee = bigIntify(event.args.fee);

    pool.globalState.fee = fee;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    return pool;
  }

  handleCollectEvent(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const amount0 = bigIntify(event.args.amount0);
    const amount1 = bigIntify(event.args.amount1);
    pool.balance0 -= amount0;
    pool.balance1 -= amount1;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    return pool;
  }

  handleFlashEvent(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const paid0 = bigIntify(event.args.paid0);
    const paid1 = bigIntify(event.args.paid1);
    pool.balance0 += paid0;
    pool.balance1 += paid1;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    return pool;
  }

  handleCommunityFee(
    event: any,
    pool: PoolStateV1_1,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const communityFeeToken0 = bigIntify(event.ags.communityFee0New);
    const communityFeeToken1 = bigIntify(event.ags.communityFee1New);

    pool.globalState.communityFeeToken0 = communityFeeToken0;
    pool.globalState.communityFeeToken1 = communityFeeToken1;

    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    return pool;
  }

  private _computePoolAddress(token0: Address, token1: Address): Address {
    // https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol
    if (token0 > token1) [token0, token1] = [token1, token0];

    const encodedKey = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address'],
        [token0, token1],
      ),
    );

    return ethers.utils.getCreate2Address(
      this.poolDeployer,
      encodedKey,
      this.poolInitCodeHash,
    );
  }
}
