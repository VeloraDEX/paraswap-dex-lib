import { BigNumber } from '@ethersproject/bignumber';

import { BasePool } from '../balancer-v2-pool';
import { SwapSide } from '../../../../constants';
import {
  decodeThrowError,
  getTokenScalingFactor,
  safeParseFixed,
} from '../../utils';
import { callData, SubgraphPoolBase, PoolState, TokenState } from '../../types';
import { MathSol } from '../../balancer-v2-math';
import { Gyro3Maths } from '@balancer-labs/sor';
import { _addFee, _reduceFee } from './gyro-helpers';
import { Interface } from 'ethers';

// Swap Limit factor
const SWAP_LIMIT_FACTOR = BigInt('999999000000000000');

// All values should be normalised to 18 decimals. e.g. 1USDC = 1e18 not 1e6
export type Gyro3PoolPairData = {
  balances: BigNumber[];
  indexIn: number;
  indexOut: number;
  swapFee: bigint;
  balanceTertiary: BigNumber; // Balance of the unchanged asset
  decimalsTertiary: number; // Decimals of the unchanged asset
  scalingFactors: bigint[];
  root3Alpha: BigNumber;
};

export class Gyro3Pool extends BasePool {
  vaultAddress: string;
  vaultInterface: Interface;
  poolInterface = new Interface([
    'function getSwapFeePercentage() view returns (uint256)',
  ]);

  constructor(vaultAddress: string, vaultInterface: Interface) {
    super();
    this.vaultAddress = vaultAddress;
    this.vaultInterface = vaultInterface;
  }

  parsePoolPairData(
    pool: SubgraphPoolBase,
    poolState: PoolState,
    tokenIn: string,
    tokenOut: string,
  ): Gyro3PoolPairData {
    // All values should be normalised to 18 decimals. e.g. 1USDC = 1e18 not 1e6
    let indexIn = 0,
      indexOut = 0,
      indexTertiary = 0;
    const scalingFactors: bigint[] = [];
    const balances = pool.tokens.map((t, i) => {
      if (t.address.toLowerCase() === tokenIn.toLowerCase()) {
        indexIn = i;
      } else if (t.address.toLowerCase() === tokenOut.toLowerCase()) {
        indexOut = i;
      } else {
        indexTertiary = i;
      }

      const scalingFactor = getTokenScalingFactor(t.decimals);
      scalingFactors.push(scalingFactor);

      return BigNumber.from(
        this._upscale(
          BigInt(poolState.tokens[t.address.toLowerCase()].balance),
          scalingFactor,
        ),
      );
    });

    const balanceTertiary = balances[indexTertiary];
    const decimalsTertiary = pool.tokens[indexTertiary].decimals;

    const poolPairData: Gyro3PoolPairData = {
      balances,
      indexIn,
      indexOut,
      scalingFactors,
      swapFee: poolState.swapFee,
      balanceTertiary,
      decimalsTertiary,
      root3Alpha: safeParseFixed(pool.root3Alpha, 18),
    };

    return poolPairData;
  }

  getSwapMaxAmount(poolPairData: Gyro3PoolPairData, side: SwapSide): bigint {
    if (side === SwapSide.SELL) {
      // Approximation - similar to traditional stable pools
      return this._downscaleDown(
        MathSol.mulDownFixed(
          poolPairData.balances[poolPairData.indexOut].toBigInt(),
          SWAP_LIMIT_FACTOR,
        ),
        poolPairData.scalingFactors[poolPairData.indexIn],
      );
    } else {
      return this._downscaleDown(
        MathSol.mulDownFixed(
          poolPairData.balances[poolPairData.indexIn].toBigInt(),
          SWAP_LIMIT_FACTOR,
        ),
        poolPairData.scalingFactors[poolPairData.indexOut],
      );
    }
  }

  /*
  Helper function to construct onchain multicall data for Pool.
  */
  getOnChainCalls(pool: SubgraphPoolBase): callData[] {
    const poolCallData: callData[] = [
      {
        target: this.vaultAddress,
        callData: this.vaultInterface.encodeFunctionData('getPoolTokens', [
          pool.id,
        ]),
      },
      {
        target: pool.address,
        callData: this.poolInterface.encodeFunctionData('getSwapFeePercentage'),
      },
    ];
    return poolCallData;
  }

  /*
  Helper function to decode multicall data for Pool.
  data must contain returnData
  startIndex is where to start in returnData. Allows this decode function to be called along with other pool types.
  */
  decodeOnChainCalls(
    pool: SubgraphPoolBase,
    data: { success: boolean; returnData: any }[],
    startIndex: number,
  ): [{ [address: string]: PoolState }, number] {
    const pools = {} as { [address: string]: PoolState };

    const poolTokens = decodeThrowError(
      this.vaultInterface,
      'getPoolTokens',
      data[startIndex++],
      pool.address,
    );
    const swapFee = decodeThrowError(
      this.poolInterface,
      'getSwapFeePercentage',
      data[startIndex++],
      pool.address,
    )[0];

    const poolState: PoolState = {
      swapFee: BigInt(swapFee.toString()),
      orderedTokens: poolTokens.tokens,
      tokens: poolTokens.tokens.reduce(
        (ptAcc: { [address: string]: TokenState }, pt: string, j: number) => {
          const tokenState: TokenState = {
            balance: BigInt(poolTokens.balances[j].toString()),
          };
          ptAcc[pt.toLowerCase()] = tokenState;
          return ptAcc;
        },
        {},
      ),
    };
    pools[pool.address] = poolState;
    return [pools, startIndex];
  }

  onSell(amounts: bigint[], poolPairData: Gyro3PoolPairData): bigint[] {
    try {
      const invariant = Gyro3Maths._calculateInvariant(
        poolPairData.balances,
        poolPairData.root3Alpha,
      );

      const virtualOffsetInOut = MathSol.mulDownFixed(
        invariant.toBigInt(),
        poolPairData.root3Alpha.toBigInt(),
      );

      const tokenAmountsInWithFee = amounts.map(a => {
        const withFee = _reduceFee(a, poolPairData.swapFee);
        return this._upscale(
          withFee,
          poolPairData.scalingFactors[poolPairData.indexIn],
        );
      });

      return tokenAmountsInWithFee.map(amount => {
        try {
          const amountOut = Gyro3Maths._calcOutGivenIn(
            poolPairData.balances[poolPairData.indexIn],
            poolPairData.balances[poolPairData.indexOut],
            BigNumber.from(amount),
            BigNumber.from(virtualOffsetInOut),
          ).toBigInt();

          return this._downscaleDown(
            amountOut,
            poolPairData.scalingFactors[poolPairData.indexOut],
          );
        } catch (error) {
          return BigInt(0);
        }
      });
    } catch (error) {
      return [];
    }
  }

  onBuy(amounts: bigint[], poolPairData: Gyro3PoolPairData): bigint[] {
    try {
      const invariant = Gyro3Maths._calculateInvariant(
        poolPairData.balances,
        poolPairData.root3Alpha,
      );

      const virtualOffsetInOut = MathSol.mulDownFixed(
        invariant.toBigInt(),
        poolPairData.root3Alpha.toBigInt(),
      );

      const tokenAmountsUpscaled = amounts.map(a =>
        this._upscale(a, poolPairData.scalingFactors[poolPairData.indexOut]),
      );

      return tokenAmountsUpscaled.map(amount => {
        try {
          const amountIn = Gyro3Maths._calcInGivenOut(
            poolPairData.balances[poolPairData.indexIn],
            poolPairData.balances[poolPairData.indexOut],
            BigNumber.from(amount),
            BigNumber.from(virtualOffsetInOut),
          ).toBigInt();

          const downScaledAmount = this._downscaleUp(
            amountIn,
            poolPairData.scalingFactors[poolPairData.indexIn],
          );
          return _addFee(downScaledAmount, poolPairData.swapFee);
        } catch (error) {
          return BigInt(0);
        }
      });
    } catch (error) {
      return [];
    }
  }
}
