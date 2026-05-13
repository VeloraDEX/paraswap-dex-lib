import type { OptimalRate, OptimalSwap } from '@paraswap/core';
import {
  assertDecimalAmountString,
  assertHexBytes,
  assertLowercaseAddress,
  assertNoDuplicateResolvedLegs,
  assertRoutePlanLegCount,
  buildRoutePlan,
  findDuplicateResolvedLegKeys,
  flattenRoutePlan,
  getRoutePlanLegCount,
  isDecimalAmountString,
  isHexBytes,
  isLowercaseAddress,
  routePositionKey,
} from '../../../src/generic-swap-transaction-builder/resolved';
import type {
  RoutePlan,
  RoutePlanSwap,
} from '../../../src/generic-swap-transaction-builder/resolved';

import executor01SimpleSwap from '../../../src/executor/fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
import executor01MultiSwap from '../../../src/executor/fixtures/executor01/routes/price-route-multiswap-sushiv3-usdc-eth-wbtc.json';
import executor02VerticalBranch from '../../../src/executor/fixtures/executor02/routes/price-route-simpleSwap-sushiv3-balancerv1-eth-usdc.json';
import executor02MultiSwap from '../../../src/executor/fixtures/executor02/routes/price-route-multiswap-univ3-usdt-dai-eth.json';

type SourceSwap = OptimalSwap & {
  srcAmount?: string;
  destAmount?: string;
};

describe('resolved route plan conversion', () => {
  it('converts an Executor01 simple swap fixture', () => {
    const priceRoute = executor01SimpleSwap as unknown as OptimalRate;
    const routePlan = buildRoutePlan(priceRoute);

    expectRoutePlanToMatchPriceRoute(routePlan, priceRoute);
    expect(flattenRoutePlan(routePlan)).toEqual([
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 0 },
    ]);
    expect(getRoutePlanLegCount(routePlan)).toBe(1);
  });

  it('converts an Executor01 multiswap fixture in nested order', () => {
    const priceRoute = executor01MultiSwap as unknown as OptimalRate;
    const routePlan = buildRoutePlan(priceRoute);

    expectRoutePlanToMatchPriceRoute(routePlan, priceRoute);
    expect(flattenRoutePlan(routePlan)).toEqual([
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 0 },
      { routeIndex: 0, swapIndex: 1, swapExchangeIndex: 0 },
    ]);
    expect(getRoutePlanLegCount(routePlan)).toBe(2);
  });

  it('converts an Executor02 vertical branch fixture in nested order', () => {
    const priceRoute = executor02VerticalBranch as unknown as OptimalRate;
    const routePlan = buildRoutePlan(priceRoute);

    expectRoutePlanToMatchPriceRoute(routePlan, priceRoute);
    expect(flattenRoutePlan(routePlan)).toEqual([
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 0 },
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 1 },
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 2 },
    ]);
    expect(getRoutePlanLegCount(routePlan)).toBe(3);
  });

  it('converts an Executor02 multiswap fixture in nested order', () => {
    const priceRoute = executor02MultiSwap as unknown as OptimalRate;
    const routePlan = buildRoutePlan(priceRoute);

    expectRoutePlanToMatchPriceRoute(routePlan, priceRoute);
    expect(flattenRoutePlan(routePlan)).toEqual([
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 0 },
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 1 },
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 2 },
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 3 },
      { routeIndex: 0, swapIndex: 1, swapExchangeIndex: 0 },
      { routeIndex: 0, swapIndex: 1, swapExchangeIndex: 1 },
      { routeIndex: 0, swapIndex: 1, swapExchangeIndex: 2 },
      { routeIndex: 0, swapIndex: 1, swapExchangeIndex: 3 },
    ]);
    expect(getRoutePlanLegCount(routePlan)).toBe(8);
  });

  it('normalizes route tokens without changing exchange amount strings', () => {
    const priceRoute = clonePriceRoute(executor01SimpleSwap);
    const sourceSwap = priceRoute.bestRoute[0].swaps[0];
    sourceSwap.srcToken = sourceSwap.srcToken.toUpperCase();
    sourceSwap.destToken = sourceSwap.destToken.toUpperCase();
    sourceSwap.swapExchanges[0].srcAmount = '0001000000';

    const routePlan = buildRoutePlan(priceRoute);
    const routePlanSwap = routePlan.routes[0].swaps[0];

    expect(routePlanSwap.srcToken).toBe(sourceSwap.srcToken.toLowerCase());
    expect(routePlanSwap.destToken).toBe(sourceSwap.destToken.toLowerCase());
    expect(routePlanSwap.swapExchanges[0].srcAmount).toBe('0001000000');
  });
});

describe('resolved route helpers', () => {
  it('builds stable route position keys', () => {
    expect(
      routePositionKey({
        routeIndex: 3,
        swapIndex: 2,
        swapExchangeIndex: 1,
      }),
    ).toBe('3:2:1');
  });

  it('detects duplicate resolved leg positions', () => {
    const resolvedLegs = [
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 0 },
      { routeIndex: 0, swapIndex: 1, swapExchangeIndex: 0 },
      { routeIndex: 0, swapIndex: 0, swapExchangeIndex: 0 },
    ];

    expect(findDuplicateResolvedLegKeys(resolvedLegs)).toEqual(['0:0:0']);
    expect(() => assertNoDuplicateResolvedLegs(resolvedLegs)).toThrow(
      'duplicate resolved leg route position(s): 0:0:0',
    );
  });

  it('checks route-plan leg count against resolved leg count', () => {
    const routePlan = buildRoutePlan(
      executor01MultiSwap as unknown as OptimalRate,
    );

    expect(() => assertRoutePlanLegCount(routePlan, 2)).not.toThrow();
    expect(() => assertRoutePlanLegCount(routePlan, 1)).toThrow(
      'route-plan leg count mismatch: expected 2, got 1',
    );
  });
});

describe('resolved serialization validation helpers', () => {
  it('checks decimal amount strings', () => {
    expect(isDecimalAmountString('0')).toBe(true);
    expect(isDecimalAmountString('123456')).toBe(true);
    expect(isDecimalAmountString('0123')).toBe(true);
    expect(isDecimalAmountString('1.2')).toBe(false);
    expect(() => assertDecimalAmountString('abc', 'srcAmount')).toThrow(
      'srcAmount must be a decimal amount string',
    );
  });

  it('checks lowercase 42-character addresses', () => {
    expect(
      isLowercaseAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
    ).toBe(true);
    expect(
      isLowercaseAddress('0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
    ).toBe(false);
    expect(() => assertLowercaseAddress('0xabc', 'srcToken')).toThrow(
      'srcToken must be a lowercase 42-character hex address',
    );
  });

  it('checks 0x-prefixed hex bytes', () => {
    expect(isHexBytes('0x')).toBe(true);
    expect(isHexBytes('0x1234abcdABCD')).toBe(true);
    expect(isHexBytes('1234')).toBe(false);
    expect(isHexBytes('0x123')).toBe(false);
    expect(() => assertHexBytes('0xzz', 'permit')).toThrow(
      'permit must be 0x-prefixed hex bytes',
    );
  });
});

function expectRoutePlanToMatchPriceRoute(
  routePlan: RoutePlan,
  priceRoute: OptimalRate,
): void {
  expect(routePlan.routes).toHaveLength(priceRoute.bestRoute.length);

  priceRoute.bestRoute.forEach((sourceRoute, routeIndex) => {
    const routePlanRoute = routePlan.routes[routeIndex];

    expect(routePlanRoute.percent).toBe(sourceRoute.percent);
    expect(routePlanRoute.swaps).toHaveLength(sourceRoute.swaps.length);

    sourceRoute.swaps.forEach((sourceSwap, swapIndex) => {
      const routePlanSwap = routePlanRoute.swaps[swapIndex];

      expectRoutePlanSwapToMatchSource(routePlanSwap, sourceSwap);
    });
  });
}

function expectRoutePlanSwapToMatchSource(
  routePlanSwap: RoutePlanSwap,
  sourceSwap: SourceSwap,
): void {
  expect(routePlanSwap.srcToken).toBe(sourceSwap.srcToken.toLowerCase());
  expect(routePlanSwap.destToken).toBe(sourceSwap.destToken.toLowerCase());
  expect(routePlanSwap.srcAmount).toBe(getSwapAmount(sourceSwap, 'srcAmount'));
  expect(routePlanSwap.destAmount).toBe(
    getSwapAmount(sourceSwap, 'destAmount'),
  );
  expect(routePlanSwap.swapExchanges).toHaveLength(
    sourceSwap.swapExchanges.length,
  );

  sourceSwap.swapExchanges.forEach((sourceSwapExchange, swapExchangeIndex) => {
    const routePlanSwapExchange =
      routePlanSwap.swapExchanges[swapExchangeIndex];

    expect(routePlanSwapExchange).toEqual({
      exchange: sourceSwapExchange.exchange,
      percent: sourceSwapExchange.percent,
      srcAmount: sourceSwapExchange.srcAmount,
      destAmount: sourceSwapExchange.destAmount,
    });
    expect(
      Object.prototype.hasOwnProperty.call(routePlanSwapExchange, 'data'),
    ).toBe(false);
  });
}

function getSwapAmount(
  swap: SourceSwap,
  amountField: 'srcAmount' | 'destAmount',
): string {
  if (swap[amountField] !== undefined) return swap[amountField];

  return swap.swapExchanges
    .reduce((sum, swapExchange) => sum + BigInt(swapExchange[amountField]), 0n)
    .toString();
}

function clonePriceRoute(priceRoute: unknown): OptimalRate {
  return JSON.parse(JSON.stringify(priceRoute)) as OptimalRate;
}
