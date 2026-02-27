import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import { DeepReadonly, assert } from 'ts-essentials';
import { Address, BlockHeader, Log, Logger } from '../../types';
import { SwapSide } from '../../constants';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AlgebraIntegralPoolState } from './types';
import { OutputResult } from '../uniswap-v3/types';
import AlgebraIntegralPoolABI from '../../abi/algebra-integral/AlgebraIntegralPool.abi.json';
import { OUT_OF_RANGE_ERROR_POSTFIX } from '../uniswap-v3/constants';
import {
  addressDecode,
  uint16ToBigInt,
  uint256ToBigInt,
} from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { AlgebraMath } from '../algebra/lib/AlgebraMath';
import { TickTable } from '../algebra/lib/TickTable';
import {
  _reduceTickBitmap,
  _reduceTicks,
} from '../uniswap-v3/contract-math/utils';
import { PoolStateV1_1 } from '../algebra/types';
import {
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_TO_USE_BY_CHAIN,
} from './constants';
import { DecodedStateMultiCallResultIntegral } from './types';
import { decodeStateMultiCallResultIntegral } from './utils';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class AlgebraIntegralEventPool extends StatefulEventSubscriber<AlgebraIntegralPoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: AlgebraIntegralPoolState,
      log: Readonly<Log>,
      blockHeader: BlockHeader,
    ) => AlgebraIntegralPoolState | null;
  } = {};

  logDecoder: (log: Log) => any;

  readonly poolAddress: Address;
  readonly token0: Address;
  readonly token1: Address;

  public readonly poolIface = new Interface(AlgebraIntegralPoolABI);

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    readonly stateMulticallIface: Interface,
    readonly stateMulticallAddress: Address,
    readonly erc20Interface: Interface,
    token0: Address,
    token1: Address,
    logger: Logger,
    mapKey: string,
    poolAddress: Address,
  ) {
    super(parentName, `${token0}_${token1}`, dexHelper, logger, false, mapKey);
    this.token0 = token0.toLowerCase();
    this.token1 = token1.toLowerCase();
    this.poolAddress = poolAddress.toLowerCase();

    this.logDecoder = (log: Log) => this.poolIface.parseLog(log);
    this.addressesSubscribed = [this.poolAddress, this.token0, this.token1];

    this.handlers['Fee'] = this.handleNewFee.bind(this);
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);
    this.handlers['Mint'] = this.handleMintEvent.bind(this);
    this.handlers['Burn'] = this.handleBurnEvent.bind(this);
    this.handlers['Flash'] = this.handleFlashEvent.bind(this);
    this.handlers['Collect'] = this.handleCollectEvent.bind(this);
    this.handlers['CommunityFee'] = this.handleCommunityFee.bind(this);
    this.handlers['TickSpacing'] = this.handleTickSpacing.bind(this);
    this.handlers['Skim'] = this.handleSkimEvent.bind(this);
    this.handlers['CommunityVault'] =
      this.handleCommunityVaultChange.bind(this);
  }

  protected getPoolIdentifierData() {
    return {
      token0: this.token0,
      token1: this.token1,
    };
  }

  protected async processBlockLogs(
    state: DeepReadonly<AlgebraIntegralPoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<AlgebraIntegralPoolState> | null> {
    const newState = await super.processBlockLogs(state, logs, blockHeader);
    if (newState && !newState.isValid) {
      return await this.generateState(blockHeader.number);
    }
    return newState;
  }

  protected processLog(
    state: DeepReadonly<AlgebraIntegralPoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<AlgebraIntegralPoolState> | null {
    const logAddress = log.address.toLowerCase();

    // Handle ERC20 Transfer events on token0/token1 (community fee payments)
    if (logAddress === this.token0 || logAddress === this.token1) {
      return this.processTransferLog(state, log, logAddress, blockHeader);
    }

    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        const _state = _.cloneDeep(state) as AlgebraIntegralPoolState;
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
              `${this.parentName}: Pool ${this.poolAddress} on ${this.dexHelper.config.data.network} is out of TickBitmap requested range. Re-query the state.`,
              e,
            );
          } else {
            this.logger.error(
              `${this.parentName}: Pool ${this.poolAddress}, ` +
                `network=${this.dexHelper.config.data.network}: Unexpected ` +
                `error while handling event on blockNumber=${blockHeader.number}, ` +
                `blockHash=${blockHeader.hash}`,
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
    return null;
  }

  private processTransferLog(
    state: DeepReadonly<AlgebraIntegralPoolState>,
    log: Readonly<Log>,
    logAddress: string,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<AlgebraIntegralPoolState> | null {
    if (
      log.topics[0] !== TRANSFER_TOPIC ||
      !state.communityVault ||
      log.topics.length < 3
    ) {
      return null;
    }

    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();

    if (from !== this.poolAddress || to !== state.communityVault) {
      return null;
    }

    const amount = BigInt(log.data);
    const _state = _.cloneDeep(state) as AlgebraIntegralPoolState;

    if (logAddress === this.token0) {
      _state.balance0 -= amount;
    } else {
      _state.balance1 -= amount;
    }
    _state.blockTimestamp = bigIntify(blockHeader.timestamp);

    return _state;
  }

  getBitmapRangeToRequest() {
    const networkId = this.dexHelper.config.data.network;
    const tickBitmapToUse =
      TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
    const tickBitmapBuffer =
      TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;
    return tickBitmapToUse + tickBitmapBuffer;
  }

  private async _fetchPoolState(
    blockNumber: number,
  ): Promise<
    [bigint, bigint, string, bigint, DecodedStateMultiCallResultIntegral]
  > {
    const callData: MultiCallParams<
      bigint | DecodedStateMultiCallResultIntegral | string | null
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
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('communityVault'),
        decodeFunction: addressDecode,
      },
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('fee'),
        decodeFunction: uint16ToBigInt,
      },
      {
        target: this.stateMulticallAddress,
        callData: this.stateMulticallIface.encodeFunctionData(
          'getFullStateWithRelativeBitmaps',
          [
            this.poolAddress,
            this.getBitmapRangeToRequest(),
            this.getBitmapRangeToRequest(),
          ],
        ),
        decodeFunction: decodeStateMultiCallResultIntegral,
      },
    ];

    const [resBalance0, resBalance1, resCommunityVault, resFee, resState] =
      await this.dexHelper.multiWrapper.tryAggregate<
        bigint | DecodedStateMultiCallResultIntegral | string | null
      >(false, callData, blockNumber);

    assert(
      resState.success && resState.returnData,
      `Pool ${this.poolAddress} does not exist or StateMulticall failed`,
    );

    const [balance0, balance1, _state] = [
      resBalance0.returnData,
      resBalance1.returnData,
      resState.returnData,
    ] as [bigint, bigint, DecodedStateMultiCallResultIntegral];

    const communityVault = resCommunityVault.success
      ? (resCommunityVault.returnData as string).toLowerCase()
      : '';

    const fee = resFee.success
      ? (resFee.returnData as bigint)
      : BigInt(_state.globalState.lastFee);

    return [balance0, balance1, communityVault, fee, _state];
  }

  async generateState(
    blockNumber: number,
  ): Promise<Readonly<AlgebraIntegralPoolState>> {
    const [balance0, balance1, communityVault, fee, _state] =
      await this._fetchPoolState(blockNumber);

    const tickBitmap = {};
    const ticks = {};
    _reduceTickBitmap(tickBitmap, _state.tickBitmap);
    _reduceTicks(ticks, _state.ticks);

    const currentTick = bigIntify(_state.globalState.tick);
    const startTickBitmap = TickTable.position(currentTick)[0];

    return {
      pool: _state.pool,
      blockTimestamp: bigIntify(_state.blockTimestamp),
      tickSpacing: bigIntify(_state.tickSpacing),
      globalState: {
        price: bigIntify(_state.globalState.price),
        tick: currentTick,
        fee,
        communityFeeToken0: BigInt(_state.globalState.communityFee),
        communityFeeToken1: BigInt(_state.globalState.communityFee),
      },
      liquidity: bigIntify(_state.liquidity),
      maxLiquidityPerTick: bigIntify(_state.maxLiquidityPerTick),
      tickBitmap,
      ticks,
      startTickBitmap,
      isValid: true,
      balance0,
      balance1,
      areTicksCompressed: false,
      communityVault,
    };
  }

  handleSwapEvent(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
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
    }

    const zeroForOne = amount0 > 0n;

    // Cast to PoolStateV1_1 for AlgebraMath compatibility
    AlgebraMath._calculateSwapAndLock(
      this.dexHelper.config.data.network,
      pool as unknown as PoolStateV1_1,
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

  handleMintEvent(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
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
      pool as unknown as PoolStateV1_1,
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
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    const bottomTick = bigIntify(event.args.bottomTick);
    const topTick = bigIntify(event.args.topTick);
    const amount = bigIntify(event.args.liquidityAmount);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);

    AlgebraMath._updatePositionTicksAndFees(
      this.dexHelper.config.data.network,
      pool as unknown as PoolStateV1_1,
      bottomTick,
      topTick,
      -BigInt.asIntN(128, BigInt.asIntN(256, amount)),
    );

    return pool;
  }

  handleNewFee(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    pool.globalState.fee = bigIntify(event.args.fee);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  handleCollectEvent(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
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
    pool: AlgebraIntegralPoolState,
    _log: Log,
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
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    const communityFee = bigIntify(event.args.communityFeeNew);
    pool.globalState.communityFeeToken0 = communityFee;
    pool.globalState.communityFeeToken1 = communityFee;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  handleTickSpacing(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    pool.tickSpacing = bigIntify(event.args.newTickSpacing);
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  handleCommunityVaultChange(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    pool.communityVault = event.args.newCommunityVault.toLowerCase();
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  handleSkimEvent(
    event: any,
    pool: AlgebraIntegralPoolState,
    _log: Log,
    blockHeader: BlockHeader,
  ) {
    const amount0 = bigIntify(event.args.amount0);
    const amount1 = bigIntify(event.args.amount1);
    pool.balance0 -= amount0;
    pool.balance1 -= amount1;
    pool.blockTimestamp = bigIntify(blockHeader.timestamp);
    return pool;
  }

  getOutputs(
    blockNumber: number,
    amounts: bigint[],
    zeroForOne: boolean,
    side: SwapSide,
  ): OutputResult | null {
    const state = this.getState(blockNumber);
    if (!state) {
      this.logger.warn(
        `${this.parentName}: pool ${this.poolAddress} has no state at block ${blockNumber} ` +
          `(stateBlockNumber=${this.getStateBlockNumber()}, isInitialized=${
            this.isInitialized
          })`,
      );
      return null;
    }
    if (!state.isValid) {
      this.logger.warn(
        `${this.parentName}: pool ${this.poolAddress} state is invalid at block ${blockNumber}`,
      );
      return null;
    }
    if (state.liquidity <= 0n) return null;

    const destTokenBalance = zeroForOne ? state.balance1 : state.balance0;

    try {
      const outputsResult = AlgebraMath.queryOutputs(
        this.dexHelper.config.data.network,
        state as unknown as DeepReadonly<PoolStateV1_1>,
        amounts,
        zeroForOne,
        side,
      );

      if (side === SwapSide.SELL) {
        if (outputsResult.outputs[0] > destTokenBalance) return null;
        for (let i = 0; i < outputsResult.outputs.length; i++) {
          if (outputsResult.outputs[i] > destTokenBalance) {
            outputsResult.outputs[i] = 0n;
            outputsResult.tickCounts[i] = 0;
          }
        }
      } else {
        if (amounts[0] > destTokenBalance) return null;
        for (let i = 0; i < amounts.length; i++) {
          if (amounts[i] > destTokenBalance) {
            outputsResult.outputs[i] = 0n;
            outputsResult.tickCounts[i] = 0;
          }
        }
      }

      return outputsResult;
    } catch (e) {
      this.logger.debug(
        `${this.parentName}: error in getOutputs for pool ${this.poolAddress}`,
        e,
      );
      return null;
    }
  }
}
