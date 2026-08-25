import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../../../dex-helper/index';
import { Network, SwapSide } from '../../../../constants';
import { BI_POWS } from '../../../../bigint-constants';
import { Tokens } from '../../../../../tests/constants-e2e';
import { AerostratSlipstream } from './aerostrat-slipstream';

/*
 * Pure unit coverage for the parts this fork adds on top of VelodromeSlipstream:
 * the supported-swap predicate and the tax arithmetic. Everything else is
 * inherited and covered by the shared Slipstream suites.
 */
describe('AerostratSlipstream tax handling', () => {
  const dexKey = 'AerostratSlipstream';
  const network = Network.BASE;
  const dexHelper = new DummyDexHelper(network);

  const AEROSTRAT = Tokens[network]['AEROSTRAT'];
  const AERO = Tokens[network]['AERO'];
  const USDC = Tokens[network]['USDC'];

  let aerostrat: AerostratSlipstream;

  beforeEach(() => {
    aerostrat = new AerostratSlipstream(network, dexKey, dexHelper);
  });

  const setTax = (bps: bigint | undefined) => {
    (aerostrat as any).taxBps = bps;
  };
  const supports = (src: string, dest: string, side: SwapSide): boolean =>
    (aerostrat as any).isSupportedSwap(src, dest, side);
  const toPoolAmounts = (
    amounts: bigint[],
    side: SwapSide,
    taxOnPoolInput: boolean,
  ): bigint[] =>
    (aerostrat as any).toPoolAmounts(amounts, side, taxOnPoolInput);
  const toUserPrices = (
    prices: bigint[],
    side: SwapSide,
    taxOnPoolInput: boolean,
  ): bigint[] => (aerostrat as any).toUserPrices(prices, side, taxOnPoolInput);

  describe('supported swaps', () => {
    it('supports the two routable quadrants', () => {
      setTax(1000n);

      // Sell AEROSTRAT: taxed input, routed via the custom router.
      expect(supports(AEROSTRAT.address, AERO.address, SwapSide.SELL)).toBe(
        true,
      );
      // Buy AEROSTRAT quoted as an exact-input sell of AERO.
      expect(supports(AERO.address, AEROSTRAT.address, SwapSide.SELL)).toBe(
        true,
      );
      // Buy AEROSTRAT quoted as an exact-output buy.
      expect(supports(AERO.address, AEROSTRAT.address, SwapSide.BUY)).toBe(
        true,
      );
    });

    it('refuses BUY with AEROSTRAT as input', () => {
      // AEROSTRATRouter exposes only an exact-input entry point.
      setTax(1000n);
      expect(supports(AEROSTRAT.address, AERO.address, SwapSide.BUY)).toBe(
        false,
      );
    });

    it('ignores pairs that do not involve AEROSTRAT', () => {
      setTax(1000n);
      expect(supports(AERO.address, USDC.address, SwapSide.SELL)).toBe(false);
    });

    it('refuses to quote before the tax has been read', async () => {
      setTax(undefined);

      expect(supports(AEROSTRAT.address, AERO.address, SwapSide.SELL)).toBe(
        false,
      );
      expect(
        await aerostrat.getPoolIdentifiers(AEROSTRAT, AERO, SwapSide.SELL, 1),
      ).toEqual([]);
      expect(
        await aerostrat.getPricesVolume(
          AEROSTRAT,
          AERO,
          [0n, BI_POWS[18]],
          SwapSide.SELL,
          1,
        ),
      ).toBeNull();
    });

    it('refuses to quote at a tax of 100% or more', async () => {
      // At exactly BPS the router's calculateAmountToCharge divides by zero;
      // above it the token underflows on every taxed transfer.
      for (const bps of [10000n, 12000n]) {
        setTax(bps);

        expect(supports(AEROSTRAT.address, AERO.address, SwapSide.SELL)).toBe(
          false,
        );
        expect(
          await aerostrat.getPoolIdentifiers(AEROSTRAT, AERO, SwapSide.SELL, 1),
        ).toEqual([]);
        expect(
          await aerostrat.getPricesVolume(
            AEROSTRAT,
            AERO,
            [0n, BI_POWS[18]],
            SwapSide.SELL,
            1,
          ),
        ).toBeNull();
      }
    });
  });

  describe('tax arithmetic', () => {
    beforeEach(() => setTax(1000n));

    it('reduces the input the pool sees when selling AEROSTRAT', () => {
      expect(toPoolAmounts([1000n * BI_POWS[18]], SwapSide.SELL, true)).toEqual(
        [900n * BI_POWS[18]],
      );
      // Prices are the untaxed AERO output, so they pass through untouched.
      expect(toUserPrices([123n], SwapSide.SELL, true)).toEqual([123n]);
    });

    it('reduces the delivered amount when buying AEROSTRAT via an exact-input sell', () => {
      // The pool is priced normally; the recipient is taxed on the way out.
      expect(
        toPoolAmounts([1000n * BI_POWS[18]], SwapSide.SELL, false),
      ).toEqual([1000n * BI_POWS[18]]);
      expect(toUserPrices([1000n * BI_POWS[18]], SwapSide.SELL, false)).toEqual(
        [900n * BI_POWS[18]],
      );
    });

    it('grosses up the requested output on an exact-output buy of AEROSTRAT', () => {
      // To leave the recipient with 900 after a 10% tax the pool must emit 1000.
      expect(toPoolAmounts([900n * BI_POWS[18]], SwapSide.BUY, false)).toEqual([
        1000n * BI_POWS[18],
      ]);
      // Prices are the AERO required for that grossed output; no further change.
      expect(toUserPrices([456n], SwapSide.BUY, false)).toEqual([456n]);
    });

    it('matches the token rounding rather than flooring the remainder', () => {
      // Aerostrategy._update computes feeAmount = amount * fee / BPS and
      // transfers amount - feeAmount, so 1e18 + 1 leaves 9e17 + 1, not 9e17.
      const odd = BI_POWS[18] + 1n;
      expect(toPoolAmounts([odd], SwapSide.SELL, true)).toEqual([
        900000000000000001n,
      ]);
    });

    it('preserves zero amounts in every direction', () => {
      expect(toPoolAmounts([0n], SwapSide.SELL, true)).toEqual([0n]);
      expect(toPoolAmounts([0n], SwapSide.BUY, false)).toEqual([0n]);
      expect(toUserPrices([0n], SwapSide.SELL, false)).toEqual([0n]);
    });
  });
});
