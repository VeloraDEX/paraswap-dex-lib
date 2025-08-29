import { SwapSide } from '../../constants';
import {
  PoolState,
  DexKey,
  UnpackedDexVariables,
  SwapResult,
  PricingResult,
} from './types';

// Constants for bit manipulation (from DexLiteSlotsLink and constantVariables)
export const BITS_DEX_LITE_DEX_VARIABLES_FEE = 0;
export const BITS_DEX_LITE_DEX_VARIABLES_REVENUE_CUT = 13;
export const BITS_DEX_LITE_DEX_VARIABLES_REBALANCING_STATUS = 20;
export const BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE_SHIFT_ACTIVE = 22;
export const BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE = 23;
export const BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE_CONTRACT_ADDRESS = 63;
export const BITS_DEX_LITE_DEX_VARIABLES_RANGE_PERCENT_SHIFT_ACTIVE = 82;
export const BITS_DEX_LITE_DEX_VARIABLES_UPPER_PERCENT = 83;
export const BITS_DEX_LITE_DEX_VARIABLES_LOWER_PERCENT = 97;
export const BITS_DEX_LITE_DEX_VARIABLES_THRESHOLD_PERCENT_SHIFT_ACTIVE = 111;
export const BITS_DEX_LITE_DEX_VARIABLES_UPPER_SHIFT_THRESHOLD_PERCENT = 112;
export const BITS_DEX_LITE_DEX_VARIABLES_LOWER_SHIFT_THRESHOLD_PERCENT = 119;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_DECIMALS = 126;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_DECIMALS = 131;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_TOTAL_SUPPLY_ADJUSTED = 136;
export const BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_TOTAL_SUPPLY_ADJUSTED = 196;

// Bit masks (from constantVariables.sol)
export const X1 = 0x1n;
export const X2 = 0x3n;
export const X5 = 0x1fn;
export const X7 = 0x7fn;
export const X13 = 0x1fffn;
export const X14 = 0x3fffn;
export const X19 = 0x7ffffn;
export const X20 = 0xfffffn;
export const X24 = 0xffffffn;
export const X28 = 0xfffffffn;
export const X33 = 0x1ffffffffn;
export const X40 = 0xffffffffffn;
export const X60 = 0xfffffffffffffffn;
export const X64 = 0xffffffffffffffffn;
export const X73 = 0x1ffffffffffffffffffn;

// CenterPriceShift bit positions
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP = 0;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_SHIFTING_TIME = 33;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_MAX_CENTER_PRICE = 57;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_MIN_CENTER_PRICE = 85;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_PERCENT = 113;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_TIME_TO_SHIFT = 133;
export const BITS_DEX_LITE_CENTER_PRICE_SHIFT_TIMESTAMP = 153;

// RangeShift bit positions
export const BITS_DEX_LITE_RANGE_SHIFT_OLD_UPPER_RANGE_PERCENT = 0;
export const BITS_DEX_LITE_RANGE_SHIFT_OLD_LOWER_RANGE_PERCENT = 14;
export const BITS_DEX_LITE_RANGE_SHIFT_TIME_TO_SHIFT = 28;
export const BITS_DEX_LITE_RANGE_SHIFT_TIMESTAMP = 48;

// ThresholdShift bit positions
export const BITS_DEX_LITE_THRESHOLD_SHIFT_OLD_UPPER_THRESHOLD_PERCENT = 0;
export const BITS_DEX_LITE_THRESHOLD_SHIFT_OLD_LOWER_THRESHOLD_PERCENT = 7;
export const BITS_DEX_LITE_THRESHOLD_SHIFT_TIME_TO_SHIFT = 14;
export const BITS_DEX_LITE_THRESHOLD_SHIFT_TIMESTAMP = 34;

// Other constants
export const TWO_DECIMALS = 100n;
export const FOUR_DECIMALS = 10000n;
export const SIX_DECIMALS = 1000000n;
export const PRICE_PRECISION = 10n ** 27n;
export const TOKENS_DECIMALS_PRECISION = 9n;
export const MINIMUM_LIQUIDITY_SWAP = 10000n;
export const DEFAULT_EXPONENT_SIZE = 8n;
export const DEFAULT_EXPONENT_MASK = 0xffn;

export class FluidDexLiteMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FluidDexLiteMathError';
  }
}

// Helper function to calculate powers of 10
function tenPow(power: bigint): bigint {
  const powerNum = Number(power);

  // Handle the most common cases for optimization
  if (powerNum === 3) return 1000n;
  if (powerNum === 9) return 1000000000n;
  if (powerNum === 1) return 10n;
  if (powerNum === 0) return 1n;
  if (powerNum === 2) return 100n;
  if (powerNum === 4) return 10000n;
  if (powerNum === 5) return 100000n;
  if (powerNum === 6) return 1000000n;
  if (powerNum === 7) return 10000000n;
  if (powerNum === 8) return 100000000n;

  throw new FluidDexLiteMathError(`Power invalid: ${power}.`);
}

// Unpack dexVariables from the packed uint256
export function unpackDexVariables(dexVariables: bigint): UnpackedDexVariables {
  return {
    fee: (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_FEE)) & X13,
    revenueCut:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_REVENUE_CUT)) & X7,
    rebalancingStatus:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_REBALANCING_STATUS)) &
      X2,
    centerPriceShiftActive:
      ((dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE_SHIFT_ACTIVE)) &
        X1) ===
      1n,
    centerPrice:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE)) & X40,
    centerPriceContractAddress:
      (dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_CENTER_PRICE_CONTRACT_ADDRESS)) &
      X19,
    rangePercentShiftActive:
      ((dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_RANGE_PERCENT_SHIFT_ACTIVE)) &
        X1) ===
      1n,
    upperPercent:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_UPPER_PERCENT)) & X14,
    lowerPercent:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_LOWER_PERCENT)) & X14,
    thresholdPercentShiftActive:
      ((dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_THRESHOLD_PERCENT_SHIFT_ACTIVE)) &
        X1) ===
      1n,
    upperShiftThresholdPercent:
      (dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_UPPER_SHIFT_THRESHOLD_PERCENT)) &
      X7,
    lowerShiftThresholdPercent:
      (dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_LOWER_SHIFT_THRESHOLD_PERCENT)) &
      X7,
    token0Decimals:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_DECIMALS)) &
      X5,
    token1Decimals:
      (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_DECIMALS)) &
      X5,
    token0TotalSupplyAdjusted:
      (dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_TOTAL_SUPPLY_ADJUSTED)) &
      X60,
    token1TotalSupplyAdjusted:
      (dexVariables >>
        BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_TOTAL_SUPPLY_ADJUSTED)) &
      X60,
  };
}

// Expand center price from compressed format
function expandCenterPrice(centerPrice: bigint): bigint {
  return (
    (centerPrice >> DEFAULT_EXPONENT_SIZE) <<
    (centerPrice & DEFAULT_EXPONENT_MASK)
  );
}

// Helper function for linear interpolation during shifting
function calcShiftingDone(
  current: bigint,
  old: bigint,
  timePassed: bigint,
  shiftDuration: bigint,
): bigint {
  if (current > old) {
    return old + ((current - old) * timePassed) / shiftDuration;
  } else {
    return old - ((old - current) * timePassed) / shiftDuration;
  }
}

// Calculate current range percents (equivalent to _calcRangeShifting)
function calcRangeShifting(
  upperRange: bigint,
  lowerRange: bigint,
  rangeShift: bigint,
  currentTimestamp: bigint,
): { upperRange: bigint; lowerRange: bigint } {
  const shiftDuration =
    (rangeShift >> BigInt(BITS_DEX_LITE_RANGE_SHIFT_TIME_TO_SHIFT)) & X20;
  const startTimestamp =
    (rangeShift >> BigInt(BITS_DEX_LITE_RANGE_SHIFT_TIMESTAMP)) & X33;

  if (startTimestamp + shiftDuration < currentTimestamp) {
    // shifting fully done
    return { upperRange, lowerRange };
  }

  const timePassed = currentTimestamp - startTimestamp;
  const oldUpperRange =
    (rangeShift >> BigInt(BITS_DEX_LITE_RANGE_SHIFT_OLD_UPPER_RANGE_PERCENT)) &
    X14;
  const oldLowerRange =
    (rangeShift >> BigInt(BITS_DEX_LITE_RANGE_SHIFT_OLD_LOWER_RANGE_PERCENT)) &
    X14;

  return {
    upperRange: calcShiftingDone(
      upperRange,
      oldUpperRange,
      timePassed,
      shiftDuration,
    ),
    lowerRange: calcShiftingDone(
      lowerRange,
      oldLowerRange,
      timePassed,
      shiftDuration,
    ),
  };
}

// Calculate current threshold percents (equivalent to _calcThresholdShifting)
function calcThresholdShifting(
  upperThreshold: bigint,
  lowerThreshold: bigint,
  thresholdShift: bigint,
  currentTimestamp: bigint,
): { upperThreshold: bigint; lowerThreshold: bigint } {
  const shiftDuration =
    (thresholdShift >> BigInt(BITS_DEX_LITE_THRESHOLD_SHIFT_TIME_TO_SHIFT)) &
    X20;
  const startTimestamp =
    (thresholdShift >> BigInt(BITS_DEX_LITE_THRESHOLD_SHIFT_TIMESTAMP)) & X33;

  if (startTimestamp + shiftDuration < currentTimestamp) {
    // shifting fully done
    return { upperThreshold, lowerThreshold };
  }

  const timePassed = currentTimestamp - startTimestamp;
  const oldUpperThreshold =
    (thresholdShift >>
      BigInt(BITS_DEX_LITE_THRESHOLD_SHIFT_OLD_UPPER_THRESHOLD_PERCENT)) &
    X7;
  const oldLowerThreshold =
    (thresholdShift >>
      BigInt(BITS_DEX_LITE_THRESHOLD_SHIFT_OLD_LOWER_THRESHOLD_PERCENT)) &
    X7;

  return {
    upperThreshold: calcShiftingDone(
      upperThreshold,
      oldUpperThreshold,
      timePassed,
      shiftDuration,
    ),
    lowerThreshold: calcShiftingDone(
      lowerThreshold,
      oldLowerThreshold,
      timePassed,
      shiftDuration,
    ),
  };
}

// Calculate reserves outside range (equivalent to _calculateReservesOutsideRange)
function calculateReservesOutsideRange(
  geometricMean: bigint,
  pa: bigint,
  rx: bigint,
  ry: bigint,
): { xa: bigint; yb: bigint } {
  const p1 = pa - geometricMean;

  const p2 = (geometricMean * rx + ry * PRICE_PRECISION) / (2n * p1);

  const discriminant = (rx * ry * PRICE_PRECISION) / p1 + p2 * p2;

  // xa = part2 + (part3 + (part2 * part2))^(1/2)
  // yb = xa * gp
  const xa = p2 + sqrt(discriminant);
  const yb = (xa * geometricMean) / PRICE_PRECISION;

  return { xa, yb };
}

// Square root implementation for BigInt
export function sqrt(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }

  let x = value;
  let result = value;

  // Newton's method
  while (x > 0n) {
    x = (result + value / result) / 2n;
    if (x >= result) {
      break;
    }
    result = x;
  }

  return result;
}

// Full pricing calculation (equivalent to _getPricesAndReserves)
export function getPricesAndReserves(
  state: PoolState,
  currentTimestamp: bigint = BigInt(Math.floor(Date.now() / 1000)),
): PricingResult {
  const unpackedVars = unpackDexVariables(state.dexVariables);

  // Calculate center price
  let centerPrice: bigint;

  // Revert if external price contract is configured
  if (unpackedVars.centerPriceContractAddress !== 0n) {
    throw new FluidDexLiteMathError(
      'External price contracts not supported in pricing',
    );
  }

  // Revert if center price shifting is active
  if (unpackedVars.centerPriceShiftActive) {
    throw new FluidDexLiteMathError(
      'Center price shifting not supported in pricing',
    );
  }

  // Use stored center price
  centerPrice = expandCenterPrice(unpackedVars.centerPrice);

  // Calculate range percents
  let upperRangePercent = unpackedVars.upperPercent;
  let lowerRangePercent = unpackedVars.lowerPercent;

  if (unpackedVars.rangePercentShiftActive) {
    const rangeResult = calcRangeShifting(
      upperRangePercent,
      lowerRangePercent,
      state.rangeShift,
      currentTimestamp,
    );
    upperRangePercent = rangeResult.upperRange;
    lowerRangePercent = rangeResult.lowerRange;
  }

  // Calculate range prices
  let upperRangePrice =
    (centerPrice * FOUR_DECIMALS) / (FOUR_DECIMALS - upperRangePercent);
  let lowerRangePrice =
    (centerPrice * (FOUR_DECIMALS - lowerRangePercent)) / FOUR_DECIMALS;

  // Handle rebalancing logic
  const rebalancingStatus = unpackedVars.rebalancingStatus;

  if (rebalancingStatus > 1n) {
    let centerPriceShiftData = 0n;

    if (rebalancingStatus === 2n) {
      // Price shifting towards upper range
      centerPriceShiftData = state.centerPriceShift;
      const shiftingTime =
        (centerPriceShiftData >>
          BigInt(BITS_DEX_LITE_CENTER_PRICE_SHIFT_SHIFTING_TIME)) &
        X24;
      const timeElapsed = currentTimestamp - state.lastInteractionTimestamp;

      if (timeElapsed < shiftingTime) {
        centerPrice =
          centerPrice +
          ((upperRangePrice - centerPrice) * timeElapsed) / shiftingTime;
      } else {
        // 100% price shifted
        centerPrice = upperRangePrice;
      }
    } else if (rebalancingStatus === 3n) {
      // Price shifting towards lower range
      centerPriceShiftData = state.centerPriceShift;
      const shiftingTime =
        (centerPriceShiftData >>
          BigInt(BITS_DEX_LITE_CENTER_PRICE_SHIFT_SHIFTING_TIME)) &
        X24;
      const timeElapsed = currentTimestamp - state.lastInteractionTimestamp;

      if (timeElapsed < shiftingTime) {
        centerPrice =
          centerPrice -
          ((centerPrice - lowerRangePrice) * timeElapsed) / shiftingTime;
      } else {
        // 100% price shifted
        centerPrice = lowerRangePrice;
      }
    }

    // Apply min/max bounds if rebalancing happened
    if (centerPriceShiftData > 0n) {
      // Check max center price
      let maxCenterPrice =
        (centerPriceShiftData >>
          BigInt(BITS_DEX_LITE_CENTER_PRICE_SHIFT_MAX_CENTER_PRICE)) &
        X28;
      maxCenterPrice =
        (maxCenterPrice >> DEFAULT_EXPONENT_SIZE) <<
        (maxCenterPrice & DEFAULT_EXPONENT_MASK);

      if (centerPrice > maxCenterPrice) {
        centerPrice = maxCenterPrice;
      } else {
        // Check min center price
        let minCenterPrice =
          (centerPriceShiftData >>
            BigInt(BITS_DEX_LITE_CENTER_PRICE_SHIFT_MIN_CENTER_PRICE)) &
          X28;
        minCenterPrice =
          (minCenterPrice >> DEFAULT_EXPONENT_SIZE) <<
          (minCenterPrice & DEFAULT_EXPONENT_MASK);

        if (centerPrice < minCenterPrice) {
          centerPrice = minCenterPrice;
        }
      }

      // Update range prices as center price moved
      upperRangePrice =
        (centerPrice * FOUR_DECIMALS) / (FOUR_DECIMALS - upperRangePercent);
      lowerRangePrice =
        (centerPrice * (FOUR_DECIMALS - lowerRangePercent)) / FOUR_DECIMALS;
    }
  }

  // Calculate geometric mean
  let geometricMean: bigint;

  if (upperRangePrice < 10n ** 38n) {
    // Normal case
    geometricMean = sqrt(upperRangePrice * lowerRangePrice);
  } else {
    // Handle very large prices
    geometricMean =
      sqrt((upperRangePrice / 10n ** 18n) * (lowerRangePrice / 10n ** 18n)) *
      10n ** 18n;
  }

  // Calculate imaginary reserves
  let token0ImaginaryReserves: bigint;
  let token1ImaginaryReserves: bigint;

  if (geometricMean < PRICE_PRECISION) {
    const reserves = calculateReservesOutsideRange(
      geometricMean,
      upperRangePrice,
      unpackedVars.token0TotalSupplyAdjusted,
      unpackedVars.token1TotalSupplyAdjusted,
    );
    token0ImaginaryReserves = reserves.xa;
    token1ImaginaryReserves = reserves.yb;
  } else {
    // Inverse calculation for large geometric mean
    const reserves = calculateReservesOutsideRange(
      10n ** 54n / geometricMean,
      10n ** 54n / lowerRangePrice,
      unpackedVars.token1TotalSupplyAdjusted,
      unpackedVars.token0TotalSupplyAdjusted,
    );
    token1ImaginaryReserves = reserves.xa;
    token0ImaginaryReserves = reserves.yb;
  }

  // Add actual supplies to imaginary reserves
  token0ImaginaryReserves += unpackedVars.token0TotalSupplyAdjusted;
  token1ImaginaryReserves += unpackedVars.token1TotalSupplyAdjusted;

  return {
    centerPrice,
    upperRangePrice,
    lowerRangePrice,
    token0ImaginaryReserves,
    token1ImaginaryReserves,
  };
}

// Main swap calculation function
export function calculateSwap(
  state: PoolState,
  swap0To1: boolean,
  amountSpecified: bigint,
  side: SwapSide,
): SwapResult {
  const unpackedVars = unpackDexVariables(state.dexVariables);

  // Basic validation
  if (
    unpackedVars.token0TotalSupplyAdjusted === 0n &&
    unpackedVars.token1TotalSupplyAdjusted === 0n
  ) {
    throw new FluidDexLiteMathError('Pool not initialized');
  }

  // Get current pricing with all shifting logic
  const pricing = getPricesAndReserves(state);

  if (side === SwapSide.SELL) {
    return calculateSwapIn(
      amountSpecified,
      swap0To1,
      unpackedVars,
      pricing.token0ImaginaryReserves,
      pricing.token1ImaginaryReserves,
    );
  } else {
    return calculateSwapOut(
      amountSpecified,
      swap0To1,
      unpackedVars,
      pricing.token0ImaginaryReserves,
      pricing.token1ImaginaryReserves,
    );
  }
}

// Calculate swap for exact input (SELL side)
function calculateSwapIn(
  amountIn: bigint,
  swap0To1: boolean,
  unpackedVars: UnpackedDexVariables,
  token0ImaginaryReserves: bigint,
  token1ImaginaryReserves: bigint,
): SwapResult {
  let adjustedAmountIn = amountIn;

  // Apply decimal adjustments
  if (swap0To1) {
    const token0Decimals = unpackedVars.token0Decimals;
    if (token0Decimals > TOKENS_DECIMALS_PRECISION) {
      adjustedAmountIn =
        adjustedAmountIn / tenPow(token0Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      adjustedAmountIn =
        adjustedAmountIn * tenPow(TOKENS_DECIMALS_PRECISION - token0Decimals);
    }
  } else {
    const token1Decimals = unpackedVars.token1Decimals;
    if (token1Decimals > TOKENS_DECIMALS_PRECISION) {
      adjustedAmountIn =
        adjustedAmountIn / tenPow(token1Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      adjustedAmountIn =
        adjustedAmountIn * tenPow(TOKENS_DECIMALS_PRECISION - token1Decimals);
    }
  }

  // Validate amount - matches contract InvalidSwapAmounts error
  if (adjustedAmountIn < FOUR_DECIMALS || adjustedAmountIn > X60) {
    throw new FluidDexLiteMathError('Invalid swap amount');
  }

  // Check against half of reserves - matches contract ExcessiveSwapAmount error
  const relevantReserves = swap0To1
    ? token0ImaginaryReserves
    : token1ImaginaryReserves;
  if (adjustedAmountIn > relevantReserves / 2n) {
    throw new FluidDexLiteMathError('Excessive swap amount');
  }

  const fee = (adjustedAmountIn * unpackedVars.fee) / SIX_DECIMALS;
  const amountInAfterFee = adjustedAmountIn - fee;

  // Constant product formula: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
  let amountOut: bigint;
  if (swap0To1) {
    // Check for potential overflow in intermediate calculation
    const numerator = amountInAfterFee * token1ImaginaryReserves;
    const denominator = token0ImaginaryReserves + amountInAfterFee;

    amountOut = numerator / denominator;
  } else {
    const numerator = amountInAfterFee * token0ImaginaryReserves;
    const denominator = token1ImaginaryReserves + amountInAfterFee;

    amountOut = numerator / denominator;
  }

  // Apply decimal adjustments to output
  if (swap0To1) {
    const token1Decimals = unpackedVars.token1Decimals;
    if (token1Decimals > TOKENS_DECIMALS_PRECISION) {
      amountOut =
        amountOut * tenPow(token1Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      amountOut =
        amountOut / tenPow(TOKENS_DECIMALS_PRECISION - token1Decimals);
    }
  } else {
    const token0Decimals = unpackedVars.token0Decimals;
    if (token0Decimals > TOKENS_DECIMALS_PRECISION) {
      amountOut =
        amountOut * tenPow(token0Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      amountOut =
        amountOut / tenPow(TOKENS_DECIMALS_PRECISION - token0Decimals);
    }
  }

  return {
    amountIn: amountIn,
    amountOut: amountOut,
  };
}

// Calculate swap for exact output (BUY side)
function calculateSwapOut(
  amountOut: bigint,
  swap0To1: boolean,
  unpackedVars: UnpackedDexVariables,
  token0ImaginaryReserves: bigint,
  token1ImaginaryReserves: bigint,
): SwapResult {
  let adjustedAmountOut = amountOut;

  // Apply decimal adjustments
  if (swap0To1) {
    const token1Decimals = unpackedVars.token1Decimals;
    if (token1Decimals > TOKENS_DECIMALS_PRECISION) {
      adjustedAmountOut =
        adjustedAmountOut / tenPow(token1Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      adjustedAmountOut =
        adjustedAmountOut * tenPow(TOKENS_DECIMALS_PRECISION - token1Decimals);
    }
  } else {
    const token0Decimals = unpackedVars.token0Decimals;
    if (token0Decimals > TOKENS_DECIMALS_PRECISION) {
      adjustedAmountOut =
        adjustedAmountOut / tenPow(token0Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      adjustedAmountOut =
        adjustedAmountOut * tenPow(TOKENS_DECIMALS_PRECISION - token0Decimals);
    }
  }

  // Validate amount - matches contract InvalidSwapAmounts error
  if (adjustedAmountOut < FOUR_DECIMALS || adjustedAmountOut > X60) {
    throw new FluidDexLiteMathError('Invalid swap amount');
  }

  // Check against half of reserves - matches contract ExcessiveSwapAmount error
  const relevantReserves = swap0To1
    ? token1ImaginaryReserves
    : token0ImaginaryReserves;
  if (adjustedAmountOut > relevantReserves / 2n) {
    throw new FluidDexLiteMathError('Excessive swap amount');
  }

  // Reverse constant product formula: amountIn = (amountOut * reserveIn) / (reserveOut - amountOut)
  let amountInBeforeFee: bigint;
  if (swap0To1) {
    const denominator = token1ImaginaryReserves - adjustedAmountOut;
    if (denominator <= 0n) {
      throw new FluidDexLiteMathError(
        'Insufficient liquidity - amount out too large',
      );
    }
    const numerator = adjustedAmountOut * token0ImaginaryReserves;
    amountInBeforeFee = numerator / denominator;
  } else {
    const denominator = token0ImaginaryReserves - adjustedAmountOut;
    if (denominator <= 0n) {
      throw new FluidDexLiteMathError(
        'Insufficient liquidity - amount out too large',
      );
    }
    const numerator = adjustedAmountOut * token1ImaginaryReserves;
    amountInBeforeFee = numerator / denominator;
  }

  const feeDenominator = SIX_DECIMALS - unpackedVars.fee;

  const fee =
    (amountInBeforeFee * SIX_DECIMALS) / feeDenominator - amountInBeforeFee;
  const amountIn = amountInBeforeFee + fee;

  // Apply decimal adjustments to input
  let finalAmountIn = amountIn;
  if (swap0To1) {
    const token0Decimals = unpackedVars.token0Decimals;
    if (token0Decimals > TOKENS_DECIMALS_PRECISION) {
      finalAmountIn =
        finalAmountIn * tenPow(token0Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      finalAmountIn =
        finalAmountIn / tenPow(TOKENS_DECIMALS_PRECISION - token0Decimals);
    }
  } else {
    const token1Decimals = unpackedVars.token1Decimals;
    if (token1Decimals > TOKENS_DECIMALS_PRECISION) {
      finalAmountIn =
        finalAmountIn * tenPow(token1Decimals - TOKENS_DECIMALS_PRECISION);
    } else {
      finalAmountIn =
        finalAmountIn / tenPow(TOKENS_DECIMALS_PRECISION - token1Decimals);
    }
  }

  return {
    amountIn: finalAmountIn,
    amountOut: amountOut,
  };
}
