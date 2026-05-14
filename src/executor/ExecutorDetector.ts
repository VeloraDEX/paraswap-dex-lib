import { OptimalRate, SwapSide } from '@paraswap/core';
import { Executors, RouteExecutionType } from './types';
import { isSingleWrapRoute } from './WETHBytecodeBuilder';

export class ExecutorDetector {
  protected routeExecutionTypeToExecutorMap: Record<
    SwapSide,
    Partial<Record<RouteExecutionType, Executors>>
  > = {
    [SwapSide.SELL]: {
      [RouteExecutionType.SINGLE_STEP]: Executors.ONE, // simpleSwap via Executor01
      [RouteExecutionType.HORIZONTAL_SEQUENCE]: Executors.ONE, // multiSwap via Executor01
      [RouteExecutionType.VERTICAL_BRANCH]: Executors.TWO, // simpleSwap with percentage on a path via Executor02
      [RouteExecutionType.VERTICAL_BRANCH_HORIZONTAL_SEQUENCE]: Executors.TWO, // multiSwap with percentages on paths via Executor02
      // megaSwap via Executor02
      [RouteExecutionType.NESTED_VERTICAL_BRANCH_HORIZONTAL_SEQUENCE]:
        Executors.TWO,
    },
    [SwapSide.BUY]: {
      [RouteExecutionType.SINGLE_STEP]: Executors.THREE, // simpleBuy via Executor03
      [RouteExecutionType.VERTICAL_BRANCH]: Executors.THREE, // simpleBuy via Executor03
    },
  };

  public getRouteExecutionType(priceRoute: OptimalRate): RouteExecutionType {
    if (
      priceRoute.bestRoute.length === 1 &&
      priceRoute.bestRoute[0].percent === 100 &&
      priceRoute.bestRoute[0].swaps.length === 1 &&
      priceRoute.bestRoute[0].swaps[0].swapExchanges.length > 1
    ) {
      return RouteExecutionType.VERTICAL_BRANCH;
    } else if (
      priceRoute.bestRoute.length === 1 &&
      priceRoute.bestRoute[0].percent === 100 &&
      priceRoute.bestRoute[0].swaps.length === 1
    ) {
      return RouteExecutionType.SINGLE_STEP;
    } else if (
      priceRoute.bestRoute.length === 1 &&
      priceRoute.bestRoute[0].percent === 100 &&
      priceRoute.bestRoute[0].swaps.length > 1
    ) {
      let has100PercentOnEachPath = true;
      priceRoute.bestRoute[0].swaps.map(swap => {
        swap.swapExchanges.map(se => {
          if (se.percent !== 100) {
            has100PercentOnEachPath = false;
          }
        });
      });

      if (has100PercentOnEachPath) {
        return RouteExecutionType.HORIZONTAL_SEQUENCE;
      } else {
        return RouteExecutionType.VERTICAL_BRANCH_HORIZONTAL_SEQUENCE;
      }
    } else if (priceRoute.bestRoute.length > 1) {
      return RouteExecutionType.NESTED_VERTICAL_BRANCH_HORIZONTAL_SEQUENCE;
    }

    throw new Error('Route type is not supported yet');
  }

  detectSpecialExecutor(priceRoute: OptimalRate): Executors | null {
    if (isSingleWrapRoute(priceRoute)) return Executors.WETH;
    return null;
  }

  getExecutorByPriceRoute(priceRoute: OptimalRate): Executors {
    const specialExecutor = this.detectSpecialExecutor(priceRoute);
    if (specialExecutor) return specialExecutor;

    const routeExecutionType = this.getRouteExecutionType(priceRoute);
    const executorName =
      this.routeExecutionTypeToExecutorMap[priceRoute.side][routeExecutionType];

    if (executorName) {
      return executorName;
    }

    throw new Error(`${executorName} is not implemented`);
  }
}
