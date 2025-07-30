import { NULL_ADDRESS } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { computeSwap } from '../hook/BunniSwapMath';
import { _hookletBeforeSwap } from '../hooklet';
import { LDFType } from '../ldf/LDFType';
import { decodeAmAmmPayload } from '../lib/AmAmmPayload';
import {
  CURATOR_FEE_BASE,
  MODIFIER_BASE,
  SWAP_FEE_BASE,
} from '../lib/Constants';
import { computeDynamicSwapFee, computeSurgeFee } from '../lib/FeeMath';
import { IdleBalanceLibrary } from '../lib/IdleBalance';
import { dist, max, min, mulDivUp } from '../lib/Math';
import {
  _observe,
  grow,
  observeDouble,
  observeTriple,
  write,
} from '../lib/Oracle';
import { queryLDF } from '../lib/QueryLDF';
import { TickMath } from '../lib/TickMath';
import { getReservesInUnderlying } from '../lib/VaultMath';
import {
  HookParams,
  Observation,
  ObservationState,
  PoolState,
  Slot0,
  SwapParams,
  DexParams,
} from '../types';
import { getTopBidWrite } from './AmAmm';
import { hookHandleSwap } from './BunniHubLogic';

export function afterInitialize(
  sqrtPriceX96: bigint,
  tick: bigint,
  twapSecondsAgo: bigint,
  hookParams: string,
  blockTimestamp: bigint,
): { slot0: Slot0; observationState: ObservationState } {
  // initialize Slot0
  const slot0: Slot0 = {
    sqrtPriceX96: sqrtPriceX96,
    tick: tick,
    lastSwapTimestamp: blockTimestamp,
    lastSurgeTimestamp: 0n,
  };

  const hookParamsDecoded = decodeParams(hookParams);
  const maxTwapSecondsAgo = max(
    max(twapSecondsAgo, hookParamsDecoded.feeTwapSecondsAgo),
    hookParamsDecoded.rebalanceTwapSecondsAgo,
  );

  const observation: Observation = {
    blockTimestamp: blockTimestamp - maxTwapSecondsAgo,
    prevTick: tick,
    tickCumulative: 0n,
    initialized: true,
  };

  const observations: Observation[] = [];
  observations[0] = observation;

  // initialize ObservationState
  const observationState: ObservationState = {
    index: 0n,
    cardinality: 1n,
    cardinalityNext: 1n,
    intermediateObservation: observation,
    observations: observations,
  };

  // increase cardinality target based on maxTwapSecondsAgo
  const cardinalityNext =
    (maxTwapSecondsAgo + (hookParamsDecoded.oracleMinInterval >> 1n)) /
      hookParamsDecoded.oracleMinInterval +
    1n;
  if (cardinalityNext > 1n) {
    const cardinalityNextNew = grow(
      observationState.observations,
      1n,
      cardinalityNext,
    );
    observationState.cardinalityNext = cardinalityNextNew;
  }

  return { slot0, observationState };
}

export async function beforeSwap(
  state: PoolState,
  blockNumber: bigint,
  blockTimestamp: bigint,
  params: SwapParams,
  hookFeesModifier: bigint,
  hookDeploymentBlock: bigint,
  K: bigint,
  dexHelper: IDexHelper,
  dexParams: DexParams,
): Promise<void> {
  let useAmAmmFee: boolean = false;
  let amAmmManager: string = NULL_ADDRESS;

  let feeOverridden: boolean = false;
  let feeOverride: bigint = 0n;

  let priceOverridden: boolean = false;
  let sqrtPriceX96Override: bigint = 0n;

  ({
    feeOverridden,
    fee: feeOverride,
    priceOverridden,
    sqrtPriceX96: sqrtPriceX96Override,
  } = _hookletBeforeSwap(state, params, dexParams));

  // override price if needed
  if (priceOverridden) {
    state.slot0.sqrtPriceX96 = sqrtPriceX96Override;
    state.slot0.tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96Override);
  }

  // compute total token balances
  const reserveBalance0 = await getReservesInUnderlying(
    state.reserve0,
    state.vault0,
    blockNumber,
    dexHelper,
  );
  const reserveBalance1 = await getReservesInUnderlying(
    state.reserve1,
    state.vault1,
    blockNumber,
    dexHelper,
  );
  const balance0 = state.rawBalance0 + reserveBalance0;
  const balance1 = state.rawBalance1 + reserveBalance1;

  // decode hook params
  const hookParams = decodeParams(state.hookParams);

  // update TWAP oracle
  const { updatedIntermediate, updatedIndex, updatedCardinality } =
    _updateOracle(
      state,
      state.slot0.tick,
      hookParams.oracleMinInterval,
      blockTimestamp,
    );

  // get TWAP values
  let arithmeticMeanTick: bigint = 0n;
  let feeMeanTick: bigint = 0n;
  const useLDFTwap: boolean = state.twapSecondsAgo !== 0n;
  const useFeeTwap: boolean =
    !feeOverridden && hookParams.feeTwapSecondsAgo !== 0n;
  if (useLDFTwap && useFeeTwap) {
    const {
      tickCumulative0: tickCumulatives0,
      tickCumulative1: tickCumulatives1,
      tickCumulative2: tickCumulatives2,
    } = observeTriple(
      state.observations,
      updatedIntermediate,
      blockTimestamp,
      0n,
      state.twapSecondsAgo,
      hookParams.feeTwapSecondsAgo,
      state.slot0.tick,
      updatedIndex,
      updatedCardinality,
    );
    arithmeticMeanTick =
      (tickCumulatives0 - tickCumulatives1) / state.twapSecondsAgo;
    feeMeanTick =
      (tickCumulatives0 - tickCumulatives2) / hookParams.feeTwapSecondsAgo;
  } else if (useLDFTwap) {
    arithmeticMeanTick = _getTwap(
      state,
      state.slot0.tick,
      state.twapSecondsAgo,
      updatedIntermediate,
      updatedIndex,
      updatedCardinality,
      blockTimestamp,
    );
  } else if (useFeeTwap) {
    feeMeanTick = _getTwap(
      state,
      state.slot0.tick,
      state.twapSecondsAgo,
      updatedIntermediate,
      updatedIndex,
      updatedCardinality,
      blockTimestamp,
    );
  }

  // query the LDF to get total liquidity and token densities
  let {
    totalLiquidity,
    liquidityDensityOfRoundedTickX96,
    activeBalance0: currentActiveBalance0,
    activeBalance1: currentActiveBalance1,
    newLdfState,
    shouldSurge,
  } = queryLDF(
    state.key,
    state.slot0.sqrtPriceX96,
    state.slot0.tick,
    arithmeticMeanTick,
    state.liquidityDensityFunction,
    state.ldfParams,
    state.ldfState,
    balance0,
    balance1,
    state.idleBalance,
    dexParams,
  );

  const exactIn: boolean = params.amountSpecified < 0n;

  if (
    (params.zeroForOne && currentActiveBalance1 === 0n) ||
    (!params.zeroForOne && currentActiveBalance0 === 0n) ||
    totalLiquidity === 0n ||
    (!exactIn &&
      params.amountSpecified >
        (params.zeroForOne ? currentActiveBalance1 : currentActiveBalance0))
  ) {
    throw new Error('BunniHook__RequestedOutputExceedsBalance()');
  }

  shouldSurge = shouldSurge && state.ldfType !== LDFType.STATIC;
  if (state.ldfType === LDFType.DYNAMIC_AND_STATEFUL) {
    state.ldfState = newLdfState;
  }

  if (shouldSurge) {
    // the LDF has been updated, so we need to update the idle balance
    state.idleBalance = IdleBalanceLibrary.computeIdleBalance(
      currentActiveBalance0,
      currentActiveBalance1,
      balance0,
      balance1,
    );
  }

  // check surge based on vault share prices
  shouldSurge =
    shouldSurge ||
    _shouldSurgeFromVaults(state, hookParams, reserveBalance0, reserveBalance1);

  // compute swap result
  let { updatedSqrtPriceX96, updatedTick, inputAmount, outputAmount } =
    computeSwap(
      {
        key: state.key,
        totalLiquidity,
        liquidityDensityOfRoundedTickX96,
        currentActiveBalance0,
        currentActiveBalance1,
        sqrtPriceX96: state.slot0.sqrtPriceX96,
        currentTick: state.slot0.tick,
        liquidityDensityFunction: state.liquidityDensityFunction,
        arithmeticMeanTick,
        ldfParams: state.ldfParams,
        ldfState: state.ldfState,
        swapParams: params,
      },
      dexParams,
    );

  // revert if it's an exact output swap and outputAmount < params.amountSpecified
  if (!exactIn && outputAmount < params.amountSpecified) {
    throw new Error('BunniHook__InsufficientOutput()');
  }

  // ensure swap never moves price in the opposite direction
  // ensure the inputAmount and outputAmount are non-zero
  if (
    (params.zeroForOne && updatedSqrtPriceX96 > state.slot0.sqrtPriceX96) ||
    (!params.zeroForOne && updatedSqrtPriceX96 < state.slot0.sqrtPriceX96) ||
    outputAmount === 0n ||
    inputAmount === 0n
  ) {
    throw new Error('BunniHook__InvalidSwap()');
  }

  // update slot0
  let lastSurgeTimestamp = state.slot0.lastSurgeTimestamp;
  if (shouldSurge) {
    const timeSinceLastSwap = blockTimestamp - state.slot0.lastSwapTimestamp;
    lastSurgeTimestamp =
      timeSinceLastSwap >= hookParams.surgeFeeAutostartThreshold
        ? state.slot0.lastSwapTimestamp + hookParams.surgeFeeAutostartThreshold
        : blockTimestamp;
  }
  state.slot0.sqrtPriceX96 = updatedSqrtPriceX96;
  state.slot0.tick = updatedTick;
  state.slot0.lastSwapTimestamp = blockTimestamp;
  state.slot0.lastSurgeTimestamp = lastSurgeTimestamp;

  // update am-AMM state
  let amAmmSwapFee: bigint = 0n;
  if (hookParams.amAmmEnabled) {
    const topBid = getTopBidWrite(state, blockNumber, hookDeploymentBlock, K);
    const { swapFee0For1, swapFee1For0 } = decodeAmAmmPayload(topBid.payload);
    amAmmSwapFee = params.zeroForOne ? swapFee0For1 : swapFee1For0;
  }

  // charge swap fee
  let swapFee: bigint = 0n;
  let swapFeeAmount: bigint = 0n;
  useAmAmmFee = hookParams.amAmmEnabled && amAmmManager !== NULL_ADDRESS;

  const hookFeesBaseSwapFee: bigint = feeOverridden
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

  let hookFeesAmount: bigint = 0n;
  let curatorFeeAmount: bigint = 0n;
  let hookHandleSwapInputAmount: bigint = 0n;
  let hookHandleSwapOutputAmount: bigint = 0n;

  if (exactIn) {
    swapFeeAmount = mulDivUp(outputAmount, swapFee, SWAP_FEE_BASE);

    if (useAmAmmFee) {
      const baseSwapFeeAmount = mulDivUp(
        outputAmount,
        hookFeesBaseSwapFee,
        SWAP_FEE_BASE,
      );
      hookFeesAmount = mulDivUp(
        baseSwapFeeAmount,
        hookFeesModifier,
        MODIFIER_BASE,
      );
      curatorFeeAmount = mulDivUp(
        baseSwapFeeAmount,
        state.curatorFeeRate,
        CURATOR_FEE_BASE,
      );

      if (swapFee !== amAmmSwapFee) {
        const swapFeeAdjusted = max(
          amAmmSwapFee,
          swapFee -
            mulDivUp(hookFeesBaseSwapFee, hookFeesModifier, MODIFIER_BASE) -
            mulDivUp(
              hookFeesBaseSwapFee,
              state.curatorFeeRate,
              CURATOR_FEE_BASE,
            ),
        );
        swapFeeAmount = mulDivUp(outputAmount, swapFeeAdjusted, SWAP_FEE_BASE);
      }
    } else {
      hookFeesAmount = mulDivUp(swapFeeAmount, hookFeesModifier, MODIFIER_BASE);
      curatorFeeAmount = mulDivUp(
        swapFeeAmount,
        state.curatorFeeRate,
        CURATOR_FEE_BASE,
      );
      swapFeeAmount -= hookFeesAmount;
    }

    outputAmount -= swapFeeAmount + hookFeesAmount + curatorFeeAmount;

    const actualInputAmount = max(-params.amountSpecified, inputAmount);
    inputAmount = actualInputAmount;

    hookHandleSwapInputAmount = inputAmount;
    hookHandleSwapOutputAmount = useAmAmmFee
      ? outputAmount + swapFeeAmount + hookFeesAmount + curatorFeeAmount
      : outputAmount + hookFeesAmount + curatorFeeAmount;
  } else {
    swapFeeAmount = mulDivUp(inputAmount, swapFee, SWAP_FEE_BASE - swapFee);

    if (useAmAmmFee) {
      const baseSwapFeeAmount = mulDivUp(
        inputAmount,
        hookFeesBaseSwapFee,
        SWAP_FEE_BASE - hookFeesBaseSwapFee,
      );

      hookFeesAmount = mulDivUp(
        baseSwapFeeAmount,
        hookFeesModifier,
        MODIFIER_BASE,
      );
      curatorFeeAmount = mulDivUp(
        baseSwapFeeAmount,
        state.curatorFeeRate,
        CURATOR_FEE_BASE,
      );
    } else {
      hookFeesAmount = mulDivUp(swapFeeAmount, hookFeesModifier, MODIFIER_BASE);
      curatorFeeAmount = mulDivUp(
        swapFeeAmount,
        state.curatorFeeRate,
        CURATOR_FEE_BASE,
      );
      swapFeeAmount -= hookFeesAmount + curatorFeeAmount;
    }

    inputAmount += swapFeeAmount + hookFeesAmount + curatorFeeAmount;

    const acutalOutputAmount = min(params.amountSpecified, outputAmount);
    outputAmount = acutalOutputAmount;

    hookHandleSwapInputAmount = useAmAmmFee
      ? inputAmount - swapFeeAmount - hookFeesAmount - curatorFeeAmount
      : inputAmount - hookFeesAmount - curatorFeeAmount;
    hookHandleSwapOutputAmount = outputAmount;
  }

  await hookHandleSwap(
    state,
    params.zeroForOne,
    hookHandleSwapInputAmount,
    hookHandleSwapOutputAmount,
    shouldSurge,
    blockNumber,
    dexHelper,
  );
}

export function decodeParams(hookParams: string): HookParams {
  return {
    feeMin: BigInt.asUintN(24, BigInt(`0x${hookParams.slice(2, 8)}`)),
    feeMax: BigInt.asUintN(24, BigInt(`0x${hookParams.slice(8, 14)}`)),
    feeQuadraticMultiplier: BigInt.asUintN(
      24,
      BigInt(`0x${hookParams.slice(14, 20)}`),
    ),
    feeTwapSecondsAgo: BigInt.asUintN(
      24,
      BigInt(`0x${hookParams.slice(20, 26)}`),
    ),
    maxAmAmmFee: BigInt.asUintN(24, BigInt(`0x${hookParams.slice(26, 32)}`)),
    surgeFeeHalfLife: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(32, 36)}`),
    ),
    surgeFeeAutostartThreshold: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(36, 40)}`),
    ),
    vaultSurgeThreshold0: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(40, 44)}`),
    ),
    vaultSurgeThreshold1: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(44, 48)}`),
    ),
    rebalanceThreshold: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(48, 52)}`),
    ),
    rebalanceMaxSlippage: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(52, 56)}`),
    ),
    rebalanceTwapSecondsAgo: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(56, 60)}`),
    ),
    rebalanceOrderTTL: BigInt.asUintN(
      16,
      BigInt(`0x${hookParams.slice(60, 64)}`),
    ),
    amAmmEnabled: Boolean(BigInt(`0x${hookParams.slice(64, 66)}`)),
    oracleMinInterval: BigInt.asUintN(
      32,
      BigInt(`0x${hookParams.slice(66, 74)}`),
    ),
    minRentMultiplier: BigInt.asUintN(
      48,
      BigInt(`0x${hookParams.slice(74, 86)}`),
    ),
  };
}

export function observe(
  state: PoolState,
  secondsAgos: bigint[],
  blockTimestamp: bigint,
): bigint[] {
  return _observe(
    state.observations,
    state.intermediateObservation,
    blockTimestamp,
    secondsAgos,
    state.slot0.tick,
    state.index,
    state.cardinality,
  );
}

export function _shouldSurgeFromVaults(
  state: PoolState,
  hookParams: HookParams,
  reserveBalance0: bigint,
  reserveBalance1: bigint,
): boolean {
  let shouldSurge: boolean = false;

  if (state.vault0 !== NULL_ADDRESS || state.vault1 !== NULL_ADDRESS) {
    const rescaleFactor0 = 18n + state.vault0Decimals - state.currency0Decimals;
    const rescaleFactor1 = 18n + state.vault1Decimals - state.currency1Decimals;

    const sharePrice0 =
      state.reserve0 === 0n
        ? 0n
        : mulDivUp(reserveBalance0, 10n ** rescaleFactor0, state.reserve0);
    const sharePrice1 =
      state.reserve1 === 0n
        ? 0n
        : mulDivUp(reserveBalance1, 10n ** rescaleFactor1, state.reserve1);

    shouldSurge =
      state.initialized &&
      (dist(sharePrice0, state.sharePrice0) >
        state.sharePrice0 / hookParams.vaultSurgeThreshold0 ||
        dist(sharePrice1, state.sharePrice1) >
          state.sharePrice1 / hookParams.vaultSurgeThreshold1);

    if (
      !state.initialized ||
      sharePrice0 !== state.sharePrice0 ||
      sharePrice1 !== state.sharePrice1
    ) {
      state.initialized = true;
      state.sharePrice0 = sharePrice0;
      state.sharePrice1 = sharePrice1;
    }
  }

  return shouldSurge;
}

function _getTwap(
  state: PoolState,
  currentTick: bigint,
  twapSecondsAgo: bigint,
  updatedIntermediate: Observation,
  updatedIndex: bigint,
  updatedCardinality: bigint,
  blockTimestamp: bigint,
): bigint {
  const { tickCumulative0, tickCumulative1 } = observeDouble(
    state.observations,
    updatedIntermediate,
    blockTimestamp,
    twapSecondsAgo,
    0n,
    currentTick,
    updatedIndex,
    updatedCardinality,
  );
  const tickCumulativesDelta = tickCumulative1 - tickCumulative0;
  return tickCumulativesDelta / twapSecondsAgo;
}

function _updateOracle(
  state: PoolState,
  tick: bigint,
  oracleMinInterval: bigint,
  blockTimestamp: bigint,
): {
  updatedIntermediate: Observation;
  updatedIndex: bigint;
  updatedCardinality: bigint;
} {
  const {
    intermediateUpdated: updatedIntermediate,
    indexUpdated: updatedIndex,
    cardinalityUpdated: updatedCardinality,
  } = write(
    state.observations,
    state.intermediateObservation,
    state.index,
    blockTimestamp,
    tick,
    state.cardinality,
    state.cardinalityNext,
    oracleMinInterval,
  );

  state.intermediateObservation = updatedIntermediate;
  state.index = updatedIndex;
  state.cardinality = updatedCardinality;

  return { updatedIntermediate, updatedIndex, updatedCardinality };
}
