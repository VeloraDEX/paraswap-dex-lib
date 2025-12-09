import { FunctionFragment, Interface } from '@ethersproject/abi';
import { RETURN_AMOUNT_POS_0, RETURN_AMOUNT_POS_32 } from './constants';
import { OptimalSwap, OptimalRoute, OptimalSwapExchange } from '@paraswap/core';

export const extractReturnAmountPosition = (
  iface: Interface,
  functionName: string | FunctionFragment,
  outputName = '',
  outputIndex = 0, // for the cases when the only output is an array with static type
): number => {
  const func =
    typeof functionName === 'string'
      ? iface.getFunction(functionName)
      : functionName;
  const outputs = func.outputs || [];
  const index = outputs.findIndex(
    ({ name }) => name === outputName || (outputName === '' && name === null),
  );

  if (index < 0) {
    throw new Error(
      `Function ${functionName} was not found in the provided abi`,
    );
  }

  if (index === 0) {
    if (
      outputs[0].baseType === 'array' &&
      !outputs[0].arrayChildren.baseType.includes('[]') && // only static internalType
      outputs.length === 1 // if array is the only output
    ) {
      return (
        RETURN_AMOUNT_POS_32 +
        RETURN_AMOUNT_POS_32 +
        outputIndex * RETURN_AMOUNT_POS_32
      ); // dynamic calldata (offset + length + position of the element in the array)
    }
    if (outputs[0].baseType === 'tuple' || outputs[0].baseType === 'struct') {
      throw new Error(
        `extractReturnAmountPosition doesn't support outputs of type struct or tuple for the only output.`,
      );
    }

    return RETURN_AMOUNT_POS_0;
  }

  let position = RETURN_AMOUNT_POS_0;
  let curIndex = 0;
  while (curIndex < index) {
    const output = outputs[curIndex];

    if (output.type.includes('[]') || output.type.includes('struct')) {
      throw new Error(
        `extractReturnAmountPosition doesn't support outputs of type array or struct. Please define returnAmountPos manually for this case.`,
      );
    }

    position += RETURN_AMOUNT_POS_32;
    curIndex++;
  }

  return position;
};

// [[swap1], [[swap2,swap3],[swap4], [swap5]]
type MultiRouteSwaps = (OptimalSwap[] | OptimalSwap[][])[];

export function isSameSwap(swap1: OptimalSwap, swap2: OptimalSwap): boolean {
  return (
    swap1.srcToken.toLowerCase() === swap2.srcToken.toLowerCase() &&
    swap1.destToken.toLowerCase() === swap2.destToken.toLowerCase()
  );
}

function isSameSwapExchange(
  se1: OptimalSwapExchange<any>,
  se2: OptimalSwapExchange<any>,
): boolean {
  if (se1.exchange !== se2.exchange) return false;

  const ids1 = se1.poolIdentifiers ?? [];
  const ids2 = se2.poolIdentifiers ?? [];

  if (ids1.length !== ids2.length) return false;

  return ids1.every((id, i) => id === ids2[i]);
}

function mergeSwapExchanges(
  swapExchanges: OptimalSwapExchange<any>[][],
): OptimalSwapExchange<any>[] {
  const merged: OptimalSwapExchange<any>[] = [];

  for (const exchanges of swapExchanges) {
    for (const se of exchanges) {
      const existing = merged.find(m => isSameSwapExchange(m, se));
      if (existing) {
        existing.srcAmount = (
          BigInt(existing.srcAmount) + BigInt(se.srcAmount)
        ).toString();
        existing.destAmount = (
          BigInt(existing.destAmount) + BigInt(se.destAmount)
        ).toString();
      } else {
        merged.push({ ...se });
      }
    }
  }

  return merged;
}

/**
 * Merges swaps from multiple routes, combining identical swaps and grouping parallel different swaps.
 *
 * Example 1:
 * Routes: [[token1-token2, token2-token3, token3-token4], [token1-token2, token2-token4]]
 * Result: [[token1-token2], [[token2-token3, token3-token4], [token2-token4]]]
 *
 * Example 2:
 * Routes: [[token1-token2, token2-token3, token3-token4], [token1-token3, token3-token4], [token1-token5, token5-token3, token3-token4]]
 * Result: [[[token1-token2, token2-token3], [token1-token3], [token1-token5, token5-token3]], [token3-token4]]
 */

export function mergeMultiPriceRoutes(routes: OptimalRoute[]): MultiRouteSwaps {
  if (routes.length === 0) return [];
  if (routes.length === 1) {
    // Single route: each swap is its own group
    return routes[0].swaps.map(swap => [swap]);
  }

  const routeSwaps = routes.map(route => [...route.swaps]);
  const result: MultiRouteSwaps = [];

  // Process from the start: find common prefix swaps
  while (routeSwaps.some(swaps => swaps.length > 0)) {
    const firstSwaps = routeSwaps
      .filter(swaps => swaps.length > 0)
      .map(swaps => swaps[0]);

    if (firstSwaps.length === 0) break;

    // Check if all first swaps are the same
    const allSame = firstSwaps.every(swap => isSameSwap(swap, firstSwaps[0]));

    if (allSame) {
      // All routes start with the same swap - merge with accumulated amounts
      const mergedSwap: OptimalSwap = {
        ...firstSwaps[0],
        swapExchanges: mergeSwapExchanges(firstSwaps.map(s => s.swapExchanges)),
      };
      result.push([mergedSwap]);
      routeSwaps.forEach(swaps => {
        if (swaps.length > 0) swaps.shift();
      });
    } else {
      // Swaps diverge - need to process from the end to find common suffix
      break;
    }
  }

  // Process from the end: find common suffix swaps
  const suffixResult: MultiRouteSwaps = [];
  while (routeSwaps.some(swaps => swaps.length > 0)) {
    const lastSwaps = routeSwaps
      .filter(swaps => swaps.length > 0)
      .map(swaps => swaps[swaps.length - 1]);

    if (lastSwaps.length === 0) break;

    // Check if all last swaps are the same
    const allSame = lastSwaps.every(swap => isSameSwap(swap, lastSwaps[0]));

    if (allSame) {
      // All routes end with the same swap - merge with accumulated amounts
      const mergedSwap: OptimalSwap = {
        ...lastSwaps[0],
        swapExchanges: mergeSwapExchanges(lastSwaps.map(s => s.swapExchanges)),
        // TODO-multi: it's possible that amounts won't result in the same amounts from merged swaps due to BigInt rounding
      };
      suffixResult.unshift([mergedSwap]);
      routeSwaps.forEach(swaps => {
        if (swaps.length > 0) swaps.pop();
      });
    } else {
      // Swaps diverge - remaining middle part needs parallel grouping
      break;
    }
  }

  // Handle remaining middle part (parallel different sequences)
  const remainingRoutes = routeSwaps.filter(swaps => swaps.length > 0);
  if (remainingRoutes.length > 0) {
    // Each remaining route's swaps form a parallel branch
    result.push(remainingRoutes);
  }

  // Combine prefix, middle, and suffix
  return [...result, ...suffixResult];
}
