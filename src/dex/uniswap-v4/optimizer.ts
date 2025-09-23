import { UnoptimizedRate, OptimalSwap } from '../../types';
import _ from 'lodash';
import { UniswapV4Config } from './config';

const UniswapV4AndForks = Object.keys(UniswapV4Config).map(dexKey =>
  dexKey.toLowerCase(),
);

export function uniswapV4Merge(or: UnoptimizedRate): UnoptimizedRate {
  const fixRoute = (rawRate: OptimalSwap[]): OptimalSwap[] => {
    let lastExchange: false | OptimalSwap = false;
    let optimizedRate = new Array<OptimalSwap>();
    rawRate.forEach((s: OptimalSwap) => {
      if (
        s.swapExchanges.length !== 1 ||
        !UniswapV4AndForks.includes(s.swapExchanges[0].exchange.toLowerCase())
      ) {
        lastExchange = false;
        optimizedRate.push(s);
      } else if (
        lastExchange &&
        lastExchange.swapExchanges[0].exchange.toLowerCase() ===
          s.swapExchanges[0].exchange.toLowerCase() &&
        _.last(
          <any[]>lastExchange.swapExchanges[0].data.path,
        )!.tokenOut.toLowerCase() ===
          s.swapExchanges[0].data.path[0].tokenIn.toLowerCase()
      ) {
        lastExchange.swapExchanges[0].data.path.push(
          s.swapExchanges[0].data.path[0],
        );
        lastExchange.swapExchanges[0].poolAddresses!.push(
          s.swapExchanges[0].poolAddresses![0],
        );
        lastExchange.swapExchanges[0].poolIdentifiers!.push(
          s.swapExchanges[0].poolIdentifiers![0],
        );
        lastExchange.swapExchanges[0].data.gasUSD = (
          parseFloat(lastExchange.swapExchanges[0].data.gasUSD) +
          parseFloat(s.swapExchanges[0].data.gasUSD)
        ).toFixed(6);
        lastExchange.destToken = s.destToken;
        lastExchange.destDecimals = s.destDecimals;
        lastExchange.swapExchanges[0].destAmount =
          s.swapExchanges[0].destAmount;
      } else {
        lastExchange = _.cloneDeep(s);
        optimizedRate.push(lastExchange);
      }
    });
    return optimizedRate;
  };
  or.bestRoute = or.bestRoute.map(r => ({
    ...r,
    swaps: fixRoute(r.swaps),
  }));
  return or;
}
