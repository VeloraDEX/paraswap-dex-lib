import { UniswapV3EventPool } from '../../uniswap-v3-pool';
import { MultiCallParams } from '../../../../lib/multi-wrapper';
import { DecodedStateMultiCallResultWithRelativeBitmaps } from '../../types';
import { uint256ToBigInt, uint24ToBigInt } from '../../../../lib/decoders';
import { PoolState } from '../../types';
import { decodeStateMultiCallResultWithRelativeBitmaps } from '../../utils';
import { assert } from 'ts-essentials';
import { _reduceTickBitmap, _reduceTicks } from '../../contract-math/utils';
import { bigIntify } from '../../../../utils';
import { TickBitMap } from '../../contract-math/TickBitMap';
import { Interface } from 'ethers/lib/utils';

const POOL_FEE_ABI = ['function fee() view returns (uint24)'];

export class RamsesV3EventPool extends UniswapV3EventPool {
  private readonly poolFeeIface = new Interface(POOL_FEE_ABI);

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
          target: this.poolAddress,
          callData: this.poolFeeIface.encodeFunctionData('fee'),
          decodeFunction: uint24ToBigInt,
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

  async generateState(blockNumber: number): Promise<Readonly<PoolState>> {
    const callData = this._getStateRequestCallData();

    const [resBalance0, resBalance1, resFee, resState] =
      await this.dexHelper.multiWrapper.tryAggregate<
        bigint | DecodedStateMultiCallResultWithRelativeBitmaps
      >(
        false,
        callData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    assert(resState.success, 'Pool does not exist');

    const [balance0, balance1, fee, _state] = [
      resBalance0.returnData,
      resBalance1.returnData,
      resFee.returnData,
      resState.returnData,
    ] as [
      bigint,
      bigint,
      bigint,
      DecodedStateMultiCallResultWithRelativeBitmaps,
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
