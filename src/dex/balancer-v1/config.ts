import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const MAX_POOL_CNT = 1000;
export const MIN_USD_LIQUIDITY_TO_FETCH = 100;
export const BALANCES_MULTICALL_POOLS_LIMIT = 200;
export const MAX_POOLS_FOR_PRICING = 5;
// https://dashboard.tenderly.co/paraswap/paraswap/simulator/2ae61b00-ad00-41e7-bfcd-a7e4fb3534ca?trace=0.3.0.0
export const BALANCER_SWAP_GAS_COST = 150 * 1000;

export const BalancerV1Config: DexConfigMap<DexParams> = {
  BalancerV1: {
    [Network.MAINNET]: {
      poolsURL:
        'https://storageapi.fleek.co/balancer-bucket/balancer-exchange/pools',
      subgraphURL: '93yusydMYauh7cfe9jEfoGABmwnX4GffHd7in8KJi1XB',
      exchangeProxy: '0x6317c5e82a06e1d8bf200d21f4510ac2c038ac81',
      multicallAddress: '0x514053acec7177e277b947b1ebb5c08ab4c4580e',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    [SwapSide.SELL]: [{ name: 'Adapter01', index: 5 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter', index: 4 }],
  },
};
