import { DexParams, PoolConfig } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

// One PropAMM contract per pair; no factory. The two addresses below are the only values to fill in: the WETH/USDC
// pool and the maker's registry (which lists every pool, so later pairs need no change here). An empty string
// leaves the entry out.
const WETH_USDC_POOL = '0x0d420da4ec5b28bfb1e2f82719d560e893d0b536';
const REGISTRY = '0x1726b33d3fa65c2bbf34132914fa0c05251cea34';

// BASE(), QUOTE(), PRICE_SCALE() and K_SCALE() of a pool are immutables, copied here for the pool known in advance
// (pools found through the registry have them read on chain).
const pools: PoolConfig[] = WETH_USDC_POOL
  ? [
      {
        address: WETH_USDC_POOL,
        base: {
          address: '0x4200000000000000000000000000000000000006', // WETH
          decimals: 18,
        },
        quote: {
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
          decimals: 6,
        },
        priceScale: 10n ** 8n,
        kScale: 4n,
      },
    ]
  : [];

export const MhocDeskConfig: DexConfigMap<DexParams> = {
  MhocDesk: {
    [Network.BASE]: {
      pools,
      registry: REGISTRY || undefined,
    },
  },
};

// Gas of one swap() through the approval path: 74.6k (sell WETH) / 74.1-74.2k (buy WETH) measured by the
// contract's gas script on a local chain with plain ERC-20 mocks. Base's FiatToken USDC and WETH9 cost more per
// transfer; 90k is an estimate until it is measured with the real tokens.
export const MHOC_DESK_GAS_COST = 90_000;
