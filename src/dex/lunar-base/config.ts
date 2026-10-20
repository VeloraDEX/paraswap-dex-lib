import { DexConfigMap } from '../../types';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../constants';
import { DexParams, LunarBaseTokenConfig } from './types';

const native = (symbol: string): LunarBaseTokenConfig => ({
  address: ETHER_ADDRESS,
  poolAddress: NULL_ADDRESS,
  decimals: 18,
  symbol,
});

const erc20 = (
  address: string,
  decimals: number,
  symbol: string,
): LunarBaseTokenConfig => ({
  address: address.toLowerCase(),
  poolAddress: address.toLowerCase(),
  decimals,
  symbol,
});

const BASE_USDC = erc20(
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  6,
  'USDC',
);
const BASE_CBBTC = erc20(
  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  8,
  'cbBTC',
);
const BSC_USDT = erc20(
  '0x55d398326f99059fF775485246999027B3197955',
  18,
  'USDT',
);
const BSC_BTCB = erc20(
  '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9C',
  18,
  'BTCB',
);

// Each pool is a pair contract with tokens X and Y fixed at deployment.
// The pool's X/Y order is not canonical (USDC is X in the cbBTC pool).
export const LunarBaseConfig: DexConfigMap<DexParams> = {
  LunarBase: {
    [Network.BASE]: {
      pools: [
        {
          // ETH/USDC
          address: '0x0000efc4ec03a7c47d3a38a9be7ff1d52dd01b99',
          tokenX: native('ETH'),
          tokenY: BASE_USDC,
        },
        {
          // cbBTC/USDC
          address: '0xcb1c06554772bc855d81a6be648cc599710e1b99',
          tokenX: BASE_USDC,
          tokenY: BASE_CBBTC,
        },
      ],
    },
    [Network.BSC]: {
      pools: [
        {
          // BNB/USDT
          address: '0x00007904d186680c709519e71f4dc3e2df8f1b99',
          tokenX: native('BNB'),
          tokenY: BSC_USDT,
        },
        {
          // BTCB/USDT
          address: '0x0b1ce37bc7ee857916b4e2df9f69775c36831b99',
          tokenX: BSC_USDT,
          tokenY: BSC_BTCB,
        },
      ],
    },
  },
};

// Gas of the pool call made by a Velora executor, measured on Base and BSC
// forks: 79-91k for the current pools, 116-119k for the older cbBTC pool.
export const LUNAR_BASE_GAS_COST = 100_000;
