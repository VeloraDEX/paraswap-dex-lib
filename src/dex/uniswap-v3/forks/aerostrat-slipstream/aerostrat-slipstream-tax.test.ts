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

  describe('transaction building', () => {
    const RECIPIENT = '0xf5c4f3dc02c3fb9279495a8fef7b0741da956157';
    const config = UniswapV3Config['AerostratSlipstream'][Network.BASE];
    const routerIface = new Interface(AerostratRouterABI);

    const dataFor = (tokenIn: string, tokenOut: string, tickSpacing = '100') =>
      ({
        path: [{ tokenIn, tokenOut, fee: '500', tickSpacing }],
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

    it('does not gross up the exact-input sell side of a buy', () => {
      setTax(1000n);
      const spy = jest
        .spyOn(UniswapV3.prototype, 'getDexParam')
        .mockReturnValue({} as any);

      const destAmount = 900n * BI_POWS[18];
      aerostrat.getDexParam(
        AERO.address,
        AEROSTRAT.address,
        '0',
        destAmount.toString(),
        RECIPIENT,
        dataFor(AERO.address, AEROSTRAT.address),
        SwapSide.SELL,
      );

      expect(spy.mock.calls[0][3]).toEqual(destAmount.toString());
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
      ).toThrow(/tax is unknown or out of range/);
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
