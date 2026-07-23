import { ethers } from 'ethers';
import { VelodromeSlipstreamEventPool } from '../velodrome-slipstream/velodrome-slipstream-pool';
import { Address } from '@paraswap/core';
import { MultiCallParams } from '../../../../lib/multi-wrapper';
import {
  DecodedStateMultiCallResultWithRelativeBitmaps,
  PoolState,
} from '../../types';
import { uint24ToBigInt, uint256ToBigInt } from '../../../../lib/decoders';
import { decodeStateMultiCallResultWithRelativeBitmaps } from './utils';
import { Interface } from '@ethersproject/abi';
import PharaohV3PoolABI from '../../../../abi/pharaoh-v3/PharaohV3Pool.abi.json';
import PharaohV3FactoryABI from '../../../../abi/pharaoh-v3/PharaohV3Factory.abi.json';
import { assert } from 'ts-essentials';
import { _reduceTickBitmap, _reduceTicks } from '../../contract-math/utils';
import { TickBitMap } from '../../contract-math/TickBitMap';
import { bigIntify } from '../../../../utils';

const PHARAOH_V3_POOL_INIT_CODE_HASH =
  '0x892f127ed4b26ca352056c8fb54585a3268f76f97fdd84d5836ef4bda8d8c685';

export class PharaohV3EventPool extends VelodromeSlipstreamEventPool {
  public readonly poolIface = new Interface(PharaohV3PoolABI);
  public readonly factoryIface = new Interface(PharaohV3FactoryABI);

  protected async getCurrentFee(blockNumber: number): Promise<bigint> {
    try {
      const [result] = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        [
          {
            target: this.poolAddress,
            callData: this.poolIface.encodeFunctionData('fee', []),
            decodeFunction: uint24ToBigInt,
          },
        ],
        blockNumber,
      );

      if (result.success) {
        return result.returnData;
      }
    } catch (error) {
      this.logger.error(
        `PharaohV3: Failed to fetch fee for pool ${this.poolAddress}:`,
        error,
      );
    }
    return this.feeCode;
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
          target: this.poolAddress,
          callData: this.poolIface.encodeFunctionData('fee', []),
          decodeFunction: uint24ToBigInt,
        },
        {
          target: this.stateMultiContract.options.address,
          callData: this.stateMultiContract.methods
            .getFullStateWithRelativeBitmaps(
              this.factoryAddress,
              this.token0,
              this.token1,
              this.tickSpacing,
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

    const [resBalance0, resBalance1, resSwapFee, resState] =
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
      resSwapFee.returnData,
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
      fee,
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

  protected predictDeterministicAddress(
    factory: string,
    implementation: string,
    salt: string,
  ) {
    const address = ethers.utils.getCreate2Address(
      this.deployer ?? '',
      salt,
      PHARAOH_V3_POOL_INIT_CODE_HASH,
    ) as Address;

    return address;
  }
}
