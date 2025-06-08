import { BigNumber } from '@ethersproject/bignumber';

import { BasePool } from '../balancer-v2-pool';
import { NULL_ADDRESS, SwapSide } from '../../../../constants';
import { decodeThrowError, getTokenScalingFactor } from '../../utils';
import { callData, SubgraphPoolBase, PoolState, TokenState } from '../../types';
import { MathSol } from '../../balancer-v2-math';
import {
  GyroEMaths,
  DerivedGyroEParams,
  GyroEParams,
  balancesFromTokenInOut,
  Vector2,
} from '@balancer-labs/sor';
import GyroEAbi from '../../../../abi/balancer-v2/gyro-e.abi.json';
import { Interface } from 'ethers';

// Swap Limit factor
const SWAP_LIMIT_FACTOR = BigInt('999999000000000000');

// All values should be normalised to 18 decimals. e.g. 1USDC = 1e18 not 1e6
export type GyroEPoolPairData = {
  balances: BigNumber[];
  tokenRates: bigint[];
  gyroParams: GyroEParams;
  gyroDerivedParams: DerivedGyroEParams;
  rateProviders: string[];
  indexIn: number;
  indexOut: number;
  swapFee: bigint;
  scalingFactors: bigint[];
  tokenInIsToken0: boolean;
};

export class GyroEPool extends BasePool {
  vaultAddress: string;
  vaultInterface: Interface;
  poolInterface = new Interface(GyroEAbi);

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
  ): GyroEPoolPairData {
    // All values should be normalised to 18 decimals. e.g. 1USDC = 1e18 not 1e6
    let indexIn = 0,
      indexOut = 0;
    const scalingFactors: bigint[] = [];
    const balances = pool.tokens.map((t, i) => {
      if (t.address.toLowerCase() === tokenIn.toLowerCase()) indexIn = i;
      else if (t.address.toLowerCase() === tokenOut.toLowerCase()) indexOut = i;
      const scalingFactor = getTokenScalingFactor(t.decimals);
      scalingFactors.push(scalingFactor);
      return BigNumber.from(
        this._upscale(
          BigInt(poolState.tokens[t.address.toLowerCase()].balance),
          scalingFactor,
        ),
      );
    });

    const tokenInIsToken0 = indexIn === 0;

    const tokenRates = poolState.tokenRates
      ? [poolState.tokenRates![0], poolState.tokenRates![1]]
      : [];

    const rateProviders = poolState.rateProviders ?? [];

    const poolPairData: GyroEPoolPairData = {
      gyroParams: poolState.gyroParams!,
      gyroDerivedParams: poolState.gyroDerivedParams!,
      tokenRates,
      rateProviders,
      balances,
      indexIn,
      indexOut,
      scalingFactors,
      swapFee: poolState.swapFee,
      tokenInIsToken0,
    };
    return poolPairData;
  }

  getSwapMaxAmount(poolPairData: GyroEPoolPairData, side: SwapSide): bigint {
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
      {
        target: pool.address,
        callData: this.poolInterface.encodeFunctionData('getECLPParams'),
      },
    ];

    // Only version 2 of GyroE uses token rates
    const v2Calls =
      pool.poolTypeVersion === 2
        ? [
            {
              target: pool.address,
              callData: this.poolInterface.encodeFunctionData('getTokenRates'),
            },
            {
              target: pool.address,
              callData: this.poolInterface.encodeFunctionData('rateProvider0'),
            },
            {
              target: pool.address,
              callData: this.poolInterface.encodeFunctionData('rateProvider1'),
            },
          ]
        : [];

    return [...poolCallData, ...v2Calls];
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

    const eclParams = decodeThrowError(
      this.poolInterface,
      'getECLPParams',
      data[startIndex++],
      pool.address,
    );

    let tokenRates;
    let rateProviders: string[] = [];
    if (pool.poolTypeVersion === 2) {
      tokenRates = decodeThrowError(
        this.poolInterface,
        'getTokenRates',
        data[startIndex++],
        pool.address,
      );
      tokenRates = tokenRates.map(t => BigInt(t.toString()));

      const rateProvider0 = decodeThrowError(
        this.poolInterface,
        'rateProvider0',
        data[startIndex++],
        pool.address,
      )[0];

      const rateProvider1 = decodeThrowError(
        this.poolInterface,
        'rateProvider1',
        data[startIndex++],
        pool.address,
      )[0];
      rateProviders = [rateProvider0, rateProvider1];
    }

    const poolState: PoolState = {
      gyroParams: eclParams.params,
      gyroDerivedParams: eclParams.d,
      swapFee: BigInt(swapFee.toString()),
      tokenRates,
      rateProviders,
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

  onSell(amounts: bigint[], poolPairData: GyroEPoolPairData): bigint[] {
    try {
      const scalingFactorTokenIn = this._scalingFactor(
        poolPairData.tokenInIsToken0,
        poolPairData,
      );
      const scalingFactorTokenOut = this._scalingFactor(
        !poolPairData.tokenInIsToken0,
        poolPairData,
      );
      const normalizedBalances = this._normalizeBalances(
        poolPairData.balances,
        poolPairData.tokenRates,
      );

      const orderedNormalizedBalances = balancesFromTokenInOut(
        normalizedBalances[poolPairData.indexIn],
        normalizedBalances[poolPairData.indexOut],
        poolPairData.tokenInIsToken0,
      );

      const [currentInvariant, invErr] = GyroEMaths.calculateInvariantWithError(
        orderedNormalizedBalances,
        poolPairData.gyroParams,
        poolPairData.gyroDerivedParams,
      );

      const invariant: Vector2 = {
        x: currentInvariant.add(invErr.mul(2)),
        y: currentInvariant,
      };

      const tokenAmountsInScaled = amounts.map(a =>
        this._upscale(a, scalingFactorTokenIn),
      );

      const tokenAmountsInWithFee = tokenAmountsInScaled.map(a =>
        this._subtractSwapFeeAmount(a, poolPairData.swapFee),
      );

      const amountsOut: bigint[] = tokenAmountsInWithFee.map(amount => {
        try {
          const amountOut = GyroEMaths.calcOutGivenIn(
            orderedNormalizedBalances,
            BigNumber.from(amount),
            poolPairData.tokenInIsToken0,
            poolPairData.gyroParams,
            poolPairData.gyroDerivedParams,
            invariant,
          ).toBigInt();

          return this._downscaleDown(amountOut, scalingFactorTokenOut);
        } catch (error) {
          return BigInt(0);
        }
      });

      return amountsOut;
    } catch (error) {
      return [];
    }
  }

  onBuy(amounts: bigint[], poolPairData: GyroEPoolPairData): bigint[] {
    try {
      const scalingFactorTokenIn = this._scalingFactor(
        poolPairData.tokenInIsToken0,
        poolPairData,
      );
      const scalingFactorTokenOut = this._scalingFactor(
        !poolPairData.tokenInIsToken0,
        poolPairData,
      );

      const normalizedBalances = this._normalizeBalances(
        poolPairData.balances,
        poolPairData.tokenRates,
      );

      const orderedNormalizedBalances = balancesFromTokenInOut(
        normalizedBalances[poolPairData.indexIn],
        normalizedBalances[poolPairData.indexOut],
        poolPairData.tokenInIsToken0,
      );

      const [currentInvariant, invErr] = GyroEMaths.calculateInvariantWithError(
        orderedNormalizedBalances,
        poolPairData.gyroParams,
        poolPairData.gyroDerivedParams,
      );

      const invariant: Vector2 = {
        x: currentInvariant.add(invErr.mul(2)),
        y: currentInvariant,
      };

      const tokenAmountsOutScaled = amounts.map(a =>
        this._upscale(a, scalingFactorTokenOut),
      );

      const amountsIn: bigint[] = tokenAmountsOutScaled.map(amount => {
        try {
          const amountIn = GyroEMaths.calcInGivenOut(
            orderedNormalizedBalances,
            BigNumber.from(amount),
            poolPairData.tokenInIsToken0,
            poolPairData.gyroParams,
            poolPairData.gyroDerivedParams,
            invariant,
          ).toBigInt();
          return amountIn;
        } catch (error) {
          return BigInt(0);
        }
      });

      const downScaled = amountsIn.map(amount =>
        this._downscaleUp(amount, scalingFactorTokenIn),
      );

      return downScaled.map(a => this._addFeeAmount(a, poolPairData.swapFee));
    } catch (error) {
      return [];
    }
  }

  private _scalingFactor(
    token0: boolean,
    poolPairData: GyroEPoolPairData,
  ): bigint {
    const tokenIndex = token0 ? 0 : 1;
    const scalingFactor = poolPairData.scalingFactors[tokenIndex];
    if (
      poolPairData.rateProviders.length === 0 ||
      poolPairData.rateProviders[tokenIndex].toLowerCase() === NULL_ADDRESS
    ) {
      return scalingFactor;
    } else {
      return MathSol.mulDownFixed(
        scalingFactor,
        poolPairData.tokenRates[tokenIndex],
      );
    }
  }

  private _normalizeBalances(
    balances: BigNumber[],
    tokenRates: bigint[],
  ): BigNumber[] {
    // If pool is V1, e.g. has no tokenRates return balances
    if (tokenRates.length === 0) return balances;
    /*
    Apply tokenRates
    SOR upscales here first using scalingFactors but this is already being done in parse pair data so no need to repeat.
    */
    return balances.map((bal, i) => {
      return BigNumber.from(
        MathSol.mulDownFixed(bal.toBigInt(), tokenRates[i]),
      );
    });
  }
}
