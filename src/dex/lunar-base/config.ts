import { DexConfigMap } from '../../types';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../constants';
import { DexParams } from './types';

export const LUNAR_BASE_POOL_BASE =
  '0x0000eFC4ec03a7c47D3a38A9Be7Ff1d52dD01b99'.toLowerCase();

export const BASE_USDC =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase();

export const LunarBaseConfig: DexConfigMap<DexParams> = {
  LunarBase: {
    [Network.BASE]: {
      pools: [
        {
          address: LUNAR_BASE_POOL_BASE,
          tokenX: {
            address: ETHER_ADDRESS,
            poolAddress: NULL_ADDRESS,
            decimals: 18,
            symbol: 'ETH',
          },
          tokenY: {
            address: BASE_USDC,
            poolAddress: BASE_USDC,
            decimals: 6,
            symbol: 'USDC',
          },
        },
      ],
    },
  },
};
