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
        {
          id: 'OSwap_0xceda2d856238aa0d12f6329de20b9115f07c366d', // Pool identifier: `{dex_key}_{pool_address}`
          address: '0xceda2d856238aa0d12f6329de20b9115f07c366d', // Address of the pool
          token0: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
          token1: '0x9d39a5de30e57443bff2a8307a4256c8797a3497', // sUSDe
          erc4626: {
            assetToken: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
            vaultToken: '0x9d39a5de30e57443bff2a8307a4256c8797a3497', // sUSDe (ERC4626 vault)
          },
        },
        {
          id: 'OSwap_0xfb0a3cf9b019bfd8827443d131b235b3e0fc58d2', // Pool identifier: `{dex_key}_{pool_address}`
          address: '0xfb0a3cf9b019bfd8827443d131b235b3e0fc58d2', // Address of the pool
          token0: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
          token1: '0x35fa164735182de50811e8e2e824cfb9b6118ac2', // eETH
        },
      ],
    },
    [Network.SONIC]: {
      pools: [
        {
          id: 'OSwap_0x2f872623d1e1af5835b08b0e49aad2d81d649d30', // Pool identifier: `{dex_key}_{pool_address}`
          address: '0x2f872623d1e1af5835b08b0e49aad2d81d649d30', // Address of the pool
          token0: '0x039e2fb66102314ce7b64ce5ce3e5183bc94ad38', // WS
          token1: '0xb1e25689d55734fd3fffc939c4c3eb52dff8a794', // OS
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
