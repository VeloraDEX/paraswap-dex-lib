import _ from 'lodash';
import { Contract } from 'web3-eth-contract';
import { Interface } from '@ethersproject/abi';
import { ethers } from 'ethers';
import { assert, DeepReadonly } from 'ts-essentials';
import { Log, Logger, BlockHeader, Address } from '../../types';
import {
  InitializeStateOptions,
  StatefulEventSubscriber,
} from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  PoolState,
  DecodedStateMultiCallResultWithRelativeBitmaps,
  DecodeStateMultiCallFunc,
} from './types';
import UniswapV3PoolABI from '../../abi/uniswap-v3/UniswapV3Pool.abi.json';
import { bigIntify, catchParseLogError, isSampled } from '../../utils';
import { uniswapV3Math } from './contract-math/uniswap-v3-math';
import { MultiCallParams } from '../../lib/multi-wrapper';
import {
  OUT_OF_RANGE_ERROR_POSTFIX,
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_TO_USE_BY_CHAIN,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  INACTIVE_POOL_AGE_MS,
} from './constants';
import { TickBitMap } from './contract-math/TickBitMap';
import { uint256ToBigInt } from '../../lib/decoders';
import { decodeStateMultiCallResultWithRelativeBitmaps } from './utils';
import { _reduceTickBitmap, _reduceTicks } from './contract-math/utils';

export class UniswapV3EventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      pool: PoolState,
      log: Log,
      blockHeader: Readonly<BlockHeader>,
    ) => PoolState;
  } = {};

  logDecoder: (log: Log) => any;

  readonly token0: Address;

  readonly token1: Address;

  private _poolAddress?: Address;

  protected _stateRequestCallData?: MultiCallParams<
    bigint | DecodedStateMultiCallResultWithRelativeBitmaps
  >[];

  public readonly poolIface = new Interface(UniswapV3PoolABI);

  public initFailed = false;
  public initRetryAttemptCount = 0;

  public feeCodeAsString;

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    readonly stateMultiContract: Contract,
    readonly decodeStateMultiCallResultWithRelativeBitmaps:
      | DecodeStateMultiCallFunc
      | undefined,
    readonly erc20Interface: Interface,
    protected readonly factoryAddress: Address,
    public feeCode: bigint,
    token0: Address,
    token1: Address,
    logger: Logger,
    mapKey: string = '',
    readonly poolInitCodeHash: string,
    public readonly tickSpacing?: bigint,
  ) {
    let poolKey = `${token0}_${token1}_${feeCode}`;
    if (tickSpacing !== undefined) {
      poolKey = `${poolKey}_${tickSpacing}`;
    }

    super(parentName, poolKey, dexHelper, logger, true, mapKey);
    this.feeCodeAsString = feeCode.toString();
    this.token0 = token0.toLowerCase();
    this.token1 = token1.toLowerCase();
    this.logDecoder = (log: Log) => this.poolIface.parseLog(log);
    this.addressesSubscribed = new Array<Address>(1);

    // Add handlers
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);
    this.handlers['Burn'] = this.handleBurnEvent.bind(this);
    this.handlers['Mint'] = this.handleMintEvent.bind(this);
    this.handlers['SetFeeProtocol'] = this.handleSetFeeProtocolEvent.bind(this);
    this.handlers['IncreaseObservationCardinalityNext'] =
      this.handleIncreaseObservationCardinalityNextEvent.bind(this);

    // Wen need them to keep balance of the pool up to date
    this.handlers['Collect'] = this.handleCollectEvent.bind(this);
    // Almost the same as Collect, but for pool owners
    this.handlers['CollectProtocol'] = this.handleCollectEvent.bind(this);
    this.handlers['Flash'] = this.handleFlashEvent.bind(this);
  }

  get poolAddress() {
    if (this._poolAddress === undefined) {
      this._poolAddress = this._computePoolAddress(
        this.token0,
        this.token1,
        this.feeCode,
      );
    }
    return this._poolAddress;
  }

  set poolAddress(address: Address) {
    this._poolAddress = address.toLowerCase();
  }

  async initialize(
    blockNumber: number,
    options?: InitializeStateOptions<PoolState>,
  ) {
    await super.initialize(blockNumber, options);
  }

  protected getPoolIdentifierData() {
    return {
      token0: this.token0,
      token1: this.token1,
      fee: this.feeCode,
      tickSpacing: this.tickSpacing,
    };
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

  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);

      const uniswapV3EventLoggingSampleRate =
        this.dexHelper.config.data.uniswapV3EventLoggingSampleRate;
      if (
        !this.dexHelper.config.isSlave &&
        uniswapV3EventLoggingSampleRate &&
        isSampled(uniswapV3EventLoggingSampleRate)
      ) {
        this.logger.info(
          `event=${event.name} - block=${
            blockHeader.number
          }. Log sampled at rate ${uniswapV3EventLoggingSampleRate * 100}%`,
        );
      }

      if (event.name in this.handlers) {
        // Because we have observations in array which is mutable by nature, there is a
        // ts compile error: https://stackoverflow.com/questions/53412934/disable-allowing-assigning-readonly-types-to-non-readonly-types
        // And there is no good workaround, so turn off the type checker for this line
        const _state = _.cloneDeep(state) as PoolState;
        try {
          return this.handlers[event.name](event, _state, log, blockHeader);
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
                } for UniswapV3, ${JSON.stringify(event)}`,
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

  protected _getStateRequestCallData() {
    if (!this._stateRequestCallData) {
      const callData: MultiCallParams<
        bigint | DecodedStateMultiCallResultWithRelativeBitmaps
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
              this.feeCode,
              this.getBitmapRangeToRequest(),
              this.getBitmapRangeToRequest(),
            )
            .encodeABI(),
          decodeFunction:
            this.decodeStateMultiCallResultWithRelativeBitmaps !== undefined
              ? this.decodeStateMultiCallResultWithRelativeBitmaps
              : decodeStateMultiCallResultWithRelativeBitmaps,
        },
      ];

      this._stateRequestCallData = callData;
    }
    return this._stateRequestCallData;
  }

  getBitmapRangeToRequest() {
    const networkId = this.dexHelper.config.data.network;

    const tickBitMapToUse =
      TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
    const tickBitMapBuffer =
      TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;

    return tickBitMapToUse + tickBitMapBuffer;
  }

  async checkState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolState> | null> {
    const state = this.getState(blockNumber);
    if (state) {
      return state;
    }

    this.logger.error(
      `UniV3: No state found for ${this.name} ${this.addressesSubscribed[0]} for bn: ${blockNumber}`,
    );
    return null;
  }

  _setState(state: any, blockNumber: number, reason?: string): void {
    // if (this.parentName === 'UniswapV3') {
    // this.logger.info(
    //   `UniV3: Setting state: '${!!state ? 'non-empty' : 'empty'}' for '${
    //     this.name
    //   }' for bn: '${blockNumber}' due to reason: '${
    //     reason ?? 'outside_of_event_subscriber'
    //   }'`,
    // );
    // }
    super._setState(state, blockNumber);
  }

  async generateState(blockNumber: number): Promise<Readonly<PoolState>> {
    const callData = this._getStateRequestCallData();

    const [resBalance0, resBalance1, resState] =
      await this.dexHelper.multiWrapper.tryAggregate<
        bigint | DecodedStateMultiCallResultWithRelativeBitmaps
      >(
        false,
        callData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    // Quite ugly solution, but this is the one that fits to current flow.
    // I think UniswapV3 callbacks subscriptions are complexified for no reason.
    // Need to be revisited later
    assert(resState.success, 'Pool does not exist');

    const [balance0, balance1, _state] = [
      resBalance0.returnData,
      resBalance1.returnData,
      resState.returnData,
    ] as [bigint, bigint, DecodedStateMultiCallResultWithRelativeBitmaps];

    const inactiveTimestampMs = Date.now() - INACTIVE_POOL_AGE_MS;
    const isActive =
      inactiveTimestampMs < _state.observation.blockTimestamp * 1000;
    assert(isActive, 'Pool is inactive');

    const tickBitmap = {};
    const ticks = {};

    _reduceTickBitmap(tickBitmap, _state.tickBitmap);
    _reduceTicks(ticks, _state.ticks);

    const observations = {
      [_state.slot0.observationIndex]: {
        blockTimestamp: bigIntify(_state.observation.blockTimestamp),
        tickCumulative: bigIntify(_state.observation.tickCumulative),
        secondsPerLiquidityCumulativeX128: bigIntify(
          _state.observation.secondsPerLiquidityCumulativeX128,
        ),
        initialized: _state.observation.initialized,
      },
    };

    const currentTick = bigIntify(_state.slot0.tick);
    const tickSpacing = bigIntify(_state.tickSpacing);

    const startTickBitmap = TickBitMap.position(currentTick / tickSpacing)[0];
    const requestedRange = this.getBitmapRangeToRequest();

    return {
      networkId: this.dexHelper.config.data.network,
      pool: _state.pool,
      blockTimestamp: bigIntify(_state.blockTimestamp),
      slot0: {
        sqrtPriceX96: bigIntify(_state.slot0.sqrtPriceX96),
        tick: currentTick,
        observationIndex: +_state.slot0.observationIndex,
        observationCardinality: +_state.slot0.observationCardinality,
        observationCardinalityNext: +_state.slot0.observationCardinalityNext,
        feeProtocol: bigIntify(_state.slot0.feeProtocol),
      },
      liquidity: bigIntify(_state.liquidity),
      fee: this.feeCode,
      tickSpacing,
      maxLiquidityPerTick: bigIntify(_state.maxLiquidityPerTick),
      tickBitmap,
      ticks,
      observations,
      isValid: true,
      startTickBitmap,
      lowestKnownTick:
        (BigInt.asIntN(24, startTickBitmap - requestedRange) << 8n) *
        tickSpacing,
      highestKnownTick:
        ((BigInt.asIntN(24, startTickBitmap + requestedRange) << 8n) +
          BigInt.asIntN(24, 255n)) *
        tickSpacing,
      balance0,
      balance1,
    };
  }

  handleSwapEvent(
    event: any,
    pool: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const newSqrtPriceX96 = bigIntify(event.args.sqrtPriceX96);
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

      uniswapV3Math.swapFromEvent(
        pool,
        newSqrtPriceX96,
        newTick,
        newLiquidity,
        zeroForOne,
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

      return pool;
    }
  }

  handleBurnEvent(
    event: any,
    pool: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const amount = bigIntify(event.args.amount);
    const tickLower = bigIntify(event.args.tickLower);
    const tickUpper = bigIntify(event.args.tickUpper);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    uniswapV3Math._modifyPosition(pool, {
      tickLower,
      tickUpper,
      liquidityDelta: -BigInt.asIntN(128, BigInt.asIntN(256, amount)),
    });

    // From this transaction I conclude that there is no balance change from
    // Burn event: https://dashboard.tenderly.co/tx/mainnet/0xfccf5341147ac3ad0e66452273d12dfc3219e81f8fb369a6cdecfb24b9b9d078/logs
    // And it aligns with UniswapV3 doc:
    // https://github.com/Uniswap/v3-core/blob/05c10bf6d547d6121622ac51c457f93775e1df09/contracts/interfaces/pool/IUniswapV3PoolActions.sol#L59
    // It just updates positions and tokensOwed which may be requested calling collect
    // So, we don't need to update pool.balances0 and pool.balances1 here

    return pool;
  }

  handleMintEvent(
    event: any,
    pool: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const amount = bigIntify(event.args.amount);
    const tickLower = bigIntify(event.args.tickLower);
    const tickUpper = bigIntify(event.args.tickUpper);
    const amount0 = bigIntify(event.args.amount0);
    const amount1 = bigIntify(event.args.amount1);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    uniswapV3Math._modifyPosition(pool, {
      tickLower,
      tickUpper,
      liquidityDelta: amount,
    });

    pool.balance0 += amount0;
    pool.balance1 += amount1;

    return pool;
  }

  handleSetFeeProtocolEvent(
    event: any,
    pool: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const feeProtocol0 = bigIntify(event.args.feeProtocol0New);
    const feeProtocol1 = bigIntify(event.args.feeProtocol1New);
    pool.slot0.feeProtocol = feeProtocol0 + (feeProtocol1 << 4n);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    return pool;
  }

  handleCollectEvent(
    event: any,
    pool: PoolState,
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
    pool: PoolState,
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

  handleIncreaseObservationCardinalityNextEvent(
    event: any,
    pool: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    pool.slot0.observationCardinalityNext = parseInt(
      event.args.observationCardinalityNextNew,
      10,
    );
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  protected _computePoolAddress(
    token0: Address,
    token1: Address,
    fee: bigint,
  ): Address {
    // https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol
    if (token0 > token1) [token0, token1] = [token1, token0];

    const encodedKey = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint24'],
        [token0, token1, BigInt.asUintN(24, fee)],
      ),
    );

    return ethers.utils.getCreate2Address(
      this.factoryAddress,
      encodedKey,
      this.poolInitCodeHash,
    );
  }
}
