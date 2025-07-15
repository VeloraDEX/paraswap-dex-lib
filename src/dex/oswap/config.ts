import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const OSWAP_GAS_COST = 80_000;

// Important:
//  - All addresses should be lower case.
//  - Only tokens with 18 decimals are supported.
export const OSwapConfig: DexConfigMap<DexParams> = {
  OSwap: {
    [Network.MAINNET]: {
      pools: [
        {
          id: 'OSwap_0x85b78aca6deae198fbf201c82daf6ca21942acc6', // Pool identifier: `{dex_key}_{pool_address}`
          address: '0x85b78aca6deae198fbf201c82daf6ca21942acc6', // Address of the pool
          token0: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
          token1: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // STETH
        },
      ],
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.MAINNET]: {
    // Note: We re-use the SmarDex adapters since it implements
    // an Uniswap V2 router compatible interface, which OSwap supports.
    [SwapSide.SELL]: [{ name: 'Adapter04', index: 6 }],
    [SwapSide.BUY]: [{ name: 'BuyAdapter02', index: 2 }],
  },
};
