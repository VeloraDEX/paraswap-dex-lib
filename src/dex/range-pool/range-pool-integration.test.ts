/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { RangePool } from './range-pool';
import { isPoolLive } from './getOnChainState';
import { PoolState } from './types';
import { RANGES_STATS_API_BASE, RangePoolConfig } from './config';
import RangeRouterABI from '../../abi/range-pool/RangeRouter.json';

const network = Network.MAINNET;
const dexKey = 'RangePool';

// Live mainnet Range Pools (see balancer-v3-monorepo/pkg/pool-range/deployments/1).
const ROME = '0x2bd1f344a2398340c2b1119da98816ea723f5f0f';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const ROME_USDT_POOL = '0xaf037e69f0fa8d1633443cc0c67d0b73e3694b36';
const TOP_CRYPTO_POOL = '0x67c02fc8f5a4140077999014efa7fe9d0ee2f29b';

const WAD = 10n ** 18n;

describe('RangePool — Stage 2: discovery & on-chain state', () => {
  let dexHelper: DummyDexHelper;
  let rangePool: RangePool;
  let blockNumber: number;
  let states: Record<string, PoolState>;

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    rangePool = new RangePool(network, dexKey, dexHelper);
    await rangePool.initializePricing(blockNumber);
    // poolStates is protected; the test reads it intentionally.
    states = (rangePool as any).poolStates;
  });

  it('enumerates the live pools from the factory', () => {
    expect(Object.keys(states).length).toBeGreaterThanOrEqual(2);
    expect(states[ROME_USDT_POOL]).toBeDefined();
    expect(states[TOP_CRYPTO_POOL]).toBeDefined();
  });

  it('decodes ROME/USDT immutable + dynamic data with ALL six flags', () => {
    const s = states[ROME_USDT_POOL];
    expect(s.tokens).toEqual([ROME, USDT]);
    expect(s.weights).toEqual([WAD / 2n, WAD / 2n]);
    expect(s.scalingFactors).toEqual([10n ** 12n, 10n ** 12n]); // both 6-decimals
    expect(s.virtualBalances).toHaveLength(2);
    expect(s.balancesLiveScaled18).toHaveLength(2);
    expect(s.virtualBalances[0]).toBeGreaterThan(0n);
    expect(s.tokenRates).toEqual([WAD, WAD]); // standard tokens
    expect(s.swapFeePercentage).toBeGreaterThan(0n);
    // All six liveness flags decoded (the ranges-stats reader only exposed three).
    for (const k of [
      'isPoolRegistered',
      'isPoolInitialized',
      'isPoolPaused',
      'isPoolInRecoveryMode',
      'isVaultPaused',
      'isHookStopped',
    ] as const) {
      expect(typeof s[k]).toBe('boolean');
    }
    expect(s.isPoolRegistered).toBe(true);
    expect(s.isPoolInitialized).toBe(true);
    expect(isPoolLive(s)).toBe(true);
  });

  it('decodes the 8-token pool', () => {
    const s = states[TOP_CRYPTO_POOL];
    expect(s.tokens).toHaveLength(8);
    expect(s.weights).toHaveLength(8);
    expect(s.virtualBalances).toHaveLength(8);
    const weightSum = s.weights.reduce((a, b) => a + b, 0n);
    expect(weightSum).toBe(WAD); // normalized weights sum to 1e18
  });

  it('getPoolIdentifiers returns the ROME/USDT pool for the pair', async () => {
    const ids = await rangePool.getPoolIdentifiers(
      { address: ROME, decimals: 6 },
      { address: USDT, decimals: 6 },
      SwapSide.SELL,
      blockNumber,
    );
    expect(ids).toContain(`${dexKey}_${ROME_USDT_POOL}`);
  });

  it('getPoolIdentifiers returns nothing for a same-token pair', async () => {
    const same = await rangePool.getPoolIdentifiers(
      { address: ROME, decimals: 6 },
      { address: ROME, decimals: 6 },
      SwapSide.SELL,
      blockNumber,
    );
    expect(same).toEqual([]);
  });

  it('cross-checks decode against the ranges-stats API (tokens/weights/fact)', async () => {
    let api: any;
    try {
      const res = await fetch(
        `${RANGES_STATS_API_BASE}/pools/${ROME_USDT_POOL}`,
      );
      if (!res.ok) {
        console.warn(`API ${res.status} — skipping cross-check`);
        return;
      }
      api = await res.json();
    } catch (e) {
      console.warn('API unreachable — skipping cross-check', e);
      return;
    }

    const s = states[ROME_USDT_POOL];
    // Immutable fields can't drift between blocks — assert strictly.
    expect(api.tokens.map((t: any) => t.address.toLowerCase())).toEqual(
      s.tokens,
    );
    // API weight is a percent string ("50"); ours is scaled18 (0.5e18).
    api.tokens.forEach((t: any, i: number) => {
      expect((BigInt(t.weight) * WAD) / 100n).toEqual(s.weights[i]);
    });
    // Fact balances change only on swaps (this pool is low-volume) — allow a small
    // relative drift for block skew between our read and the API snapshot.
    api.tokens.forEach((t: any, i: number) => {
      const apiFactScaled18 =
        BigInt(Math.round(Number(t.factBalance) * 1e6)) * 10n ** 12n;
      const mine = s.balancesLiveScaled18[i];
      const diff =
        mine > apiFactScaled18
          ? mine - apiFactScaled18
          : apiFactScaled18 - mine;
      const tol = (apiFactScaled18 || 1n) / 100n; // 1%
      expect(diff).toBeLessThanOrEqual(tol);
    });
  });
});

// THE Stage 3 gate: connector's getPricesVolume must equal the on-chain Router query to the
// wei, for both live pools, both sides, across a sweep of amounts. Both pools are read once at
// the same block; the Router query (tx.origin==0 ⇒ Balancer V3 query mode) and our cached-state
// emulation must agree exactly. Each query is an isolated eth_call (see queryRouter), so a
// reverted query (e.g. an EXACT_OUT larger than the pool can serve) is surfaced per-amount and
// the connector must report zero price for it.
describe('RangePool — Stage 3: price parity vs Router querySwap', () => {
  let dexHelper: DummyDexHelper;
  let rangePool: RangePool;
  let blockNumber: number;
  let states: Record<string, PoolState>;

  const routerIface = new Interface(RangeRouterABI);
  const ROUTER = RangePoolConfig[dexKey][network].routerAddress;
  const SENDER = '0x0000000000000000000000000000000000000000';

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    rangePool = new RangePool(network, dexKey, dexHelper);
    await rangePool.initializePricing(blockNumber);
    states = (rangePool as any).poolStates;
  });

  // decimalScalingFactor = 10^(18 - decimals) ⇒ decimals = 18 - log10(sf).
  const decimalsFromScalingFactor = (sf: bigint): number => {
    let d = 0;
    let x = sf;
    while (x > 1n) {
      x /= 10n;
      d++;
    }
    return 18 - d;
  };

  const frac = (base: bigint, micros: bigint): bigint =>
    (base * micros) / 1_000_000n;

  // Per-amount Router query. CRITICAL: each query must be its OWN eth_call. The Balancer V3
  // `quote()` path runs `RangePool.onSwap`, which writes `_virtualBalances` to storage and
  // returns WITHOUT reverting; batching queries into a single eth_call (e.g. multicall) lets
  // each successive query see the virtual balances mutated by the previous one, corrupting all
  // but the first. Separate eth_calls each start from clean block state. `null` = reverted
  // on-chain (e.g. an EXACT_OUT the pool can't serve, or a sub-minimum trade amount).
  const queryRouter = (req: {
    pool: string;
    tokenIn: string;
    tokenOut: string;
    amount: bigint;
    side: SwapSide;
  }): Promise<bigint | null> => {
    const fn =
      req.side === SwapSide.SELL
        ? 'querySwapSingleTokenExactIn'
        : 'querySwapSingleTokenExactOut';
    const data = routerIface.encodeFunctionData(fn, [
      req.pool,
      req.tokenIn,
      req.tokenOut,
      req.amount.toString(),
      SENDER,
      '0x',
    ]);
    return dexHelper.web3Provider.eth
      .call({ to: ROUTER, data }, blockNumber)
      .then(ret => BigInt(routerIface.decodeFunctionResult(fn, ret)[0]))
      .catch(() => null);
  };

  const connectorPrices = async (
    tokenIn: string,
    tokenOut: string,
    decIn: number,
    decOut: number,
    amounts: bigint[],
    side: SwapSide,
    pool: string,
  ): Promise<bigint[]> => {
    const ex = await rangePool.getPricesVolume(
      { address: tokenIn, decimals: decIn },
      { address: tokenOut, decimals: decOut },
      amounts,
      side,
      blockNumber,
      [`${dexKey}_${pool}`],
    );
    expect(ex).not.toBeNull();
    const entry = ex!.find(p => p.poolIdentifiers?.[0] === `${dexKey}_${pool}`);
    expect(entry).toBeDefined();
    return entry!.prices;
  };

  // Sweep both directions of a pair and assert exact parity for every amount the Router
  // accepts, plus zero-price parity for an oversized EXACT_OUT the pool can't serve.
  const runParity = async (
    pool: string,
    tokenIn: string,
    tokenOut: string,
  ): Promise<number> => {
    const s = states[pool];
    const iIn = s.tokens.indexOf(tokenIn);
    const iOut = s.tokens.indexOf(tokenOut);
    expect(iIn).toBeGreaterThanOrEqual(0);
    expect(iOut).toBeGreaterThanOrEqual(0);

    const sfIn = s.scalingFactors[iIn];
    const sfOut = s.scalingFactors[iOut];
    const decIn = decimalsFromScalingFactor(sfIn);
    const decOut = decimalsFromScalingFactor(sfOut);
    const factInRaw = s.balancesLiveScaled18[iIn] / sfIn;
    const factOutRaw = s.balancesLiveScaled18[iOut] / sfOut;

    // Fractions (in millionths) of the relevant fact balance — small to near-drain.
    const micros = [
      100n,
      1_000n,
      10_000n,
      50_000n,
      100_000n,
      250_000n,
      500_000n,
      900_000n,
    ];

    const sellAmounts = micros.map(m => frac(factInRaw, m)).filter(a => a > 0n);
    const buyAmounts = micros.map(m => frac(factOutRaw, m)).filter(a => a > 0n);
    // Oversized EXACT_OUT: draining the whole fact balance must revert on-chain ⇒ zero price.
    buyAmounts.push(factOutRaw);

    const [sellPrices, buyPrices, sellExpected, buyExpected] =
      await Promise.all([
        connectorPrices(
          tokenIn,
          tokenOut,
          decIn,
          decOut,
          sellAmounts,
          SwapSide.SELL,
          pool,
        ),
        connectorPrices(
          tokenIn,
          tokenOut,
          decIn,
          decOut,
          buyAmounts,
          SwapSide.BUY,
          pool,
        ),
        Promise.all(
          sellAmounts.map(amount =>
            queryRouter({
              pool,
              tokenIn,
              tokenOut,
              amount,
              side: SwapSide.SELL,
            }),
          ),
        ),
        Promise.all(
          buyAmounts.map(amount =>
            queryRouter({
              pool,
              tokenIn,
              tokenOut,
              amount,
              side: SwapSide.BUY,
            }),
          ),
        ),
      ]);

    let checked = 0;
    sellAmounts.forEach((amount, i) => {
      if (sellExpected[i] === null) {
        // Router reverted (e.g. sub-minimum trade amount) ⇒ connector must report no price.
        expect({ amount, side: 'SELL', got: sellPrices[i] }).toEqual({
          amount,
          side: 'SELL',
          got: 0n,
        });
        return;
      }
      expect({ amount, side: 'SELL', got: sellPrices[i] }).toEqual({
        amount,
        side: 'SELL',
        got: sellExpected[i],
      });
      checked++;
    });
    buyAmounts.forEach((amount, i) => {
      if (buyExpected[i] === null) {
        // Router reverted (pool can't serve this exact-out) ⇒ connector reports no price.
        expect({ amount, side: 'BUY', got: buyPrices[i] }).toEqual({
          amount,
          side: 'BUY',
          got: 0n,
        });
        return;
      }
      expect({ amount, side: 'BUY', got: buyPrices[i] }).toEqual({
        amount,
        side: 'BUY',
        got: buyExpected[i],
      });
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
    return checked;
  };

  it('ROME/USDT (2-token): parity both directions, both sides', async () => {
    let total = 0;
    total += await runParity(ROME_USDT_POOL, ROME, USDT);
    total += await runParity(ROME_USDT_POOL, USDT, ROME);
    expect(total).toBeGreaterThan(0);
  });

  it('TOP CRYPTO (8-token): parity both directions, both sides', async () => {
    const tokens = states[TOP_CRYPTO_POOL].tokens;
    let total = 0;
    total += await runParity(TOP_CRYPTO_POOL, tokens[0], tokens[1]);
    total += await runParity(TOP_CRYPTO_POOL, tokens[1], tokens[0]);
    expect(total).toBeGreaterThan(0);
  });

  // Regression guard for the MINIMUM_TRADE_AMOUNT gate. Our custom Vault uses 1e12 (NOT
  // Balancer's canonical 1e6) and reverts (TradeAmountTooSmall) when the scaled input OR
  // output is below it. Deterministically hit that regime on an 18-decimal token (scaling
  // factor 1, so a raw amount < 1e12 scales below the minimum) and assert the sim reports
  // no price exactly when the chain reverts, on both sides.
  it('dust below MINIMUM_TRADE_AMOUNT: sim no-price ⟺ chain reverts (both sides)', async () => {
    const s = states[TOP_CRYPTO_POOL];
    // Wiring check: the min trade amount was read from the Vault (1e12, not 1e6).
    expect(s.minimumTradeAmount).toBe(10n ** 12n);

    const i18 = s.scalingFactors.findIndex(sf => sf === 1n); // an 18-decimal token
    expect(i18).toBeGreaterThanOrEqual(0);
    const iOther = s.scalingFactors.findIndex((_, i) => i !== i18);
    const token18 = s.tokens[i18];
    const tokenOther = s.tokens[iOther];
    const decOther = decimalsFromScalingFactor(s.scalingFactors[iOther]);

    // scaled18 == raw for the 18-dec token; 1e11 < 1e12 ⇒ below the minimum trade amount.
    const dust = 10n ** 11n;

    // EXACT_IN: sub-minimum input (18-dec token in).
    const [sellPrices, sellChain] = await Promise.all([
      connectorPrices(
        token18,
        tokenOther,
        18,
        decOther,
        [dust],
        SwapSide.SELL,
        TOP_CRYPTO_POOL,
      ),
      queryRouter({
        pool: TOP_CRYPTO_POOL,
        tokenIn: token18,
        tokenOut: tokenOther,
        amount: dust,
        side: SwapSide.SELL,
      }),
    ]);
    expect(sellChain).toBeNull(); // Vault reverts on-chain
    expect(sellPrices[0]).toBe(0n); // connector reports no price

    // EXACT_OUT: sub-minimum requested output (18-dec token out).
    const [buyPrices, buyChain] = await Promise.all([
      connectorPrices(
        tokenOther,
        token18,
        decOther,
        18,
        [dust],
        SwapSide.BUY,
        TOP_CRYPTO_POOL,
      ),
      queryRouter({
        pool: TOP_CRYPTO_POOL,
        tokenIn: tokenOther,
        tokenOut: token18,
        amount: dust,
        side: SwapSide.BUY,
      }),
    ]);
    expect(buyChain).toBeNull();
    expect(buyPrices[0]).toBe(0n);
  });

  // Fix 5 (per-amount error isolation). calcOutGivenIn runs LogExpMath.pow BEFORE the
  // fact-balance cap. On a pool whose weight ratio wIn/wOut is NOT a powUp short-circuit
  // (1/2/4) AND wIn > wOut (exponent > 1e18), a large exact-in drives the curve base to 1;
  // pow(1, exponent) then overflows MIN_NATURAL_EXPONENT (PRODUCT_OUT_OF_BOUNDS). A single
  // such amount must NOT null every other price for the pair — getPricesVolume isolates the
  // throw per amount (that amount → 0, the rest keep their exact prices). Chain parity
  // holds: the oversized amount reverts on-chain too (same vendored math), so 0 is the
  // correct "no executable price" (revert⟺0). The 8-token pool has unequal integer-percent
  // weights (7/10/20/…), so such a pair exists; the 50/50 and 80/20 pools short-circuit.
  it('oversized exact-in overflows pow → that amount prices 0, smaller amounts unaffected', async () => {
    const s = states[TOP_CRYPTO_POOL];
    const SHORTCUTS = [WAD, 2n * WAD, 4n * WAD];
    // Find a pair whose exponent divDown(wIn, wOut) is > 1e18 (so base→1 overflows pow)
    // and bypasses the powUp fast path.
    let iIn = -1;
    let iOut = -1;
    for (let a = 0; a < s.tokens.length && iIn < 0; a++) {
      for (let b = 0; b < s.tokens.length; b++) {
        if (a === b) continue;
        const exponent = (s.weights[a] * WAD) / s.weights[b]; // divDown
        if (exponent > WAD && !SHORTCUTS.includes(exponent)) {
          iIn = a;
          iOut = b;
          break;
        }
      }
    }
    expect(iIn).toBeGreaterThanOrEqual(0); // such a pair must exist in this pool

    const tokenIn = s.tokens[iIn];
    const tokenOut = s.tokens[iOut];
    const sfIn = s.scalingFactors[iIn];
    const sfOut = s.scalingFactors[iOut];
    const decIn = decimalsFromScalingFactor(sfIn);
    const decOut = decimalsFromScalingFactor(sfOut);
    const factInRaw = s.balancesLiveScaled18[iIn] / sfIn;

    const small = frac(factInRaw, 1_000n); // 0.1% of fact — safely priceable
    expect(small).toBeGreaterThan(0n);
    // ≫ virtual balance ⇒ base = divUp(vIn, vIn + amountIn) collapses to 1 ⇒ pow overflows.
    // Sized off the virtual balance (×1e20) rather than a fixed constant so it drives base
    // to 1 without overflowing the Vault's uint256 scaling on-chain (a fixed 1e60 does).
    const huge = (s.virtualBalances[iIn] * 10n ** 20n) / sfIn;
    expect(huge).toBeGreaterThan(small);

    // connectorPrices asserts the result is NOT null — the crux of the fix: without
    // per-amount isolation the throwing `huge` would null the entire pair's prices.
    const [prices, smallChain, hugeChain] = await Promise.all([
      connectorPrices(
        tokenIn,
        tokenOut,
        decIn,
        decOut,
        [small, huge],
        SwapSide.SELL,
        TOP_CRYPTO_POOL,
      ),
      queryRouter({
        pool: TOP_CRYPTO_POOL,
        tokenIn,
        tokenOut,
        amount: small,
        side: SwapSide.SELL,
      }),
      queryRouter({
        pool: TOP_CRYPTO_POOL,
        tokenIn,
        tokenOut,
        amount: huge,
        side: SwapSide.SELL,
      }),
    ]);

    // The oversized amount overflows pow on-chain too ⇒ Router reverts (no price).
    expect(hugeChain).toBeNull();
    expect(prices[1]).toBe(0n); // isolated to 0, not a thrown null for the whole pair
    // The smaller amount is unaffected and still bit-exact vs the Router.
    expect(smallChain).not.toBeNull();
    expect(prices[0]).toBeGreaterThan(0n);
    expect(prices[0]).toBe(smallChain);
  });

  it('returns no price for a non-live (filtered) pool pair', async () => {
    // Same token both sides ⇒ never priced (mirrors getPoolIdentifiers).
    const ex = await rangePool.getPricesVolume(
      { address: ROME, decimals: 6 },
      { address: ROME, decimals: 6 },
      [10n ** 6n],
      SwapSide.SELL,
      blockNumber,
    );
    expect(ex).toBeNull();
  });
});
