import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../../../dex-helper/index';
import { Network, SwapSide } from '../../../../constants';
import { BI_POWS } from '../../../../bigint-constants';
import { Tokens } from '../../../../../tests/constants-e2e';
import { Interface } from '@ethersproject/abi';
import { UniswapV3 } from '../../uniswap-v3';
import { VelodromeSlipstream } from '../velodrome-slipstream/velodrome-slipstream';
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
    (aerostrat as any).taxReadAt = bps === undefined ? 0 : Date.now();
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

    const dataFor = (
      tokenIn: string,
      tokenOut: string,
      tickSpacing = '100',
      taxBps: string | undefined = '1000',
    ) =>
      ({
        path: [{ tokenIn, tokenOut, fee: '500', tickSpacing }],
        taxBps,
      } as any);

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

    it('takes tickSpacing from the pool data rather than a constant', () => {
      setTax(1000n);

      for (const tickSpacing of ['100', '200']) {
        const param = aerostrat.getDexParam(
          AEROSTRAT.address,
          AERO.address,
          '1',
          '1',
          RECIPIENT,
          dataFor(AEROSTRAT.address, AERO.address, tickSpacing),
          SwapSide.SELL,
        );
        const [p] = routerIface.decodeFunctionData(
          'exactInputSellAEROSTRAT',
          param.exchangeData,
        );
        expect(p.tickSpacing).toEqual(Number(tickSpacing));
      }
    });

    it('asks the pool for the grossed-up amount in exact-output BUY calldata', () => {
      setTax(1000n);
      const spy = jest
        .spyOn(UniswapV3.prototype, 'getDexParam')
        .mockReturnValue({} as any);

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

      const spy = jest
        .spyOn(UniswapV3.prototype, 'getDexParam')
        .mockReturnValue({} as any);
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

    it('stamps the quote with the rate it priced at, even if the rate then moves', async () => {
      // The refresh interval can fire during super.getPricesVolume; a quote whose
      // amounts and recorded rate disagree would be sized wrong at build time.
      setTax(1000n);
      const spy = jest
        .spyOn(UniswapV3.prototype, 'getPricesVolume')
        .mockImplementation(async () => {
          // simulate the interval landing mid-await
          setTax(2000n);
          return [
            {
              unit: 0n,
              prices: [0n, 1n],
              data: { path: [{ tokenIn: '', tokenOut: '', fee: '500' }] },
              exchange: 'AerostratSlipstream',
              gasCost: [0, 1],
              poolAddresses: ['0x0'],
            },
          ] as any;
        });

      const out = await aerostrat.getPricesVolume(
        AEROSTRAT,
        AERO,
        [0n, BI_POWS[18]],
        SwapSide.SELL,
        1,
      );

      expect(spy).toHaveBeenCalled();
      expect((out![0].data as any).taxBps).toEqual('1000');
    });

    it('falls back to the live rate when a route carries none', () => {
      // A throw here would kill the whole transaction build, not just this leg,
      // so a route that never recorded a rate is sized from the live one.
      setTax(1000n);
      const spy = jest
        .spyOn(UniswapV3.prototype, 'getDexParam')
        .mockReturnValue({} as any);

      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        (900n * BI_POWS[18]).toString(),
        RECIPIENT,
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
        SwapSide.BUY,
      );
      expect(spy.mock.calls[0][3]).toEqual((1000n * BI_POWS[18]).toString());
    });

    it('fails only when no rate is available at all', () => {
      setTax(undefined);
      expect(() =>
        aerostrat.getDexParam(
          AERO.address,
          AEROSTRAT.address,
          '0',
          (900n * BI_POWS[18]).toString(),
          RECIPIENT,
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
          SwapSide.BUY,
        ),
      ).toThrow(/no tax rate available/);
    });

    it('sizes the buy from the rate that priced it, not the current one', () => {
      setTax(1000n);
      const spy = jest
        .spyOn(UniswapV3.prototype, 'getDexParam')
        .mockReturnValue({} as any);

      // Route priced at 10%; rate has since moved to 20%.
      const data = dataFor(AERO.address, AEROSTRAT.address, '100', '1000');
      setTax(2000n);

      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        (900n * BI_POWS[18]).toString(),
        RECIPIENT,
        data,
        SwapSide.BUY,
      );

      // 900 / 0.9 = 1000, not 900 / 0.8 = 1125.
      expect(spy.mock.calls[0][3]).toEqual((1000n * BI_POWS[18]).toString());
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
  });

  describe('pool scoping and executor contract', () => {
    const RECIPIENT2 = '0xf5c4f3dc02c3fb9279495a8fef7b0741da956157';
    const config = UniswapV3Config['AerostratSlipstream'][Network.BASE];

    afterEach(() => jest.restoreAllMocks());

    it('prices only the configured taxed pool', async () => {
      // Pool creation on this factory is permissionless; another AEROSTRAT pool
      // would not be taxlisted and must not be priced with a tax. getPool is the
      // choke point both the identifier path and the limitPools path go through.
      setTax(1000n);
      const spy = jest
        .spyOn(VelodromeSlipstream.prototype, 'getPool')
        .mockResolvedValue({ poolAddress: config.taxedPool! } as any);

      await expect(
        (aerostrat as any).getPool(
          AEROSTRAT.address,
          AERO.address,
          500n,
          1,
          100n,
        ),
      ).resolves.toMatchObject({ poolAddress: config.taxedPool });

      spy.mockResolvedValue({
        poolAddress: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      } as any);

      await expect(
        (aerostrat as any).getPool(
          AEROSTRAT.address,
          AERO.address,
          500n,
          1,
          200n,
        ),
      ).resolves.toBeNull();
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
          taxBps: '1000',
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
          taxBps: '1000',
        } as any,
        SwapSide.SELL,
      );
      expect(untaxedOut.returnAmountPos).toEqual(0);
    });

    it('grosses up the pool-side minimum on a sell into the taxed token', () => {
      // amountOutMinimum is compared against the pool's pre-tax output, so a
      // post-tax figure leaves the bound ~taxBps looser than the user asked for.
      setTax(1000n);
      const spy = jest
        .spyOn(UniswapV3.prototype, 'getDexParam')
        .mockReturnValue({} as any);

      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '1',
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
          taxBps: '1000',
        } as any,
        SwapSide.SELL,
      );

      expect(spy.mock.calls[0][3]).toEqual((1000n * BI_POWS[18]).toString());
    });

    it('advertises pools even before the tax rate is known', async () => {
      // Pool tracking runs on a service that never calls initializePricing, so
      // gating discovery on the rate would hide this key from routing entirely.
      setTax(undefined);
      jest.spyOn(UniswapV3.prototype, 'getTopPoolsForToken').mockResolvedValue([
        {
          exchange: 'AerostratSlipstream',
          address: config.taxedPool!,
          connectorTokens: [
            { address: AERO.address, decimals: 18, liquidityUSD: 5 },
          ],
          liquidityUSD: 10,
        } as any,
      ]);

      const pools = await aerostrat.getTopPoolsForToken(AEROSTRAT.address, 10);
      expect(pools).toHaveLength(1);

      // Queried for the counter token the record must be re-oriented.
      const flipped = await aerostrat.getTopPoolsForToken(AERO.address, 10);
      expect(flipped).toHaveLength(1);
      expect(flipped[0].connectorTokens[0].address.toLowerCase()).toEqual(
        AEROSTRAT.address.toLowerCase(),
      );
      expect(flipped[0].liquidityUSD).toEqual(5);
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

    it('keeps the last good tax on a failed read, but lets it expire', async () => {
      setTax(1000n);
      jest.spyOn(dexHelper.multiWrapper, 'tryAggregate').mockResolvedValue([
        { success: false, returnData: 0n },
        { success: false, returnData: false },
      ] as any);

      await (aerostrat as any).updateTax();
      expect((aerostrat as any).taxBps).toEqual(1000n);
      expect(
        (aerostrat as any).isSupportedSwap(
          AEROSTRAT.address,
          AERO.address,
          SwapSide.SELL,
        ),
      ).toBe(true);

      // A rate we can no longer confirm must not be quoted forever.
      (aerostrat as any).taxReadAt = Date.now() - 6 * 60 * 1000;
      expect(
        (aerostrat as any).isSupportedSwap(
          AEROSTRAT.address,
          AERO.address,
          SwapSide.SELL,
        ),
      ).toBe(false);
    });

    it('stops quoting if the pool is removed from the taxlist', async () => {
      // The custom router still grosses the charge up, so a de-taxlisted pool
      // would overcharge the seller.
      setTax(1000n);
      jest.spyOn(dexHelper.multiWrapper, 'tryAggregate').mockResolvedValue([
        { success: true, returnData: 1000n },
        { success: true, returnData: false },
      ] as any);

      await (aerostrat as any).updateTax();

      expect((aerostrat as any).taxBps).toBeUndefined();
      expect(
        (aerostrat as any).isSupportedSwap(
          AEROSTRAT.address,
          AERO.address,
          SwapSide.SELL,
        ),
      ).toBe(false);
    });

    it('prices the unit on the same basis as the amounts', () => {
      setTax(1000n);
      const getUnitAmount = (src: any, dest: any, side: SwapSide) =>
        (aerostrat as any).getUnitAmount(side, src, dest);

      // Selling AEROSTRAT: the unit is taxed on the way into the pool.
      expect(getUnitAmount(AEROSTRAT, AERO, SwapSide.SELL)).toEqual(
        900n * BI_POWS[15],
      );
      // Buying: AERO goes in untouched.
      expect(getUnitAmount(AERO, AEROSTRAT, SwapSide.SELL)).toEqual(
        BI_POWS[18],
      );
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
});
