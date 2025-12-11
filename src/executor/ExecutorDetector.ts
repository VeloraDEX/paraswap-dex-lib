import { IDexHelper } from '../dex-helper';
import { Address, OptimalRate, SwapSide } from '@paraswap/core';
import { ExecutorBytecodeBuilder } from './ExecutorBytecodeBuilder';
import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { Executor02BytecodeBuilder } from './Executor02BytecodeBuilder';
import { Executor02BytecodeBuilderMultiRoute } from './Executor02BytecodeBuilderMultiRoute';
import { Executors, RouteExecutionType } from './types';
import { Executor03BytecodeBuilder } from './Executor03BytecodeBuilder';
import { WETHBytecodeBuilder, isSingleWrapRoute } from './WETHBytecodeBuilder';

export class ExecutorDetector {
  private executor01BytecodeBuilder: ExecutorBytecodeBuilder;
  private executor02BytecodeBuilder: ExecutorBytecodeBuilder;
  private executor02MultiRouteBytecodeBuilder: ExecutorBytecodeBuilder;
  private executor03BytecodeBuilder: ExecutorBytecodeBuilder;
  private wethBytecodeBuilder: ExecutorBytecodeBuilder;

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

  constructor(protected dexHelper: IDexHelper) {
    this.executor01BytecodeBuilder = new Executor01BytecodeBuilder(
      this.dexHelper,
    );
    this.executor02BytecodeBuilder = new Executor02BytecodeBuilder(
      this.dexHelper,
    );
    this.executor02MultiRouteBytecodeBuilder =
      new Executor02BytecodeBuilderMultiRoute(this.dexHelper);
    this.executor03BytecodeBuilder = new Executor03BytecodeBuilder(
      this.dexHelper,
    );

    this.wethBytecodeBuilder = new WETHBytecodeBuilder(this.dexHelper);
  }

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

  getAddress(executorName: Executors): Address {
    if (!Object.values(Executors).includes(executorName)) {
      throw new Error(`${executorName} is not supported`);
    }

    return this.dexHelper.config.data.executorsAddresses![executorName];
  }

  getBytecodeBuilder(
    executorName: Executors,
    hasMultiRoute = false,
  ): ExecutorBytecodeBuilder {
    switch (executorName) {
      case Executors.ONE:
        return this.executor01BytecodeBuilder;
      case Executors.TWO:
        return hasMultiRoute
          ? this.executor02MultiRouteBytecodeBuilder
          : this.executor02BytecodeBuilder;
      case Executors.THREE:
        return this.executor03BytecodeBuilder;
      case Executors.WETH:
        return this.wethBytecodeBuilder;
      default:
        throw new Error(`${executorName} is not supported`);
    }
  }
}
