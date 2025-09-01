import { UnoptimizedRate, OptimalSwapExchange } from '../../types';
import {
  FractionAsString,
  BalancerSwap,
  OptimizedBalancerV1Data,
  BalancerV1Data,
} from './types';
import { MAX_UINT, SwapSide } from '../../constants';
import { BalancerV1Config } from './config';
import BigNumber from 'bignumber.js';

export function balancerV1Merge(or: UnoptimizedRate): UnoptimizedRate {
  const fixSwap = (
    rawSwap: OptimalSwapExchange<any>[],
    exchange: string,
    side: SwapSide,
  ): OptimalSwapExchange<any>[] => {
    const exchangeLower = exchange.toLowerCase();
    const newBalancer: OptimalSwapExchange<
      OptimizedBalancerV1Data & { gasUSD: FractionAsString }
    > = {
      exchange,
      srcAmount: '0',
      destAmount: '0',
      percent: 0,
      poolAddresses: [],
      poolIdentifiers: [],
      data: {
        swaps: new Array<BalancerSwap>(),
        gasUSD: '0',
      },
    };
    const optimizedSwap = new Array<OptimalSwapExchange<any>>();
    rawSwap.forEach((_s: OptimalSwapExchange<any>) => {
      if (_s.exchange.toLowerCase() === exchangeLower) {
        const s: OptimalSwapExchange<
          BalancerV1Data & { gasUSD: FractionAsString }
        > = _s;
        newBalancer.srcAmount = new BigNumber(newBalancer.srcAmount)
          .plus(s.srcAmount)
          .toFixed();
        newBalancer.destAmount = new BigNumber(newBalancer.destAmount)
          .plus(s.destAmount)
          .toFixed();
        newBalancer.percent += s.percent;
        newBalancer.data!.gasUSD = new BigNumber(newBalancer.data!.gasUSD)
          .plus(s.data!.gasUSD)
          .toFixed();
        newBalancer.data!.swaps.push({
          pool: s.data!.poolId,
          tokenInParam: s.srcAmount,
          tokenOutParam: side === SwapSide.SELL ? '0' : s.destAmount,
          maxPrice: MAX_UINT,
        });
        newBalancer.poolAddresses!.push(s.poolAddresses![0]);
        newBalancer.poolIdentifiers!.push(s.poolIdentifiers![0]);
      } else {
        optimizedSwap.push(_s);
      }
    });
    if (newBalancer.data!.swaps.length) optimizedSwap.push(newBalancer);
    return optimizedSwap;
  };

  or.bestRoute = or.bestRoute.map(r => ({
    ...r,
    swaps: r.swaps.map(s => {
      return {
        ...s,
        swapExchanges: Object.keys(BalancerV1Config).reduce(
          (acc, exchange) => fixSwap(acc, exchange, or.side),
          s.swapExchanges,
        ),
      };
    }),
  }));
  return or;
}
