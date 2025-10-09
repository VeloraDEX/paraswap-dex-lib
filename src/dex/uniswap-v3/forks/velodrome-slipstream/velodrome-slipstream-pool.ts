import { UniswapV3EventPool } from '../../uniswap-v3-pool';
import { Interface } from 'ethers/lib/utils';
import VelodromeSlipstreamPoolABI from '../../../../abi/velodrome-slipstream/VelodromeSlipstreamPool.abi.json';
import VelodromeSlipstreamFactoryABI from '../../../../abi/velodrome-slipstream/VelodromeSlipstreamFactory.abi.json';
import { MultiCallParams } from '../../../../lib/multi-wrapper';
import {
  DecodedStateMultiCallResultWithRelativeBitmaps,
  PoolState,
} from '../../types';
import { uint24ToBigInt, uint256ToBigInt } from '../../../../lib/decoders';
import { decodeStateMultiCallResultWithRelativeBitmaps } from './utils';
import { Address, BlockHeader, Log } from '../../../../types';
import { assert, DeepReadonly } from 'ts-essentials';
import { _reduceTickBitmap, _reduceTicks } from '../../contract-math/utils';
import { bigIntify } from '../../../../utils';
import { TickBitMap } from '../../contract-math/TickBitMap';
import { ethers } from 'ethers';

export class VelodromeSlipstreamEventPool extends UniswapV3EventPool {
  public readonly poolIface = new Interface(VelodromeSlipstreamPoolABI);
  public readonly factoryIface = new Interface(VelodromeSlipstreamFactoryABI);

  protected async processBlockLogs(
    state: DeepReadonly<PoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const newState = await super.processBlockLogs(state, logs, blockHeader);
    const fee = await this.getCurrentFee(blockHeader.number);

    if (newState && newState.fee !== fee) {
      const state = { ...newState };
      state.fee = fee;

      return state;
    }

    return newState;
  }

  private async getCurrentFee(blockNumber: number): Promise<bigint> {
    try {
      const [result] = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        [
          {
            target: this.factoryAddress,
            callData: this.factoryIface.encodeFunctionData('getSwapFee', [
              this.poolAddress,
            ]),
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
        `VelodromeSlipstream: Failed to fetch fee for pool ${this.poolAddress}:`,
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
          target: this.factoryAddress,
          callData: this.factoryIface.encodeFunctionData('getSwapFee', [
            this.poolAddress,
          ]),
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

    // Quite ugly solution, but this is the one that fits to current flow.
    // I think UniswapV3 callbacks subscriptions are complexified for no reason.
    // Need to be revisited later
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
        feeProtocol: this.feeCode,
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

  private predictDeterministicAddress(
    factory: string,
    implementation: string,
    salt: string,
  ) {
    const creationCode = [
      '0x3d602d80600a3d3981f3363d3d373d3d3d363d73', // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol#L110
      implementation.replace(/0x/, '').toLowerCase(),
      '5af43d82803e903d91602b57fd5bf3', // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/proxy/Clones.sol#L108
    ].join('');

    return ethers.utils.getCreate2Address(
      factory,
      salt,
      ethers.utils.keccak256(creationCode),
    ) as Address;
  }

  protected _computePoolAddress(
    token0: Address,
    token1: Address,
    fee: bigint,
  ): Address {
    if (token0 > token1) [token0, token1] = [token1, token0];

    const encodedKey = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'int24'],
        [token0, token1, BigInt.asUintN(24, this.tickSpacing!)],
      ),
    );

    return this.predictDeterministicAddress(
      this.factoryAddress,
      this.poolInitCodeHash, // actually this is pool implementation address
      encodedKey,
    );
  }
}
