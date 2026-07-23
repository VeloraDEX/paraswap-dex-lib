/**
 * FluidDexLite pricing must not quote swaps whose output exceeds the pool's
 * real (adjusted) token supply: imaginary reserves — the concentrated-curve
 * extension — can vastly exceed what the pool actually holds, and the contract
 * rejects such swaps with TokenReservesTooLow(amountOut, tokenAdjustedSupply)
 * (fluid-contracts dexLite/core/coreInternals.sol).
 *
 * Regression for a prod route (mainnet USDT->USDC, ~$800k) that was quoted at
 * an 87% ratio and reverted on-chain with TokenReservesTooLow.
 */
import { SwapSide } from '../../constants';
import {
  calculateSwapIn,
  calculateSwapOut,
  FluidDexLiteMathError,
} from './fluid-dex-lite-math';
import { UnpackedDexVariables } from './types';

const baseVars = (overrides: Partial<UnpackedDexVariables>) =>
  ({
    fee: 0n,
    revenueCut: 0n,
    rebalancingStatus: 0n,
    centerPriceShiftActive: false,
    centerPrice: 0n,
    centerPriceContractAddress: 0n,
    rangePercentShiftActive: false,
    upperPercent: 0n,
    lowerPercent: 0n,
    thresholdPercentShiftActive: false,
    upperShiftThresholdPercent: 0n,
    lowerShiftThresholdPercent: 0n,
    token0Decimals: 6n,
    token1Decimals: 6n,
    token0TotalSupplyAdjusted: 10n ** 15n,
    token1TotalSupplyAdjusted: 10n ** 15n,
    ...overrides,
  } as UnpackedDexVariables);

// Deep, concentrated curve: imaginary reserves far above real supplies.
const IMAGINARY = 10n ** 18n;

// 10 tokens at 6 decimals -> 1e10 in the 9-decimals adjusted precision.
const AMOUNT_RAW = 10n * 10n ** 6n;

describe('FluidDexLite reserves cap (TokenReservesTooLow mirror)', () => {
  describe('calculateSwapIn (SELL)', () => {
    it('throws when the computed output exceeds the output token supply', () => {
      const vars = baseVars({ token1TotalSupplyAdjusted: 10n ** 9n }); // 1 token
      expect(() =>
        calculateSwapIn(AMOUNT_RAW, true, vars, IMAGINARY, IMAGINARY),
      ).toThrow(new FluidDexLiteMathError('Token reserves too low'));
    });

    it('checks the OTHER side for 1->0 swaps', () => {
      const vars = baseVars({ token0TotalSupplyAdjusted: 10n ** 9n });
      expect(() =>
        calculateSwapIn(AMOUNT_RAW, false, vars, IMAGINARY, IMAGINARY),
      ).toThrow(new FluidDexLiteMathError('Token reserves too low'));
    });

    it('quotes normally when the pool holds enough', () => {
      const vars = baseVars({});
      const res = calculateSwapIn(AMOUNT_RAW, true, vars, IMAGINARY, IMAGINARY);
      expect(res.amountOut).toBeGreaterThan(0n);
    });
  });

  describe('calculateSwapOut (BUY)', () => {
    it('throws when the requested output exceeds the output token supply', () => {
      const vars = baseVars({ token1TotalSupplyAdjusted: 10n ** 9n });
      expect(() =>
        calculateSwapOut(AMOUNT_RAW, true, vars, IMAGINARY, IMAGINARY),
      ).toThrow(new FluidDexLiteMathError('Token reserves too low'));
    });

    it('quotes normally when the pool holds enough', () => {
      const vars = baseVars({});
      const res = calculateSwapOut(
        AMOUNT_RAW,
        true,
        vars,
        IMAGINARY,
        IMAGINARY,
      );
      expect(res.amountIn).toBeGreaterThan(0n);
    });
  });
});
