import { Address } from '../../types';
import { Levels, OrderERC20 } from '@airswap/types';

export type AirSwapDeployment = {
  swapERC20Address: Address;
  registryAddress: Address;
  registryBlock: number;
  domainName: string;
  domainVersion: string;
};

export type AirSwapRegistryResponse = string[];

export type AirSwapPricingResponse = {
  jsonrpc: string;
  id: string;
  result: [
    {
      baseToken: string;
      quoteToken: string;
      minimum: string;
      bid: Levels;
      ask: Levels;
    },
  ];
};

export type AirSwapFetcherConfig = {
  interval: number;
  cacheTTL: number;
};

export type AirSwapOrderResponse = {
  url: string;
  order?: OrderERC20;
};

export type AirSwapRegistryState = {
  stakerServerURLs: Record<string, string>;
  protocolsByStaker: Record<string, string[]>;
  stakersByProtocol: Record<string, string[]>;
  tokensByStaker: Record<string, string[]>;
  stakersByToken: Record<string, string[]>;
};
