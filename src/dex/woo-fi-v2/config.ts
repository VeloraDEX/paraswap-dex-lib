import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const WooFiV2Config: DexConfigMap<DexParams> = {
  WooFiV2: {
    [Network.OPTIMISM]: {
      wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
      wooOracleV2Address: '0xA43305Ce0164D87d7B2368f91a1dcC4eBdA75127',
      integrationHelperAddress: '0x96329d66074EB8386Ae8bFD6698B2E3FDA87e15E',
      // USDC
      quoteToken: {
        address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        decimals: 6,
      },
    },
    [Network.BSC]: {
      wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
      wooOracleV2Address: '0x2A375567f5E13F6bd74fDa7627Df3b1Af6BfA5a6',
      integrationHelperAddress: '0xAA9c15cd603428cA8ddD45e933F8EfE3Afbcc173',
      // USDT
      quoteToken: {
        address: '0x55d398326f99059fF775485246999027B3197955',
        decimals: 18,
      },
    },
    [Network.POLYGON]: {
      wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
      wooOracleV2Address: '0x2A8Ede62D0717C8C92b88639ecf603FDF31A8428',
      integrationHelperAddress: '0x7Ba560eB735AbDCf9a3a5692272652A0cc81850d',
      // USDC
      quoteToken: {
        address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        decimals: 6,
      },
    },
    // deprecated
    // [Network.FANTOM]: {
    //   wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
    //   wooOracleV2Address: '0xB1d022F8F3e43868DaaDfa7040e63781C16aB4A6',
    //   integrationHelperAddress: '0x6641959FE5EED7166F2254cF04b0d20c96776D9A',
    //   // USDC
    //   quoteToken: {
    //     address: '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75',
    //     decimals: 6,
    //   },
    // },
    [Network.ARBITRUM]: {
      wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
      wooOracleV2Address: '0xCf4EA1688bc23DD93D933edA535F8B72FC8934Ec',
      integrationHelperAddress: '0x28D2B949024FE50627f1EbC5f0Ca3Ca721148E40',
      // USDC
      quoteToken: {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        decimals: 6,
      },
    },
    [Network.AVALANCHE]: {
      wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
      wooOracleV2Address: '0x2A375567f5E13F6bd74fDa7627Df3b1Af6BfA5a6',
      integrationHelperAddress: '0x020630613E296c3E9b06186f630D1bF97A2B6Ad1',
      // USDC
      quoteToken: {
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        decimals: 6,
      },
    },
    [Network.BASE]: {
      wooPPV2Address: '0x5520385bFcf07Ec87C4c53A7d8d65595Dff69FA4',
      wooOracleV2Address: '0x2A375567f5E13F6bd74fDa7627Df3b1Af6BfA5a6',
      integrationHelperAddress: '0xC4E9B633685461E7B7A807D12a246C81f96F31B8',
      // USDbC
      quoteToken: {
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        decimals: 6,
      },
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [{ name: 'OptimismAdapter01', index: 11 }],
  },
  [Network.BSC]: { [SwapSide.SELL]: [{ name: 'BscAdapter01', index: 13 }] },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [{ name: 'PolygonAdapter02', index: 4 }],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter02', index: 3 }],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter01', index: 12 }],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [{ name: 'BaseAdapter01', index: 5 }],
  },
};
