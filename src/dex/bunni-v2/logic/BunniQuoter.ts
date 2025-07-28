import { NULL_ADDRESS } from '../../../constants';
import { computeSwap } from '../hook/BunniSwapMath';
import { _hookletAfterSwapView, _hookletBeforeSwapView } from '../hooklet';
import { LDFType } from '../ldf/LDFType';
import { decodeAmAmmPayload } from '../lib/AmAmmPayload';
import {
  CURATOR_FEE_BASE,
  MAX_INT_128,
  MIN_INT_128,
  MODIFIER_BASE,
  SWAP_FEE_BASE,
  ZERO_BYTES_32,
} from '../lib/Constants';
import { computeDynamicSwapFee, computeSurgeFee } from '../lib/FeeMath';
import { abs, max, min, mulDiv, mulDivUp } from '../lib/Math';
import { queryLDF } from '../lib/QueryLDF';
import { queryTwap } from '../lib/QueryTwap';
import { TickMath } from '../lib/TickMath';
import { DexParams, PoolState, SwapParams, Vault } from '../types';
import { getTopBid } from './AmAmm';
import { _shouldSurgeFromVaults, decodeParams } from './BunniHookLogic';

export function quoteSwap(
  state: PoolState,
  params: SwapParams,
  blockNumber: bigint,
  blockTimestamp: bigint,
  hookFeesModifier: bigint,
  hookDeploymentBlock: bigint,
  K: bigint,
  vaults: { [address: string]: Vault },
  dexParams: DexParams,
): {
  success: boolean;
  updatedSqrtPriceX96: bigint;
  updatedTick: bigint;
  inputAmount: bigint;
  outputAmount: bigint;
  swapFee: bigint;
  totalLiquidity: bigint;
} {
  let {
    success,
    updatedSqrtPriceX96,
    updatedTick,
    inputAmount,
    outputAmount,
    swapFee,
    totalLiquidity,
  } = _falsyReturnValues();

  // get pool state
  let sqrtPriceX96 = state.slot0.sqrtPriceX96;
  let currentTick = state.slot0.tick;
  let lastSwapTimestamp = state.slot0.lastSwapTimestamp;
  let lastSurgeTimestamp = state.slot0.lastSurgeTimestamp;

  // hooklet call
  const {
    success: success_,
    feeOverridden,
    fee: feeOverride,
    priceOverridden,
    sqrtPriceX96: sqrtPriceX96Override,
  } = _hookletBeforeSwapView(state, params, dexParams);

  if (!success_) {
    return _falsyReturnValues();
  }

  // override price if needed
  if (priceOverridden) {
    sqrtPriceX96 = sqrtPriceX96Override;
    currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96Override);
  }

  // ensure swap makes sense
  if (
    sqrtPriceX96 === 0n ||
    (params.zeroForOne &&
      (params.sqrtPriceLimitX96 >= sqrtPriceX96 ||
        params.sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE)) ||
    (!params.zeroForOne &&
      (params.sqrtPriceLimitX96 <= sqrtPriceX96 ||
        params.sqrtPriceLimitX96 >= TickMath.MAX_SQRT_PRICE)) ||
    params.amountSpecified > MAX_INT_128 ||
    params.amountSpecified < MIN_INT_128
  ) {
    return _falsyReturnValues();
  }

  // compute total token balances
  const [reserveBalance0, reserveBalance1] = [
    _getReservesInUnderlying(state.reserve0, state.vault0, vaults),
    _getReservesInUnderlying(state.reserve1, state.vault1, vaults),
  ];
  const [balance0, balance1] = [
    state.rawBalance0 + reserveBalance0,
    state.rawBalance1 + reserveBalance1,
  ];

  // if it's an exact output swap, exit if the requested output is greater than the balance
  const exactIn: boolean = params.amountSpecified < 0n;
  if (
    !exactIn &&
    -params.amountSpecified > (params.zeroForOne ? balance1 : balance0)
  ) {
    return _falsyReturnValues();
  }

  // decode hook params
  const hookParams = decodeParams(state.hookParams);

  // get TWAP values
  const arithmeticMeanTick =
    state.twapSecondsAgo !== 0n
      ? queryTwap(state, state.twapSecondsAgo, blockTimestamp)
      : 0n;
  const feeMeanTick =
    !feeOverridden && hookParams.feeTwapSecondsAgo !== 0n
      ? queryTwap(state, hookParams.feeTwapSecondsAgo, blockTimestamp)
      : 0n;

  // query the LDF to get total liquidity and token densities
  const ldfState =
    state.ldfType === LDFType.DYNAMIC_AND_STATEFUL
      ? state.ldfState
      : ZERO_BYTES_32;

  let {
    totalLiquidity: totalLiquidity_,
    liquidityDensityOfRoundedTickX96,
    activeBalance0: currentActiveBalance0,
    activeBalance1: currentActiveBalance1,
    shouldSurge,
  } = queryLDF(
    state.key,
    sqrtPriceX96,
    currentTick,
    arithmeticMeanTick,
    state.liquidityDensityFunction,
    state.ldfParams,
    ldfState,
    balance0,
    balance1,
    state.idleBalance,
    dexParams,
  );
  shouldSurge = shouldSurge && state.ldfType !== LDFType.STATIC;
  totalLiquidity = totalLiquidity_;

  // ensure the current active balance of the requested output token is not zero
  if (
    (params.zeroForOne && currentActiveBalance1 === 0n) ||
    (!params.zeroForOne && currentActiveBalance0 === 0n) ||
    totalLiquidity === 0n ||
    (!exactIn &&
      abs(params.amountSpecified) >
        (params.zeroForOne ? currentActiveBalance1 : currentActiveBalance0))
  ) {
    return _falsyReturnValues();
  }

  // check surge based on vault share prices
  shouldSurge =
    shouldSurge ||
    _shouldSurgeFromVaults(state, hookParams, reserveBalance0, reserveBalance1);

  // compute swap result
  ({ updatedSqrtPriceX96, updatedTick, inputAmount, outputAmount } =
    computeSwap(
      {
        key: state.key,
        totalLiquidity,
        liquidityDensityOfRoundedTickX96,
        currentActiveBalance0,
        currentActiveBalance1,
        sqrtPriceX96,
        currentTick,
        liquidityDensityFunction: state.liquidityDensityFunction,
        arithmeticMeanTick,
        ldfParams: state.ldfParams,
        ldfState,
        swapParams: params,
      },
      dexParams,
    ));

  // exit if it's an exact output swap and outputAmount < params.amountSpecified
  // ensure swap never moves price in the opposite direction
  // ensure the inputAmount is non-zero when it's an exact output swap
  if (
    (!exactIn && outputAmount < abs(params.amountSpecified)) ||
    (params.zeroForOne && updatedSqrtPriceX96 > sqrtPriceX96) ||
    (!params.zeroForOne && updatedSqrtPriceX96 < sqrtPriceX96) ||
    outputAmount === 0n ||
    inputAmount === 0n
  ) {
    return _falsyReturnValues();
  }

  if (shouldSurge) {
    const timeSinceLastSwap = blockTimestamp - lastSwapTimestamp;
    lastSurgeTimestamp =
      timeSinceLastSwap >= hookParams.surgeFeeAutostartThreshold
        ? lastSwapTimestamp + hookParams.surgeFeeAutostartThreshold
        : blockTimestamp;
  }

  // get am-AMM state
  let amAmmSwapFee: bigint = 0n;
  let amAmmManager: string = NULL_ADDRESS;
  if (hookParams.amAmmEnabled) {
    const topBid = getTopBid(state, blockNumber, hookDeploymentBlock, K);
    const { swapFee0For1, swapFee1For0 } = decodeAmAmmPayload(topBid.payload);
    amAmmManager = topBid.manager;
    amAmmSwapFee = params.zeroForOne ? swapFee0For1 : swapFee1For0;
  }

  // charge swap fee
  let swapFeeAmount: bigint = 0n;
  const useAmAmmFee = hookParams.amAmmEnabled && amAmmManager !== NULL_ADDRESS;
  const hookFeesBaseSwapFee = feeOverridden
    ? max(
        feeOverride,
        computeSurgeFee(
          lastSurgeTimestamp,
          hookParams.surgeFeeHalfLife,
          blockTimestamp,
        ),
      )
    : computeDynamicSwapFee(
        updatedSqrtPriceX96,
        feeMeanTick,
        lastSurgeTimestamp,
        hookParams.feeMin,
        hookParams.feeMax,
        hookParams.feeQuadraticMultiplier,
        hookParams.surgeFeeHalfLife,
        blockTimestamp,
      );
  swapFee = useAmAmmFee
    ? max(
        amAmmSwapFee,
        computeSurgeFee(
          lastSurgeTimestamp,
          hookParams.surgeFeeHalfLife,
          blockTimestamp,
        ),
      )
    : hookFeesBaseSwapFee;

  if (exactIn) {
    swapFeeAmount = mulDivUp(outputAmount, swapFee, SWAP_FEE_BASE);
    if (useAmAmmFee) {
      const baseSwapFeeAmount = mulDivUp(
        outputAmount,
        hookFeesBaseSwapFee,
        SWAP_FEE_BASE,
      );
      const hookFeesAmount = mulDivUp(
        baseSwapFeeAmount,
        hookFeesModifier,
        MODIFIER_BASE,
      );
      const curatorFeeAmount = mulDivUp(
        baseSwapFeeAmount,
        state.curatorFeeRate,
        CURATOR_FEE_BASE,
      );

      if (swapFee !== amAmmSwapFee) {
        swapFee = max(
          amAmmSwapFee,
          swapFee -
            mulDivUp(hookFeesBaseSwapFee, hookFeesModifier, MODIFIER_BASE) -
            mulDivUp(
              hookFeesBaseSwapFee,
              state.curatorFeeRate,
              CURATOR_FEE_BASE,
            ),
        );
      }

      swapFeeAmount += hookFeesAmount + curatorFeeAmount;
      swapFee = mulDiv(swapFeeAmount, SWAP_FEE_BASE, outputAmount);
    }
    outputAmount -= swapFeeAmount;

    const actualInputAmount = max(-params.amountSpecified, inputAmount);
    inputAmount = actualInputAmount;
  } else {
    swapFeeAmount = mulDivUp(inputAmount, swapFee, SWAP_FEE_BASE - swapFee);
    if (useAmAmmFee) {
      const baseSwapFeeAmount = mulDivUp(
        inputAmount,
        hookFeesBaseSwapFee,
        SWAP_FEE_BASE - hookFeesBaseSwapFee,
      );
      const hookFeesAmount = mulDivUp(
        baseSwapFeeAmount,
        hookFeesModifier,
        MODIFIER_BASE,
      );
      const curatorFeeAmount = mulDivUp(
        baseSwapFeeAmount,
        state.curatorFeeRate,
        CURATOR_FEE_BASE,
      );

      swapFeeAmount += hookFeesAmount + curatorFeeAmount;
      swapFee = mulDiv(
        swapFeeAmount,
        SWAP_FEE_BASE,
        inputAmount + swapFeeAmount,
      );
    }
    inputAmount += swapFeeAmount;

    const actualOutputAmount = min(params.amountSpecified, outputAmount);
    outputAmount = actualOutputAmount;
  }

  ({ success } = _hookletAfterSwapView(state, dexParams));

  return {
    success,
    updatedSqrtPriceX96,
    updatedTick,
    inputAmount,
    outputAmount,
    swapFee,
    totalLiquidity,
  };
}

function _getReservesInUnderlying(
  reserveAmount: bigint,
  vault: string,
  vaults: { [address: string]: Vault },
): bigint {
  if (vault !== NULL_ADDRESS) {
    const _vault = vaults[vault.toLowerCase()];
    return (reserveAmount * _vault.sharePrice) / 10n ** _vault.vaultDecimals;
  }

  return 0n;
}

function _falsyReturnValues(): {
  success: boolean;
  updatedSqrtPriceX96: bigint;
  updatedTick: bigint;
  inputAmount: bigint;
  outputAmount: bigint;
  swapFee: bigint;
  totalLiquidity: bigint;
} {
  return {
    success: false,
    updatedSqrtPriceX96: 0n,
    updatedTick: 0n,
    inputAmount: 0n,
    outputAmount: 0n,
    swapFee: 0n,
    totalLiquidity: 0n,
  };
}
