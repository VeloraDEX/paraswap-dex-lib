import type { OptimalRate, OptimalSwap } from '@paraswap/core';
import type { Address } from '../types';
import type {
  OrderedExecutorLeg,
  ResolvedLeg,
  RoutePlan,
  RoutePlanExchange,
  RoutePlanSwap,
  RoutePosition,
} from './encoding-types';

type SwapWithOptionalAmounts = OptimalSwap & {
  srcAmount?: string;
  destAmount?: string;
};

type SwapAmountField = 'srcAmount' | 'destAmount';

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

export function getOrderedExecutorLegs(
  routePlan: RoutePlan,
  resolvedLegs: ResolvedLeg[],
): OrderedExecutorLeg[] {
  const routePositions = walkRoutePlan(routePlan);
  const routePositionKeys = new Set(routePositions.map(routePositionKey));
  const resolvedLegByKey = new Map<string, ResolvedLeg>();
  const duplicateKeys = new Set<string>();
  const extraKeys = new Set<string>();

  resolvedLegs.forEach(resolvedLeg => {
    const key = routePositionKey(resolvedLeg);

    if (resolvedLegByKey.has(key)) {
      duplicateKeys.add(key);
    }

    if (!routePositionKeys.has(key)) {
      extraKeys.add(key);
    }

    resolvedLegByKey.set(key, resolvedLeg);
  });

  if (duplicateKeys.size > 0) {
    throw new Error(
      `duplicate resolved leg route position(s): ${[...duplicateKeys].join(
        ', ',
      )}`,
    );
  }

  if (extraKeys.size > 0) {
    throw new Error(
      `resolved leg route position(s) not present in route plan: ${[
        ...extraKeys,
      ].join(', ')}`,
    );
  }

  return routePositions.map(routePosition => {
    const key = routePositionKey(routePosition);
    const resolvedLeg = resolvedLegByKey.get(key);

    if (!resolvedLeg) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }

    return {
      ...routePosition,
      resolvedLeg,
    };
  });
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
