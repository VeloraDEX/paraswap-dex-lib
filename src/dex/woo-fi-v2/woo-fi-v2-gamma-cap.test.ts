/**
 * WooFiV2 pricing must not quote swaps above the pool's per-token swap-size
 * caps: WooPPV2._calcQuoteAmountSellBase / _calcBaseAmountSellQuote revert
 * with "WooPPV2: !gamma" (gamma = k * price * amount > maxGamma) and
 * "WooPPV2: !maxNotionalValue" (notional > maxNotionalSwap) — both read from
 * tokenInfos(baseToken), which the TS pricing already fetches but ignored.
 *
 * Regression for prod fallback routes (Base cbBTC->USDC, ~$21.5k) quoted fine
 * by TS pricing but reverting on-chain with the !gamma custom error: the
 * pool's maxGamma (1e14) capped swaps at ~$10k notional.
 */
import { WooFiV2Math } from './woo-fi-v2-math';
import { PoolState } from './types';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';

const dummyLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  log: () => {},
} as any;

// Real Base WooPP state at block 48681324 (route f9927d91).
const CBBTC_PRICE = 6477825010912n; // $64,778.25, 8 price decimals
const CBBTC_STATE = {
  price: CBBTC_PRICE,
  spread: 397000000000000n,
  coeff: 10000000000n, // 1e10
  woFeasible: true,
};

const makeState = (over: {
  maxGamma: bigint;
  maxNotionalSwap: bigint;
}): PoolState => ({
  tokenInfos: {
    [CBBTC]: {
      reserve: 72863500n,
      feeRate: 5n,
      maxGamma: over.maxGamma,
      maxNotionalSwap: over.maxNotionalSwap,
      capBal: 2n ** 190n,
    },
    [USDC]: {
      reserve: 1000000000000n, // $1m
      feeRate: 5n,
      maxGamma: over.maxGamma,
      maxNotionalSwap: over.maxNotionalSwap,
      capBal: 2n ** 190n,
    },
  },
  tokenStates: { [CBBTC]: { ...CBBTC_STATE } },
  decimals: {
    [CBBTC]: { priceDec: 10n ** 8n, quoteDec: 10n ** 6n, baseDec: 10n ** 8n },
  },
  oracleTimestamp: 0n,
  isPaused: false,
});

// The failing prod amount: 0.332 cbBTC (~$21.5k) with the pool's real caps.
const PROD_AMOUNT = 33205199n;
const REAL_MAX_GAMMA = 100000000000000n; // 1e14
const REAL_MAX_NOTIONAL = 200000000000n; // $200k, 6dp

describe('WooFiV2 swap-size caps (!gamma / !maxNotionalValue mirror)', () => {
  const makeMath = (over: { maxGamma: bigint; maxNotionalSwap: bigint }) => {
    const math = new WooFiV2Math(dummyLogger, USDC);
    math.state = makeState(over);
    return math;
  };

  describe('sellBase (cbBTC -> USDC)', () => {
    it('returns 0 when gamma exceeds maxGamma (the prod route)', () => {
      const math = makeMath({
        maxGamma: REAL_MAX_GAMMA,
        maxNotionalSwap: REAL_MAX_NOTIONAL,
      });
      // gamma = amount * price * coeff / priceDec / baseDec ≈ 2.15e14 > 1e14
      const out = math.query(CBBTC, USDC, [PROD_AMOUNT]);
      expect(out).toEqual([0n]);
    });

    it('returns 0 when the notional exceeds maxNotionalSwap', () => {
      const math = makeMath({
        maxGamma: 2n ** 100n, // gamma cap out of the way
        maxNotionalSwap: 10000000000n, // $10k < $21.5k notional
      });
      const out = math.query(CBBTC, USDC, [PROD_AMOUNT]);
      expect(out).toEqual([0n]);
    });

    it('quotes normally under both caps', () => {
      const math = makeMath({
        maxGamma: REAL_MAX_GAMMA,
        maxNotionalSwap: REAL_MAX_NOTIONAL,
      });
      // 0.01 cbBTC (~$648): gamma ≈ 6.5e12, well under 1e14
      const out = math.query(CBBTC, USDC, [1000000n]);
      expect(out![0]).toBeGreaterThan(0n);
    });
  });

  describe('sellQuote (USDC -> cbBTC)', () => {
    it('returns 0 when gamma exceeds maxGamma', () => {
      const math = makeMath({
        // gamma = quoteAmount * coeff / quoteDec = $21.5k * 1e10 / 1e6 = 2.15e11
        maxGamma: 100000000000n, // 1e11 < 2.15e11
        maxNotionalSwap: REAL_MAX_NOTIONAL,
      });
      const out = math.query(USDC, CBBTC, [21500000000n]);
      expect(out).toEqual([0n]);
    });

    it('returns 0 when the quote amount exceeds maxNotionalSwap', () => {
      const math = makeMath({
        maxGamma: 2n ** 100n,
        maxNotionalSwap: 10000000000n, // $10k
      });
      const out = math.query(USDC, CBBTC, [21500000000n]);
      expect(out).toEqual([0n]);
    });

    it('quotes normally under both caps', () => {
      const math = makeMath({
        maxGamma: REAL_MAX_GAMMA,
        maxNotionalSwap: REAL_MAX_NOTIONAL,
      });
      const out = math.query(USDC, CBBTC, [648000000n]); // $648
      expect(out![0]).toBeGreaterThan(0n);
    });
  });
});
