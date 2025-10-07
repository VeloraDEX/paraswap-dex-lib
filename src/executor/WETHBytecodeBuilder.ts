import { DexExchangeBuildParam } from '../types';
import { OptimalRate } from '@paraswap/core';
import { isETHAddress } from '../utils';
import { DepositWithdrawReturn } from '../dex/weth/types';
import { WethConfig } from '../dex/weth/config';
import { Executors } from './types';
import { ExecutorBytecodeBuilder } from './ExecutorBytecodeBuilder';
import { Network } from '../constants';

const SUPPORTED_NETWORKS = [
  Network.MAINNET,
  Network.AVALANCHE,
  Network.BSC,
  Network.BASE,
  Network.POLYGON,
  Network.OPTIMISM,
  Network.GNOSIS,
  Network.UNICHAIN,
  Network.SONIC,
];
const SUPPORTED_EXCHANGES = Object.keys(WethConfig);

export const isSingleWrapRoute = (priceRoute: OptimalRate): boolean => {
  // Note: ARBITRUM does not support fallback deposit case

  const isSingleSwap =
    priceRoute.bestRoute.length === 1 &&
    priceRoute.bestRoute[0].swaps.length === 1 &&
    priceRoute.bestRoute[0].swaps[0].swapExchanges.length === 1;

  const { exchange } = priceRoute.bestRoute[0].swaps[0].swapExchanges[0];

  const isWethExchange = SUPPORTED_EXCHANGES.includes(exchange);
  const supportedNetwork = SUPPORTED_NETWORKS.includes(priceRoute.network);

  const isWrap = isETHAddress(priceRoute.srcToken);

  return supportedNetwork && isSingleSwap && isWethExchange && isWrap;
};

/**
 * Class to build bytecode for WETH - simple optimisation for a single ETH->WETH Swap
 */
export class WETHBytecodeBuilder extends ExecutorBytecodeBuilder {
  type = Executors.WETH;

  public getAddress(): string {
    return this.dexHelper.config.data.wrappedNativeTokenAddress;
  }

  public buildByteCode(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeBuildParam[],
    sender: string,
    maybeWethCallData?: DepositWithdrawReturn,
  ): string {
    return '0x';
  }
}
