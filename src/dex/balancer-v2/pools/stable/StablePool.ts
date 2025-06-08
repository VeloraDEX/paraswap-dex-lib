import { Interface } from 'ethers';
import StablePoolABI from '../../../../abi/balancer-v2/stable-pool.json';
import MetaStablePoolABI from '../../../../abi/balancer-v2/meta-stable-pool.json';
import { callData, PoolState, SubgraphPoolBase, TokenState } from '../../types';
import { decodeThrowError, getTokenScalingFactor } from '../../utils';
import { BigNumber } from '@ethersproject/bignumber';
import { SwapSide } from '../../../../constants';
import { BaseGeneralPool } from '../balancer-v2-pool';
import { StableMath } from './StableMath';

export type StablePoolPairData = {
  balances: bigint[];
  indexIn: number;
  indexOut: number;
  scalingFactors: bigint[];
  swapFee: bigint;
  amp: bigint;
};

export class StablePool extends BaseGeneralPool {
  vaultAddress: string;
  vaultInterface: Interface;
  poolInterface: Interface;
  metaPoolInterface: Interface;

  constructor(vaultAddress: string, vaultInterface: Interface) {
    super();
    this.vaultAddress = vaultAddress;
    this.vaultInterface = vaultInterface;
    this.poolInterface = new Interface(StablePoolABI);
    this.metaPoolInterface = new Interface(MetaStablePoolABI);
  }

  _onSwapGivenOut(
    tokenAmountsOut: bigint[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    _amplificationParameter: bigint,
  ): bigint[] {
    return StableMath._calcInGivenOut(
      _amplificationParameter,
      balances,
      indexIn,
      indexOut,
      tokenAmountsOut,
    );
  }

  _onSwapGivenIn(
    tokenAmountsIn: bigint[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    _amplificationParameter: bigint,
  ): bigint[] {
    return StableMath._calcOutGivenIn(
      _amplificationParameter,
      balances,
      indexIn,
      indexOut,
      tokenAmountsIn,
    );
  }

  /*
  Helper function to parse pool data into params for onSell/onBuy functions.
  */
  parsePoolPairData(
    pool: SubgraphPoolBase,
    poolState: PoolState,
    tokenIn: string,
    tokenOut: string,
  ): StablePoolPairData {
    let indexIn = 0,
      indexOut = 0;

    const scalingFactors: bigint[] = [];
    const balances = poolState.orderedTokens.map((tokenAddress, i) => {
      const t =
        pool.tokensMap[tokenAddress.toLowerCase()] ||
        poolState.tokens[tokenAddress.toLowerCase()];

      if (t.address.toLowerCase() === tokenIn.toLowerCase()) {
        indexIn = i;
      }
      if (t.address.toLowerCase() === tokenOut.toLowerCase()) {
        indexOut = i;
      }

      if (pool.poolType === 'MetaStable') {
        scalingFactors.push(
          poolState.tokens[t.address.toLowerCase()].scalingFactor || 0n,
        );
      } else scalingFactors.push(getTokenScalingFactor(t.decimals));
      return poolState.tokens[t.address.toLowerCase()].balance;
    });

    const poolPairData: StablePoolPairData = {
      balances,
      indexIn,
      indexOut,
      scalingFactors,
      swapFee: poolState.swapFee,
      amp: poolState.amp ? poolState.amp : 0n,
    };
    return poolPairData;
  }

  /*
  Helper function to construct onchain multicall data for StablePool.
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
        callData: this.poolInterface.encodeFunctionData(
          'getAmplificationParameter',
        ),
      },
    ];
    if (pool.poolType === 'MetaStable') {
      poolCallData.push({
        target: pool.address,
        callData:
          this.metaPoolInterface.encodeFunctionData('getScalingFactors'),
      });
    }
    return poolCallData;
  }

  /*
  Helper function to decodes multicall data for a Stable Pool.
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
    const amp = decodeThrowError(
      this.poolInterface,
      'getAmplificationParameter',
      data[startIndex++],
      pool.address,
    );
    let scalingFactors: BigNumber[] | undefined;
    if (pool.poolType === 'MetaStable') {
      scalingFactors = decodeThrowError(
        this.metaPoolInterface,
        'getScalingFactors',
        data[startIndex++],
        pool.address,
      )[0];
    }

    const poolState: PoolState = {
      swapFee: BigInt(swapFee.toString()),
      tokens: poolTokens.tokens.reduce(
        (ptAcc: { [address: string]: TokenState }, pt: string, j: number) => {
          const tokenState: TokenState = {
            balance: BigInt(poolTokens.balances[j].toString()),
          };

          if (scalingFactors)
            tokenState.scalingFactor = BigInt(scalingFactors[j].toString());

          ptAcc[pt.toLowerCase()] = tokenState;
          return ptAcc;
        },
        {},
      ),
      orderedTokens: poolTokens.tokens,
    };

    if (amp) {
      poolState.amp = BigInt(amp.value.toString());
    }

    pools[pool.address] = poolState;

    return [pools, startIndex];
  }

  /*
  For stable pools there is no Swap limit. As an approx - use almost the total balance of token out as we can add any amount of tokenIn and expect some back.
  */
  getSwapMaxAmount(poolPairData: StablePoolPairData, side: SwapSide): bigint {
    return (
      (this._upscale(
        poolPairData.balances[poolPairData.indexOut],
        poolPairData.scalingFactors[poolPairData.indexOut],
      ) *
        99n) /
      100n
    );
  }
}
