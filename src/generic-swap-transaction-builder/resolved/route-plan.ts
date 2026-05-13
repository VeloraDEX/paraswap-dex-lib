import type { Address, OptimalRate, OptimalSwap } from '../../types';
import type {
  RoutePlan,
  RoutePlanRoute,
  RoutePlanSwap,
  RoutePlanSwapExchange,
  RoutePosition,
} from './types';

type SwapWithOptionalAmounts = OptimalSwap & {
  srcAmount?: string;
  destAmount?: string;
};

type SwapAmountField = 'srcAmount' | 'destAmount';

export type RoutePlanExchange = RoutePosition & {
  route: RoutePlanRoute;
  swap: RoutePlanSwap;
  swapExchange: RoutePlanSwapExchange;
};

export function buildRoutePlan(priceRoute: OptimalRate): RoutePlan {
  return {
    routes: priceRoute.bestRoute.map(route => ({
      percent: route.percent,
      swaps: route.swaps.map(swap => buildRoutePlanSwap(swap)),
    })),
  };
}

export function flattenRoutePlan(routePlan: RoutePlan): RoutePosition[] {
  return walkRoutePlan(routePlan).map(
    ({ routeIndex, swapIndex, swapExchangeIndex }) => ({
      routeIndex,
      swapIndex,
      swapExchangeIndex,
    }),
  );
}

export function walkRoutePlan(routePlan: RoutePlan): RoutePlanExchange[] {
  return routePlan.routes.flatMap((route, routeIndex) =>
    route.swaps.flatMap((swap, swapIndex) =>
      swap.swapExchanges.map((swapExchange, swapExchangeIndex) => ({
        routeIndex,
        swapIndex,
        swapExchangeIndex,
        route,
        swap,
        swapExchange,
      })),
    ),
  );
}

export function routePositionKey(position: RoutePosition): string {
  return [
    position.routeIndex,
    position.swapIndex,
    position.swapExchangeIndex,
  ].join(':');
}

export function getRoutePlanLegCount(routePlan: RoutePlan): number {
  return routePlan.routes.reduce(
    (routeCount, route) =>
      routeCount +
      route.swaps.reduce(
        (swapCount, swap) => swapCount + swap.swapExchanges.length,
        0,
      ),
    0,
  );
}

function buildRoutePlanSwap(swap: SwapWithOptionalAmounts): RoutePlanSwap {
  return {
    srcToken: normalizeAddress(swap.srcToken),
    destToken: normalizeAddress(swap.destToken),
    srcAmount: getSwapAmount(swap, 'srcAmount'),
    destAmount: getSwapAmount(swap, 'destAmount'),
    swapExchanges: swap.swapExchanges.map(swapExchange => ({
      exchange: swapExchange.exchange,
      percent: swapExchange.percent,
      srcAmount: swapExchange.srcAmount,
      destAmount: swapExchange.destAmount,
    })),
  };
}

function getSwapAmount(
  swap: SwapWithOptionalAmounts,
  amountField: SwapAmountField,
): string {
  const amount = swap[amountField];
  if (amount !== undefined) return amount;

  return sumDecimalStrings(
    swap.swapExchanges.map(swapExchange => swapExchange[amountField]),
  );
}

function sumDecimalStrings(amounts: string[]): string {
  return amounts.reduce((sum, amount) => sum + BigInt(amount), 0n).toString();
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase();
}
