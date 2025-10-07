import { UniswapV3EventPool } from '../../uniswap-v3-pool';
import {
  DecodedStateMultiCallResultWithRelativeBitmaps,
  DecodeStateMultiCallFunc,
  PoolState,
} from '../../types';
import { assert } from 'ts-essentials';
import { _reduceTickBitmap, _reduceTicks } from '../../contract-math/utils';
import { bigIntify } from '../../../../utils';
import { TickBitMap } from '../../contract-math/TickBitMap';
import { uint24ToBigInt } from '../../../../lib/decoders';
import { Interface } from 'ethers/lib/utils';
import RamsesV2PoolABI from '../../../../abi/ramses-v2/RamsesV2Pool.abi.json';
import { IDexHelper } from '../../../../dex-helper';
import { Contract } from 'web3-eth-contract';
import { Address, Logger } from '../../../../types';

export class RamsesV2EventPool extends UniswapV3EventPool {
  public readonly poolIface = new Interface(RamsesV2PoolABI);

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
  ) {
    super(
      dexHelper,
      parentName,
      stateMultiContract,
      decodeStateMultiCallResultWithRelativeBitmaps,
      erc20Interface,
      factoryAddress,
      feeCode,
      token0,
      token1,
      logger,
      mapKey,
      poolInitCodeHash,
    );

    this.handlers['FeeAdjustment'] = this.handleFeeAdjustmentEvent.bind(this);
  }

  handleFeeAdjustmentEvent(event: any, pool: PoolState): PoolState {
    const newFee = bigIntify(event.args.newFee);

    pool.fee = newFee;

    return pool;
  }

  async generateState(blockNumber: number): Promise<Readonly<PoolState>> {
    const callData = this._getStateRequestCallData();

    const calldataWithFee = [
      ...callData,
      {
        target: this.poolAddress,
        callData: this.poolIface.encodeFunctionData('currentFee'),
        decodeFunction: uint24ToBigInt,
      },
    ];

    this._stateRequestCallData = calldataWithFee;

    const [resBalance0, resBalance1, resState, resCurrentFee] =
      await this.dexHelper.multiWrapper.tryAggregate<
        bigint | DecodedStateMultiCallResultWithRelativeBitmaps
      >(
        false,
        calldataWithFee,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    assert(resState.success, 'Pool does not exist');

    const [balance0, balance1, _state, fee] = [
      resBalance0.returnData,
      resBalance1.returnData,
      resState.returnData,
      resCurrentFee.returnData,
    ] as [
      bigint,
      bigint,
      DecodedStateMultiCallResultWithRelativeBitmaps,
      bigint,
    ];

    this._assertActivePool(_state);

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
      fee,
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
}
