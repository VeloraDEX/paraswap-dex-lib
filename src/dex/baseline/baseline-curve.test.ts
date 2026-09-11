import { WAD } from './baseline-math';
import { CurveParams, QuoteState } from './types';
import {
  computeActivePrice,
  computeSwap,
  quoteSellExactIn,
  quoteBuyExactIn,
  quoteBuyExactOut,
  applyQuoteState,
  advanceSnapshot,
  computeInvariant,
  TARGET_CONVEXITY,
} from './baseline-curve';

// A balanced pool: half the supply circulating, reserves at 3x the floor, n = 2.
function makeSnapshot(): CurveParams {
  return {
    blv: 2n * WAD,
    circ: 500_000n * WAD,
    supply: 500_000n * WAD,
    swapFee: 3_000_000_000_000_000n, // 0.3%
    reserves: 1_500_000n * WAD,
    totalSupply: 1_000_000n * WAD,
    convexityExp: TARGET_CONVEXITY,
    lastInvariant: 500_000n * WAD,
  };
}

function makeState(): QuoteState {
  return {
    snapshotCurveParams: makeSnapshot(),
    quoteBlockBuyDeltaCirc: 0n,
    quoteBlockSellDeltaCirc: 0n,
    totalSupply: 1_000_000n * WAD,
    totalBTokens: 500_000n * WAD,
    totalReserves: 1_500_000n * WAD,
    reserveDecimals: 18,
    liquidityFeePct: WAD,
    pendingSurplus: 0n,
    settlePendingSurplus: false,
    maxSellDelta: 100_000n * WAD,
    snapshotActivePrice: 0n,
  };
}

describe('Baseline curve math', () => {
  describe('computeActivePrice', () => {
    it('returns the marginal price BLV + premium', () => {
      expect(computeActivePrice(makeSnapshot())).toEqual(6n * WAD);
    });

    it('collapses to BLV when nothing is circulating', () => {
      const p = makeSnapshot();
      p.circ = 0n;
      expect(computeActivePrice(p)).toEqual(p.blv);
    });
  });

  describe('computeSwap', () => {
    it('prices a buy: user pays reserves, curve gains value', () => {
      const { userDelta, fee, invariantDelta } = computeSwap(
        makeSnapshot(),
        WAD,
      );
      expect(userDelta).toEqual(-6012032000144000517n);
      expect(fee).toEqual(12016000095500517n);
      expect(invariantDelta).toEqual(-6000016000048500000n);
    });

    it('prices a sell: user receives reserves, curve releases value', () => {
      const { userDelta, fee, invariantDelta } = computeSwap(
        makeSnapshot(),
        -WAD,
      );
      expect(userDelta).toEqual(5975968192143135495n);
      expect(fee).toEqual(24015807904364257n);
      expect(invariantDelta).toEqual(5999984000047499752n);
    });

    it('rejects a trade larger than the curve admits', () => {
      expect(() => computeSwap(makeSnapshot(), 600_000n * WAD)).toThrow();
    });
  });

  describe('quote functions', () => {
    // [amount, expected returned amount, expected fee]
    it.each([
      [WAD, 5975968192143135495n, 24015807904364257n],
      [10n * WAD, 59756819343130910930n, 241580704867029194n],
      [100n * WAD, 597282063085123100700n, 2557984902078400483n],
      [1000n * WAD, 5944334628657832089000n, 39713243661400915444n],
    ])('sell %s bTokens for exact-in reserves out', (amount, out, fee) => {
      const q = quoteSellExactIn(makeState(), amount);
      expect(q.amount).toEqual(out);
      expect(q.fee).toEqual(fee);
    });

    // buyExactIn solves for the largest buy whose cost fits the reserves spent:
    // the cost of the bTokens returned must not exceed the input, within one ppm.
    it.each([WAD, 100n * WAD, 1000n * WAD])(
      'buys the most bTokens affordable with %s reserves',
      amount => {
        const bought = quoteBuyExactIn(makeState(), amount).amount;
        const cost = quoteBuyExactOut(makeState(), bought).amount;
        expect(cost).toBeLessThanOrEqual(amount);
        expect(amount - cost).toBeLessThanOrEqual(amount / 1_000_000n + 1n);
      },
    );

    it('buys more bTokens for more reserves', () => {
      const small = quoteBuyExactIn(makeState(), WAD).amount;
      const large = quoteBuyExactIn(makeState(), 10n * WAD).amount;
      expect(large).toBeGreaterThan(small);
    });

    it.each([
      [WAD, 6012032000144000517n, 12016000095500517n],
      [10n * WAD, 60123200144005120180n, 121600096003620180n],
      [100n * WAD, 601520144051216004100n, 1360096038413504100n],
      [1000n * WAD, 6044144513604620579000n, 28096385283850579000n],
    ])('buy exact %s bTokens for reserves in', (amount, cost, fee) => {
      const q = quoteBuyExactOut(makeState(), amount);
      expect(q.amount).toEqual(cost);
      expect(q.fee).toEqual(fee);
    });

    it('yields less selling a bToken than it costs to buy it back', () => {
      const yieldOut = quoteSellExactIn(makeState(), WAD).amount;
      const buyBackCost = quoteBuyExactOut(makeState(), WAD).amount;
      expect(buyBackCost).toBeGreaterThan(yieldOut);
    });

    it('returns more reserves for a larger sell', () => {
      const small = quoteSellExactIn(makeState(), WAD).amount;
      const large = quoteSellExactIn(makeState(), 10n * WAD).amount;
      expect(large).toBeGreaterThan(small);
    });

    it('rejects a sell beyond the same-block capacity', () => {
      expect(() => quoteSellExactIn(makeState(), 200_000n * WAD)).toThrow();
    });
  });

  describe('applyQuoteState', () => {
    // reserveDelta is the curve delta (negative = user pays in); fee is kept by the pool.
    it('settles stale surplus below the safety threshold, then records new fee', () => {
      const state = makeState();
      state.totalSupply = 100n * WAD;
      state.totalBTokens = 94n * WAD; // below 95% safety threshold
      state.totalReserves = 1000n;
      state.pendingSurplus = 25n;
      state.settlePendingSurplus = true;

      applyQuoteState(state, 10n, -100n, 3n);

      expect(state.totalReserves).toEqual(1122n); // 1000 + 25 surplus + 100 - 3 fee
      expect(state.pendingSurplus).toEqual(3n); // liquidity fee recorded for next block
      expect(state.settlePendingSurplus).toBe(false);
    });

    it('does not release surplus above the safety threshold', () => {
      const state = makeState();
      state.totalSupply = 100n * WAD;
      state.totalBTokens = 96n * WAD; // above 95% safety threshold
      state.totalReserves = 1000n;
      state.pendingSurplus = 25n;
      state.settlePendingSurplus = true;

      applyQuoteState(state, 10n, -100n, 3n);

      expect(state.totalReserves).toEqual(1097n); // 1000 + 100 - 3, no surplus release
      expect(state.pendingSurplus).toEqual(0n);
      expect(state.settlePendingSurplus).toBe(false);
    });

    it('accrues fees across same-block swaps without settling them', () => {
      const state = makeState();
      state.totalSupply = 100n * WAD;
      state.totalBTokens = 94n * WAD;
      state.totalReserves = 1000n;
      state.pendingSurplus = 0n;

      applyQuoteState(state, 10n, -100n, 3n);
      applyQuoteState(state, 10n, -100n, 3n);

      expect(state.totalReserves).toEqual(1194n);
      expect(state.pendingSurplus).toEqual(6n);
    });
  });

  describe('advanceSnapshot', () => {
    // A block that traded, still below the safety threshold, on an n = 2 curve.
    function makeTradedState(): QuoteState {
      const state = makeState();
      state.quoteBlockSellDeltaCirc = 1000n * WAD;
      state.pendingSurplus = 7n * WAD;
      return state;
    }

    it('returns the state untouched when no flow accumulated', () => {
      const state = makeState();
      expect(advanceSnapshot(state)).toBe(state);
    });

    it('defers to a refetch in the safety regime', () => {
      const state = makeTradedState();
      state.totalBTokens = 960_000n * WAD; // 96% of supply, above the threshold
      expect(advanceSnapshot(state)).toBeNull();
    });

    it('defers to a refetch when the convexity is still relaxing', () => {
      const state = makeTradedState();
      state.snapshotCurveParams.convexityExp = TARGET_CONVEXITY + WAD;
      expect(advanceSnapshot(state)).toBeNull();
    });

    it('commits pending surplus and resets the block accumulators', () => {
      const state = makeTradedState();
      const advanced = advanceSnapshot(state);

      expect(advanced).not.toBeNull();
      expect(advanced!.totalReserves).toEqual(
        state.totalReserves + state.pendingSurplus,
      );
      expect(advanced!.pendingSurplus).toEqual(0n);
      expect(advanced!.settlePendingSurplus).toBe(false);
      expect(advanced!.quoteBlockBuyDeltaCirc).toEqual(0n);
      expect(advanced!.quoteBlockSellDeltaCirc).toEqual(0n);
      expect(advanced!.maxSellDelta).toEqual(
        advanced!.snapshotCurveParams.circ,
      );
      expect(advanced!.snapshotActivePrice).toEqual(
        computeActivePrice(advanced!.snapshotCurveParams),
      );
    });
  });

  // Regimes that mainstream pools never enter: pools launched with near-zero
  // reserves trade at the BLV floor (ZRP-style), where the sell floor binds and
  // rounding quantizes; high-convexity pools bound the solvers.
  describe('edge regimes', () => {
    // A pool at the floor: a 1-token buffer over BLV-backed reserves, with a
    // chunk of the circulation already sold this block.
    function makeFloorState(priorSellWad: bigint): QuoteState {
      const snapshot = makeSnapshot();
      snapshot.reserves = 1_000_000n * WAD + WAD; // blv*circ + 1 buffer
      snapshot.lastInvariant = computeInvariant(snapshot);
      const state = makeState();
      state.snapshotCurveParams = snapshot;
      state.totalReserves = snapshot.reserves;
      state.quoteBlockSellDeltaCirc = priorSellWad;
      state.maxSellDelta = 450_000n * WAD;
      return state;
    }

    it('terminal exit pays the raw BLV floor with no fee', () => {
      // Selling the entire circulation: receipt is exactly blv * circ.
      const { userDelta, fee, invariantDelta } = computeSwap(
        makeSnapshot(),
        -500_000n * WAD,
      );
      expect(userDelta).toEqual(1_000_000n * WAD);
      expect(fee).toEqual(500_000n * WAD);
      expect(invariantDelta).toEqual(1_500_000n * WAD);
    });

    it('terminal exit prices through the quote path', () => {
      const state = makeState();
      state.maxSellDelta = 500_000n * WAD;
      const { amount, fee } = quoteSellExactIn(state, 500_000n * WAD);
      expect(amount).toEqual(1_000_000n * WAD);
      expect(fee).toEqual(500_000n * WAD);
    });

    it('raises a floor-binding sell slice to exactly BLV per token', () => {
      // After 300k of same-block sells on a 1-token buffer, cumulative
      // differencing alone would pay below the floor; the payout must be
      // raised to blv * amount, with the excess taken from the fee.
      const state = makeFloorState(300_000n * WAD);
      const blv = state.snapshotCurveParams.blv;
      for (const sold of [1_000n * WAD, 10_000n * WAD, 100_000n * WAD]) {
        const { amount } = quoteSellExactIn(state, sold);
        expect(amount).toEqual((blv * sold) / WAD);
      }
    });

    it('never pays a sell below the BLV floor across the flow range', () => {
      const state = makeFloorState(0n);
      const blv = state.snapshotCurveParams.blv;
      for (const prior of [0n, 50_000n * WAD, 200_000n * WAD, 400_000n * WAD]) {
        state.quoteBlockSellDeltaCirc = prior;
        for (const sold of [WAD, 777n * WAD, 25_000n * WAD]) {
          const { amount } = quoteSellExactIn(state, sold);
          expect(amount).toBeGreaterThanOrEqual((blv * sold) / WAD);
        }
      }
    });
  });
});
