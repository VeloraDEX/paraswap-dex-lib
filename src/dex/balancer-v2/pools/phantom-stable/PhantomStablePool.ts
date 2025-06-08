import { Interface } from 'ethers';
import { BasePool } from '../balancer-v2-pool';
import { isSameAddress, decodeThrowError } from '../../utils';
import * as PhantomStableMath from './PhantomStableMath';
import { SubgraphPoolBase, PoolState, callData } from '../../types';
import { SwapSide } from '../../../../constants';
import MetaStablePoolABI from '../../../../abi/balancer-v2/meta-stable-pool.json';
import ComposableStablePoolABI from '../../../../abi/balancer-v2/ComposableStable.json';
import { keyBy } from 'lodash';

enum PairTypes {
  BptToToken,
  TokenToBpt,
  TokenToToken,
}

type PhantomStablePoolPairData = {
  tokens: string[];
  balances: bigint[];
  indexIn: number;
  indexOut: number;
  scalingFactors: bigint[];
  bptIndex: number;
  swapFee: bigint;
  amp: bigint;
  actualSupply: bigint | undefined;
};

/*
/**
 * StablePool with preminted BPT and rate providers for each token, allowing for e.g. wrapped tokens with a known
 * price ratio, such as Compound's cTokens.
 * BPT is preminted on Pool initialization and registered as one of the Pool's tokens, allowing for swaps to behave as
 * single-token joins or exits (by swapping a token for BPT). Regular joins and exits are disabled, since no BPT is
 * minted or burned after initialization.
 * Preminted BPT is sometimes called Phantom BPT, as the preminted BPT (which is deposited in the Vault as balance of
 * the Pool) doesn't belong to any entity until transferred out of the Pool. The Pool's arithmetic behaves as if it
 * didn't exist, and the BPT total supply is not a useful value: we rely on the 'virtual supply' (how much BPT is
 * actually owned by some entity) instead.
 */
export class PhantomStablePool extends BasePool {
  // This is the maximum token amount the Vault can hold. In regular operation, the total BPT supply remains constant
  // and equal to _INITIAL_BPT_SUPPLY, but most of it remains in the Pool, waiting to be exchanged for tokens. The
  // actual amount of BPT in circulation is the total supply minus the amount held by the Pool, and is known as the
  // 'virtual supply'.
  MAX_TOKEN_BALANCE = 2n ** 112n - 1n;
  vaultAddress: string;
  vaultInterface: Interface;
  poolInterface: Interface;

  constructor(
    vaultAddress: string,
    vaultInterface: Interface,
    private isComposable = false,
  ) {
    super();
    this.vaultAddress = vaultAddress;
    this.vaultInterface = vaultInterface;
    if (isComposable)
      this.poolInterface = new Interface(ComposableStablePoolABI);
    else this.poolInterface = new Interface(MetaStablePoolABI);
  }

  /*
    scaling factors should include rate:
    i.e.
    scalingFactors: pool.tokens.map(({ decimals, priceRate }) =>
        MathSol.mulDownFixed(getTokenScalingFactor(decimals), priceRate)
    )
    */
  onSell(amounts: bigint[], poolPairData: PhantomStablePoolPairData): bigint[] {
    return this._swapGivenIn(
      amounts,
      poolPairData.tokens,
      poolPairData.balances,
      poolPairData.indexIn,
      poolPairData.indexOut,
      poolPairData.bptIndex,
      poolPairData.scalingFactors,
      poolPairData.swapFee,
      poolPairData.amp,
      poolPairData.actualSupply,
    );
  }

  onBuy(amounts: bigint[], poolPairData: PhantomStablePoolPairData): bigint[] {
    return this._swapGivenOut(
      amounts,
      poolPairData.tokens,
      poolPairData.balances,
      poolPairData.indexIn,
      poolPairData.indexOut,
      poolPairData.bptIndex,
      poolPairData.scalingFactors,
      poolPairData.swapFee,
      poolPairData.amp,
      poolPairData.actualSupply,
    );
  }

  // StablePool's `_onSwapGivenIn` and `_onSwapGivenOut` handlers are meant to process swaps between Pool tokens.
  // Since one of the Pool's tokens is the preminted BPT, we need to a) handle swaps where that tokens is involved
  // separately (as they are effectively single-token joins or exits), and b) remove BPT from the balances array when
  // processing regular swaps before delegating those to StablePool's handler.
  removeBPT(
    balances: bigint[],
    tokenIndexIn: number,
    tokenIndexOut: number,
    bptIndex: number,
  ): {
    balances: bigint[];
    indexIn: number;
    indexOut: number;
  } {
    if (bptIndex !== -1) {
      balances.splice(bptIndex, 1);
      if (bptIndex < tokenIndexIn) tokenIndexIn -= 1;
      if (bptIndex < tokenIndexOut) tokenIndexOut -= 1;
    }
    return {
      balances,
      indexIn: tokenIndexIn,
      indexOut: tokenIndexOut,
    };
  }

  _swapGivenOut(
    tokenAmountsOut: bigint[],
    tokens: string[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    bptIndex: number,
    scalingFactors: bigint[],
    swapFeePercentage: bigint,
    amplificationParameter: bigint,
    actualSupply: bigint | undefined,
  ) {
    // Phantom pools allow trading between token and pool BPT
    let pairType: PairTypes;
    if (isSameAddress(tokens[indexIn], tokens[bptIndex])) {
      pairType = PairTypes.BptToToken;
    } else if (isSameAddress(tokens[indexOut], tokens[bptIndex])) {
      pairType = PairTypes.TokenToBpt;
    } else {
      pairType = PairTypes.TokenToToken;
    }

    const balancesUpscaled = this._upscaleArray(balances, scalingFactors);
    const tokenAmountsOutScaled = tokenAmountsOut.map(a =>
      this._upscale(a, scalingFactors[indexOut]),
    );

    let bptSupply: bigint;
    if (actualSupply) bptSupply = actualSupply;
    // VirtualBPTSupply must be used for the maths
    else bptSupply = this.MAX_TOKEN_BALANCE - balances[bptIndex];

    const droppedBpt = this.removeBPT(
      balancesUpscaled,
      indexIn,
      indexOut,
      bptIndex,
    );

    const amountsIn = this._onSwapGivenOut(
      tokenAmountsOutScaled,
      droppedBpt.balances,
      droppedBpt.indexIn,
      droppedBpt.indexOut,
      amplificationParameter,
      bptSupply,
      pairType,
    );

    const amountsInDownscaled = amountsIn.map(a =>
      this._downscaleUp(a, scalingFactors[indexIn]),
    );

    return amountsInDownscaled.map(a =>
      this._addFeeAmount(a, swapFeePercentage),
    );
  }

  _swapGivenIn(
    tokenAmountsIn: bigint[],
    tokens: string[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    bptIndex: number,
    scalingFactors: bigint[],
    swapFeePercentage: bigint,
    amplificationParameter: bigint,
    actualSupply: bigint | undefined,
  ): bigint[] {
    // Phantom pools allow trading between token and pool BPT
    let pairType: PairTypes;
    if (isSameAddress(tokens[indexIn], tokens[bptIndex])) {
      pairType = PairTypes.BptToToken;
    } else if (isSameAddress(tokens[indexOut], tokens[bptIndex])) {
      pairType = PairTypes.TokenToBpt;
    } else {
      pairType = PairTypes.TokenToToken;
    }

    // Fees are subtracted before scaling, to reduce the complexity of the rounding direction analysis.
    const tokenAmountsInWithFee = tokenAmountsIn.map(a =>
      this._subtractSwapFeeAmount(a, swapFeePercentage),
    );

    const balancesUpscaled = this._upscaleArray(balances, scalingFactors);
    const tokenAmountsInScaled = tokenAmountsInWithFee.map(a =>
      this._upscale(a, scalingFactors[indexIn]),
    );

    let bptSupply: bigint;
    if (actualSupply) bptSupply = actualSupply;
    // VirtualBPTSupply must be used for the maths
    else bptSupply = this.MAX_TOKEN_BALANCE - balances[bptIndex];

    const droppedBpt = this.removeBPT(
      balancesUpscaled,
      indexIn,
      indexOut,
      bptIndex,
    );

    const amountsOut = this._onSwapGivenIn(
      tokenAmountsInScaled,
      droppedBpt.balances,
      droppedBpt.indexIn,
      droppedBpt.indexOut,
      amplificationParameter,
      bptSupply,
      pairType,
    );

    // amountOut tokens are exiting the Pool, so we round down.
    return amountsOut.map(a =>
      this._downscaleDown(a, scalingFactors[indexOut]),
    );
  }

  _onSwapGivenOut(
    tokenAmountsOut: bigint[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    _amplificationParameter: bigint,
    virtualBptSupply: bigint,
    pairType: PairTypes,
  ) {
    const invariant = PhantomStableMath._calculateInvariant(
      _amplificationParameter,
      balances,
      true,
    );

    const amountsIn: bigint[] = [];

    if (pairType === PairTypes.TokenToBpt) {
      tokenAmountsOut.forEach(amountOut => {
        let amt: bigint;
        try {
          const amountsInBigInt = Array(balances.length).fill(0n);
          amountsInBigInt[indexIn] = amountOut;

          amt = PhantomStableMath._calcTokenInGivenExactBptOut(
            _amplificationParameter,
            balances,
            indexIn,
            amountOut,
            virtualBptSupply,
            0n,
            invariant,
          );
        } catch (err) {
          amt = 0n;
        }
        amountsIn.push(amt);
      });
    } else if (pairType === PairTypes.BptToToken) {
      tokenAmountsOut.forEach(amountOut => {
        let amt: bigint;
        try {
          const amountsOutBigInt = Array(balances.length).fill(0n);
          amountsOutBigInt[indexOut] = amountOut;

          amt = PhantomStableMath._calcBptInGivenExactTokensOut(
            _amplificationParameter,
            balances,
            amountsOutBigInt,
            virtualBptSupply,
            0n,
            invariant,
          );
        } catch (err) {
          amt = 0n;
        }
        amountsIn.push(amt);
      });
    } else {
      tokenAmountsOut.forEach(amountOut => {
        let amt: bigint;
        try {
          amt = PhantomStableMath._calcInGivenOut(
            _amplificationParameter,
            balances,
            indexIn,
            indexOut,
            amountOut,
            0n,
            invariant,
          );
        } catch (err) {
          amt = 0n;
        }
        amountsIn.push(amt);
      });
    }
    return amountsIn;
  }

  /*
     Called when a swap with the Pool occurs, where the amount of tokens entering the Pool is known.
     All amounts are upscaled.
     Swap fee is already deducted.
     The return value is also considered upscaled, and should be downscaled (rounding down)
     */
  _onSwapGivenIn(
    tokenAmountsIn: bigint[],
    balances: bigint[],
    indexIn: number,
    indexOut: number,
    _amplificationParameter: bigint,
    virtualBptSupply: bigint,
    pairType: PairTypes,
  ): bigint[] {
    const invariant = PhantomStableMath._calculateInvariant(
      _amplificationParameter,
      balances,
      true,
    );

    const amountsOut: bigint[] = [];

    if (pairType === PairTypes.TokenToBpt) {
      tokenAmountsIn.forEach(amountIn => {
        let amt: bigint;
        try {
          const amountsInBigInt = Array(balances.length).fill(0n);
          amountsInBigInt[indexIn] = amountIn;

          amt = PhantomStableMath._calcBptOutGivenExactTokensIn(
            _amplificationParameter,
            balances,
            amountsInBigInt,
            virtualBptSupply,
            invariant,
          );
        } catch (err) {
          amt = 0n;
        }
        amountsOut.push(amt);
      });
    } else if (pairType === PairTypes.BptToToken) {
      tokenAmountsIn.forEach(amountIn => {
        let amt: bigint;
        try {
          amt = PhantomStableMath._calcTokenOutGivenExactBptIn(
            _amplificationParameter,
            balances,
            indexOut,
            amountIn,
            virtualBptSupply,
            invariant,
          );
        } catch (err) {
          amt = 0n;
        }
        amountsOut.push(amt);
      });
    } else {
      tokenAmountsIn.forEach(amountIn => {
        let amt: bigint;
        try {
          amt = PhantomStableMath._calcOutGivenIn(
            _amplificationParameter,
            balances,
            indexIn,
            indexOut,
            amountIn,
            invariant,
          );
        } catch (err) {
          amt = 0n;
        }
        amountsOut.push(amt);
      });
    }
    return amountsOut;
  }

  /*
    Helper function to parse pool data into params for onSell function.
    */
  parsePoolPairData(
    pool: SubgraphPoolBase,
    poolState: PoolState,
    tokenIn: string,
    tokenOut: string,
  ): PhantomStablePoolPairData {
    let indexIn = 0,
      indexOut = 0,
      bptIndex = 0;
    const balances: bigint[] = [];
    const scalingFactors: bigint[] = [];

    const tokens = poolState.orderedTokens.map((tokenAddress, i) => {
      const t = pool.tokensMap[tokenAddress.toLowerCase()];
      if (t.address.toLowerCase() === tokenIn.toLowerCase()) indexIn = i;
      if (t.address.toLowerCase() === tokenOut.toLowerCase()) indexOut = i;
      if (t.address.toLowerCase() === pool.address.toLowerCase()) bptIndex = i;

      balances.push(poolState.tokens[t.address.toLowerCase()].balance);
      scalingFactors.push(
        poolState.tokens[t.address.toLowerCase()].scalingFactor || 0n,
      );
      return t.address;
    });

    const poolPairData: PhantomStablePoolPairData = {
      tokens,
      balances,
      indexIn,
      indexOut,
      scalingFactors,
      bptIndex,
      swapFee: poolState.swapFee,
      amp: poolState.amp ? poolState.amp : 0n,
      actualSupply: poolState.actualSupply,
    };
    return poolPairData;
  }

  /*
  Helper function to construct onchain multicall data for PhantomStablePool.
  Main difference to standard StablePool is scaling factors which includes rate.
  This also applies to MetaStablePool.
  */
  getOnChainCalls(pool: SubgraphPoolBase): callData[] {
    const calls = [
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
        callData: this.poolInterface.encodeFunctionData('getScalingFactors'),
      },
      {
        target: pool.address,
        callData: this.poolInterface.encodeFunctionData(
          'getAmplificationParameter',
        ),
      },
    ];
    /**
     * Returns the effective BPT supply.
     * In other pools, this would be the same as `totalSupply`, but there are two key differences here:
     *  - this pool pre-mints BPT and holds it in the Vault as a token, and as such we need to subtract the Vault's
     *    balance to get the total "circulating supply". This is called the 'virtualSupply'.
     *  - the Pool owes debt to the Protocol in the form of unminted BPT, which will be minted immediately before the
     *    next join or exit. We need to take these into account since, even if they don't yet exist, they will
     *    effectively be included in any Pool operation that involves BPT.
     * In the vast majority of cases, this function should be used instead of `totalSupply()`.
     */
    if (this.isComposable)
      calls.push({
        target: pool.address,
        callData: this.poolInterface.encodeFunctionData('getActualSupply'),
      });

    return calls;
  }

  /*
  Helper function to decodes multicall data for a PhantomStable Pool.
  Main difference to standard StablePool is scaling factors which includes rate.
  This also applies to MetaStablePool.
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
    const scalingFactors = decodeThrowError(
      this.poolInterface,
      'getScalingFactors',
      data[startIndex++],
      pool.address,
    )[0];
    const amp = decodeThrowError(
      this.poolInterface,
      'getAmplificationParameter',
      data[startIndex++],
      pool.address,
    );

    const tokens = poolTokens.tokens.map((address: string, idx: number) => ({
      address: address.toLowerCase(),
      balance: BigInt(poolTokens.balances[idx].toString()),
      scalingFactor: BigInt(scalingFactors[idx].toString()),
    }));

    const poolState: PoolState = {
      swapFee: BigInt(swapFee.toString()),
      tokens: keyBy(tokens, 'address'),
      orderedTokens: poolTokens.tokens,
    };

    if (amp) {
      poolState.amp = BigInt(amp.value.toString());
    }

    if (this.isComposable) {
      const totalSupply = decodeThrowError(
        this.poolInterface,
        'getActualSupply',
        data[startIndex++],
        pool.address,
      );
      poolState.actualSupply = BigInt(totalSupply.toString());
    }

    pools[pool.address] = poolState;

    return [pools, startIndex];
  }

  /*
  For stable pools there is no Swap limit. As an approx - use almost the total balance of token out as we can add any amount of tokenIn and expect some back.
  */
  getSwapMaxAmount(
    poolPairData: PhantomStablePoolPairData,
    side: SwapSide,
  ): bigint {
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
