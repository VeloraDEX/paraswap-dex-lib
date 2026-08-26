import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../../../dex-helper/index';
import { Network, SwapSide } from '../../../../constants';
import { BI_POWS } from '../../../../bigint-constants';
import { Tokens } from '../../../../../tests/constants-e2e';
import { Interface } from '@ethersproject/abi';
import { UniswapV3 } from '../../uniswap-v3';
import { UniswapV3Config } from '../../config';
import AerostratRouterABI from '../../../../abi/aerostrat/AerostratRouter.abi.json';
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
    taxBps = 1000n,
  ): bigint[] =>
    (aerostrat as any).toPoolAmounts(amounts, side, taxOnPoolInput, taxBps);
  const toUserPrices = (
    prices: bigint[],
    side: SwapSide,
    taxOnPoolInput: boolean,
    taxBps = 1000n,
  ): bigint[] =>
    (aerostrat as any).toUserPrices(prices, side, taxOnPoolInput, taxBps);

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

  describe('transaction building', () => {
    const RECIPIENT = '0xf5c4f3dc02c3fb9279495a8fef7b0741da956157';
    const config = UniswapV3Config['AerostratSlipstream'][Network.BASE];
    const routerIface = new Interface(AerostratRouterABI);

    const dataFor = (tokenIn: string, tokenOut: string, tickSpacing = '100') =>
      ({
        path: [{ tokenIn, tokenOut, fee: '500', tickSpacing }],
      } as any);
    // Buys delegate to the parent for encoding; stub it to read back the amount
    // this fork asked the pool for.
    const spySuperGetDexParam = () =>
      jest.spyOn(UniswapV3.prototype, 'getDexParam').mockReturnValue({} as any);

    afterEach(() => jest.restoreAllMocks());

    it('encodes the sell against the custom router with the pre-tax amountIn', () => {
      setTax(1000n);
      const amountIn = 1000n * BI_POWS[18];

      const param = aerostrat.getDexParam(
        AEROSTRAT.address,
        AERO.address,
        amountIn.toString(),
        '123',
        RECIPIENT,
        dataFor(AEROSTRAT.address, AERO.address),
        SwapSide.SELL,
        undefined,
        { nowTimestampMs: 1_700_000_000_000 },
      );

      expect(param.targetExchange.toLowerCase()).toEqual(
        config.taxedRouter!.toLowerCase(),
      );
      // The stock router cannot sell this token at all.
      expect(param.targetExchange.toLowerCase()).not.toEqual(
        config.router.toLowerCase(),
      );

      const [p] = routerIface.decodeFunctionData(
        'exactInputSellAEROSTRAT',
        param.exchangeData,
      );
      // Pre-tax: the router applies the tax itself.
      expect(p.amountIn.toString()).toEqual(amountIn.toString());
      expect(p.amountOutMinimum.toString()).toEqual('123');
      expect(p.tokenIn.toLowerCase()).toEqual(AEROSTRAT.address.toLowerCase());
      expect(p.tokenOut.toLowerCase()).toEqual(AERO.address.toLowerCase());
      expect(p.recipient.toLowerCase()).toEqual(RECIPIENT.toLowerCase());
      expect(p.sqrtPriceLimitX96.toString()).toEqual('0');
    });

    it('encodes tickSpacing from the pool data and rejects unsupported values', () => {
      setTax(1000n);

      const param = aerostrat.getDexParam(
        AEROSTRAT.address,
        AERO.address,
        '1',
        '1',
        RECIPIENT,
        dataFor(AEROSTRAT.address, AERO.address, '100'),
        SwapSide.SELL,
      );
      const [p] = routerIface.decodeFunctionData(
        'exactInputSellAEROSTRAT',
        param.exchangeData,
      );
      expect(p.tickSpacing).toEqual(100);

      // A caller-supplied route naming a tickSpacing this key does not own must
      // not be encoded against the taxed router.
      expect(() =>
        aerostrat.getDexParam(
          AEROSTRAT.address,
          AERO.address,
          '1',
          '1',
          RECIPIENT,
          dataFor(AEROSTRAT.address, AERO.address, '200'),
          SwapSide.SELL,
        ),
      ).toThrow(/unsupported tickSpacing/);
    });

    it('asks the pool for the grossed-up amount in exact-output BUY calldata', () => {
      setTax(1000n);
      const spy = spySuperGetDexParam();

      const userWants = 900n * BI_POWS[18];
      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        userWants.toString(),
        RECIPIENT,
        dataFor(AERO.address, AEROSTRAT.address),
        SwapSide.BUY,
      );

      // Without this the pool emits exactly 900, the recipient nets 810, and
      // Augustus reverts on received >= toAmount.
      expect(spy.mock.calls[0][3]).toEqual((1000n * BI_POWS[18]).toString());
    });

    it('hands the pool exactly what pricing grossed up', () => {
      // The gross-up lives in two places; if they ever disagree the quote is a
      // lie. Assert they agree rather than pinning each independently.
      setTax(1000n);
      const userWants = 777n * BI_POWS[18];
      const priced = toPoolAmounts([userWants], SwapSide.BUY, false)[0];

      const spy = spySuperGetDexParam();
      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        userWants.toString(),
        RECIPIENT,
        dataFor(AERO.address, AEROSTRAT.address),
        SwapSide.BUY,
      );

      expect(spy.mock.calls[0][3]).toEqual(priced.toString());
    });

    it('refuses to encode anything the pricing guards should have excluded', () => {
      setTax(1000n);
      const data = dataFor(AEROSTRAT.address, AERO.address);

      expect(() =>
        aerostrat.getDexParam(
          AEROSTRAT.address,
          AERO.address,
          '1',
          '1',
          RECIPIENT,
          data,
          SwapSide.BUY,
        ),
      ).toThrow(/BUY with AEROSTRAT input/);

      expect(() =>
        aerostrat.getDexParam(
          AEROSTRAT.address,
          AERO.address,
          '1',
          '1',
          RECIPIENT,
          { path: [...data.path, ...data.path] } as any,
          SwapSide.SELL,
        ),
      ).toThrow(/single hop/);

      // A sell encodes from the route data alone, so an expired live rate must
      // not abort a route that was quoted while the rate was fresh - a throw
      // here would kill the whole transaction build, not just this leg.
      setTax(undefined);
      expect(() =>
        aerostrat.getDexParam(
          AEROSTRAT.address,
          AERO.address,
          '1',
          '1',
          RECIPIENT,
          data,
          SwapSide.SELL,
        ),
      ).not.toThrow();
    });

    it('sizes the buy from the rate the route was priced at', () => {
      // Live state is set to a different rate on purpose: the route's rate is
      // the one the quote used, so it is the one the calldata must agree with.
      setTax(2000n);
      const userWants = 500n * BI_POWS[18];
      const atRouteRate = toPoolAmounts(
        [userWants],
        SwapSide.BUY,
        false,
        1000n,
      )[0];

      const spy = spySuperGetDexParam();

      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        userWants.toString(),
        RECIPIENT,
        { ...dataFor(AERO.address, AEROSTRAT.address), taxBps: '1000' },
        SwapSide.BUY,
      );

      expect(spy.mock.calls[0][3]).toEqual(atRouteRate.toString());
    });

    it('builds a buy on an instance that never read the rate', () => {
      // Only initializePricing populates the live rate, so an instance serving
      // builds without pricing has none. Sizing from live state there reached
      // BigInt(NaN) and threw, rejecting every leg of the caller's build.
      setTax(undefined);
      const userWants = 500n * BI_POWS[18];
      const priced = toPoolAmounts([userWants], SwapSide.BUY, false, 1000n)[0];

      const spy = spySuperGetDexParam();

      expect(() =>
        aerostrat.getDexParam(
          AERO.address,
          AEROSTRAT.address,
          '0',
          userWants.toString(),
          RECIPIENT,
          { ...dataFor(AERO.address, AEROSTRAT.address), taxBps: '1000' },
          SwapSide.BUY,
        ),
      ).not.toThrow();

      expect(spy.mock.calls[0][3]).toEqual(priced.toString());
    });

    it('falls back to the live rate for a route priced before taxBps existed', () => {
      // Deliberately not 1000n: that is toPoolAmounts' default, so a hardcoded
      // rate would satisfy this assertion without the fallback working.
      setTax(2000n);
      const userWants = 500n * BI_POWS[18];
      const priced = toPoolAmounts([userWants], SwapSide.BUY, false, 2000n)[0];

      const spy = spySuperGetDexParam();

      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        userWants.toString(),
        RECIPIENT,
        dataFor(AERO.address, AEROSTRAT.address),
        SwapSide.BUY,
      );

      expect(spy.mock.calls[0][3]).toEqual(priced.toString());
    });

    it('refuses a buy it cannot size rather than encoding one certain to revert', () => {
      // A BUY leg carries no slippage buffer, so an ungrossed one always trips
      // the route-level check. Failing the build costs the caller no gas.
      setTax(undefined);

      expect(() =>
        aerostrat.getDexParam(
          AERO.address,
          AEROSTRAT.address,
          '0',
          (500n * BI_POWS[18]).toString(),
          RECIPIENT,
          dataFor(AERO.address, AEROSTRAT.address),
          SwapSide.BUY,
        ),
      ).toThrow(/no usable tax rate/);
    });

    it('never reads an unusable route rate as zero, or falls back past it', () => {
      // BigInt(''), BigInt([]) and BigInt(false) are all 0n, which a range check
      // cannot tell apart from a genuine zero-tax route. The live rate is set to
      // prove a malformed value does not quietly fall back to it either.
      setTax(1000n);

      // Deeply nested, and reachable: JSON.parse handles depths that recursive
      // serialisers cannot, so logging the rejected value with JSON.stringify or
      // String() blows the stack inside the guard that must not throw.
      const deeplyNested = JSON.parse(
        `{"t":${'['.repeat(10000)}${']'.repeat(10000)}}`,
      ).t;

      for (const taxBps of [
        '',
        '  ',
        [],
        false,
        'abc',
        '-1000',
        '10000',
        12,
        deeplyNested,
      ]) {
        expect(() =>
          aerostrat.getDexParam(
            AERO.address,
            AEROSTRAT.address,
            '0',
            (500n * BI_POWS[18]).toString(),
            RECIPIENT,
            {
              ...dataFor(AERO.address, AEROSTRAT.address),
              taxBps,
            } as any,
            SwapSide.BUY,
          ),
        ).toThrow(/no usable tax rate/);
      }
    });

    it('treats a route rate of zero as a real rate, not as unusable', () => {
      // setFees(0) is reachable on-chain and isQuotable() allows it, so pricing
      // can legitimately stamp '0'. Rejecting it alongside the malformed values
      // above would make every honestly-priced zero-tax route fail to build.
      // Live rate is non-zero so falling back instead would gross up visibly.
      setTax(2000n);
      const userWants = 500n * BI_POWS[18];

      const spy = spySuperGetDexParam();

      expect(() =>
        aerostrat.getDexParam(
          AERO.address,
          AEROSTRAT.address,
          '0',
          userWants.toString(),
          RECIPIENT,
          { ...dataFor(AERO.address, AEROSTRAT.address), taxBps: '0' },
          SwapSide.BUY,
        ),
      ).not.toThrow();

      // No tax means no gross-up: the pool is asked for exactly what was wanted.
      expect(spy.mock.calls[0][3]).toEqual(userWants.toString());
    });
  });

  describe('pool scoping and executor contract', () => {
    const RECIPIENT2 = '0xf5c4f3dc02c3fb9279495a8fef7b0741da956157';
    const config = UniswapV3Config['AerostratSlipstream'][Network.BASE];

    afterEach(() => jest.restoreAllMocks());

    it('prices only the configured taxed pool', async () => {
      // Pool creation on this factory is permissionless; another AEROSTRAT pool
      // would not be taxlisted and must not be priced with a tax. Filtering the
      // parent's results covers every branch it can take to reach a pool,
      // including the cache-first limitPools path.
      setTax(1000n);
      jest.spyOn(UniswapV3.prototype, 'getPricesVolume').mockResolvedValue([
        {
          unit: 1n,
          prices: [0n, 1n],
          data: { path: [{ tokenIn: '', tokenOut: '', fee: '500' }] },
          exchange: 'AerostratSlipstream',
          gasCost: [0, 1],
          poolAddresses: ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
        },
      ] as any);

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

    it('does not let the executor trust the router return on a taxed output', () => {
      // SELL AERO -> AEROSTRAT is the direction where the parent actually sets
      // returnAmountPos. The router reports the pool's output; the recipient is
      // taxed on the way out, so the executor must measure the balance instead.
      setTax(1000n);

      const sell = aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        (1n * BI_POWS[18]).toString(),
        (900n * BI_POWS[18]).toString(),
        RECIPIENT2,
        {
          path: [
            {
              tokenIn: AERO.address,
              tokenOut: AEROSTRAT.address,
              fee: '500',
              tickSpacing: '100',
            },
          ],
        } as any,
        SwapSide.SELL,
      );
      expect(sell.returnAmountPos).toBeUndefined();

      // The custom-router sell pays out AERO, which is untaxed, so that
      // direction keeps its return position.
      const untaxedOut = aerostrat.getDexParam(
        AEROSTRAT.address,
        AERO.address,
        '1',
        '1',
        RECIPIENT2,
        {
          path: [
            {
              tokenIn: AEROSTRAT.address,
              tokenOut: AERO.address,
              fee: '500',
              tickSpacing: '100',
            },
          ],
        } as any,
        SwapSide.SELL,
      );
      expect(untaxedOut.returnAmountPos).toEqual(0);
    });

    it('advertises the taxed pool before the rate is known, and nothing else', async () => {
      // Pool tracking runs on a service that never calls initializePricing, so
      // gating discovery on the rate would hide this key from routing entirely.
      setTax(undefined);
      jest
        .spyOn(UniswapV3.prototype, 'getTopPoolsForToken')
        .mockResolvedValue([
          { address: config.taxedPool!, liquidityUSD: 10 } as any,
          { address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } as any,
        ]);

      expect(
        await aerostrat.getTopPoolsForToken(AEROSTRAT.address, 10),
      ).toEqual([{ address: config.taxedPool!, liquidityUSD: 10 }]);
      expect(await aerostrat.getTopPoolsForToken(AERO.address, 10)).toEqual([]);
    });
  });

  describe('fail-closed and lifecycle', () => {
    afterEach(() => jest.restoreAllMocks());

    it('starts with no tax at all, not a seeded guess', () => {
      // A hardcoded default would misprice every route if the real rate differs.
      const fresh = new AerostratSlipstream(network, dexKey, dexHelper);
      expect((fresh as any).taxBps).toBeUndefined();
      expect(
        (fresh as any).isSupportedSwap(
          AEROSTRAT.address,
          AERO.address,
          SwapSide.SELL,
        ),
      ).toBe(false);
    });

    it('keeps the last good tax when the read fails', async () => {
      setTax(1000n);
      jest
        .spyOn(dexHelper.multiWrapper, 'tryAggregate')
        .mockResolvedValue([{ success: false, returnData: 0n }] as any);

      await (aerostrat as any).updateTax();

      expect((aerostrat as any).taxBps).toEqual(1000n);
    });

    it('never falls back to the untaxed quoter', async () => {
      await expect(aerostrat.getPricingFromRpc()).resolves.toBeNull();
    });

    it('refreshes the tax on an interval and stops on release', async () => {
      jest.useFakeTimers();
      try {
        jest
          .spyOn(
            Object.getPrototypeOf(Object.getPrototypeOf(aerostrat)),
            'initializePricing',
          )
          .mockResolvedValue(undefined);
        const tick = jest
          .spyOn(aerostrat as any, 'updateTax')
          .mockResolvedValue(undefined);

        await aerostrat.initializePricing(1);
        tick.mockClear();

        jest.advanceTimersByTime(60_000);
        expect(tick).toHaveBeenCalledTimes(1);

        aerostrat.releaseResources();
        tick.mockClear();
        jest.advanceTimersByTime(180_000);

        expect(tick).not.toHaveBeenCalled();
        expect((aerostrat as any).taxUpdateIntervalTask).toBeUndefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('excludedPools reaches the base class', () => {
    /*
     * excludedPools is read by UniswapV3.isExcludedPool, but the config it reads
     * is rebuilt field by field in _toLowerForAllConfigAddresses. TypeScript only
     * catches a *required* property missing from that literal, so an optional one
     * left out compiles clean and silently vanishes - and the filter then fails
     * open with nothing to notice it.
     *
     * Slipstream forks happen to survive that by re-assigning the raw config as a
     * constructor parameter property after super(), so exercising this fork would
     * prove nothing. AlienBaseV3 is served by the base class directly, which is
     * where the field has to work.
     */
    const EXCLUDED = '0x95180496aDAbC8380fca36EC81BAE131CA97cD3b';

    const baseServedDex = () =>
      new UniswapV3(network, 'AlienBaseV3', dexHelper, undefined, undefined, {
        ...UniswapV3Config['AlienBaseV3'][network],
        excludedPools: [EXCLUDED],
      }) as any;

    it('survives config normalization, lowercased', () => {
      expect(baseServedDex().config.excludedPools).toEqual([
        EXCLUDED.toLowerCase(),
      ]);
    });

    it('matches whatever case the pool was configured in', () => {
      const dex = baseServedDex();

      expect(dex.isExcludedPool(EXCLUDED)).toBe(true);
      expect(dex.isExcludedPool(EXCLUDED.toLowerCase())).toBe(true);
      expect(dex.isExcludedPool(AERO.address)).toBe(false);
    });
  });
});
