import { UnoptimizedRate, OptimalSwap } from '../../types';
import _ from 'lodash';

export function balancerV3Merge(or: UnoptimizedRate): UnoptimizedRate {
  const fixRoute = (rawRate: OptimalSwap[]): OptimalSwap[] => {
    let lastExchange: false | OptimalSwap = false;

    let optimizedRate = new Array<OptimalSwap>();

    rawRate.forEach((s: OptimalSwap) => {
      if (
        s.swapExchanges.length !== 1 ||
        s.swapExchanges[0].exchange.toLowerCase() !== 'balancerv3'
      ) {
        lastExchange = false;
        optimizedRate.push(s);
        return;
      }

      if (
        lastExchange &&
        lastExchange.swapExchanges[0].exchange.toLowerCase() ===
          s.swapExchanges[0].exchange.toLowerCase() &&
        _.last(
          <any[]>lastExchange.swapExchanges[0].data.steps,
        )!.swapInput.tokenOut.toLowerCase() ===
          s.swapExchanges[0].data.steps[0].swapInput.tokenIn.toLowerCase()
      ) {
        lastExchange.swapExchanges[0].data.steps =
          lastExchange.swapExchanges[0].data.steps.concat(
            s.swapExchanges[0].data.steps,
          );

        lastExchange.swapExchanges[0].poolAddresses =
          lastExchange.swapExchanges[0].poolAddresses!.concat(
            s.swapExchanges[0].poolAddresses!,
          );

        lastExchange.swapExchanges[0].poolIdentifiers =
          lastExchange.swapExchanges[0].poolIdentifiers!.concat(
            s.swapExchanges[0].poolIdentifiers!,
          );

        lastExchange.swapExchanges[0].data.gasUSD = (
          parseFloat(lastExchange.swapExchanges[0].data.gasUSD) +
          parseFloat(s.swapExchanges[0].data.gasUSD)
        ).toFixed(6);

        lastExchange.destToken = s.destToken;
        lastExchange.destDecimals = s.destDecimals;

        lastExchange.swapExchanges[0].destAmount =
          s.swapExchanges[0].destAmount;

        return;
      }

      lastExchange = _.cloneDeep(s);
      optimizedRate.push(lastExchange);
    });

    return optimizedRate;
  };

  or.bestRoute = or.bestRoute.map(r => ({
    ...r,
    swaps: fixRoute(r.swaps),
  }));

  return or;
}
