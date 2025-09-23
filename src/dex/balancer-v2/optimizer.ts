import { UnoptimizedRate, OptimalSwapExchange } from '../../types';
import { BalancerSwapV2 } from './types';
import { SwapSide } from '../../constants';
import { BalancerConfig } from './config';

const AllBalancerV2Forks = Object.keys(BalancerConfig);

export function balancerV2Merge(or: UnoptimizedRate): UnoptimizedRate {
  const fixSwap = (
    rawSwap: OptimalSwapExchange<any>[],
    side: SwapSide,
  ): OptimalSwapExchange<any>[] => {
    const newBalancers: { [key: string]: OptimalSwapExchange<any> } = {};
    let optimizedSwap = new Array<OptimalSwapExchange<any>>();
    rawSwap.forEach((s: OptimalSwapExchange<any>) => {
      const exchangeKey = s.exchange.toLowerCase();
      if (AllBalancerV2Forks.some(d => d.toLowerCase() === exchangeKey)) {
        if (!(exchangeKey in newBalancers)) {
          newBalancers[exchangeKey] = {
            exchange: s.exchange,
            srcAmount: '0',
            destAmount: '0',
            percent: 0,
            poolAddresses: [],
            poolIdentifiers: [],
            data: {
              swaps: new Array<BalancerSwapV2>(),
              gasUSD: '0',
            },
          };
        }
        newBalancers[exchangeKey].srcAmount = (
          BigInt(newBalancers[exchangeKey].srcAmount) + BigInt(s.srcAmount)
        ).toString();

        newBalancers[exchangeKey].destAmount = (
          BigInt(newBalancers[exchangeKey].destAmount) + BigInt(s.destAmount)
        ).toString();

        newBalancers[exchangeKey].percent += s.percent;
        newBalancers[exchangeKey].data.exchangeProxy = s.data.exchangeProxy;
        newBalancers[exchangeKey].data.gasUSD = (
          parseFloat(newBalancers[exchangeKey].data.gasUSD) +
          parseFloat(s.data.gasUSD)
        ).toFixed(6);

        newBalancers[exchangeKey].data.swaps.push({
          poolId: s.data.poolId,
          amount: side === SwapSide.SELL ? s.srcAmount : s.destAmount,
        });
        newBalancers[exchangeKey].poolAddresses!.push(s.poolAddresses![0]);
        newBalancers[exchangeKey].poolIdentifiers!.push(s.poolIdentifiers![0]);
      } else {
        optimizedSwap.push(s);
      }
    });
    optimizedSwap = optimizedSwap.concat(Object.values(newBalancers));
    return optimizedSwap;
  };

  or.bestRoute = or.bestRoute.map(r => ({
    ...r,
    swaps: r.swaps.map(s => ({
      ...s,
      swapExchanges: fixSwap(s.swapExchanges, or.side),
    })),
  }));
  return or;
}
