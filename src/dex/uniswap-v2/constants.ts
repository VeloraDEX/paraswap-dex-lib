import { Network } from '../../constants';
import { UniswapV2Config } from './config';
import { MDEXConfig } from './mdex';
import { BiSwapConfig } from './biswap';
import { DfynConfig } from './dfyn';

// BakerySwap and Dystopia were removed from AllUniswapForks and UniswapForksWithNetwork
// as they have a modified pool implementation which are not compatible with
// standard contract methods

export const AllUniswapForks = [
  ...Object.keys(UniswapV2Config).filter(dexKey => dexKey !== 'BakerySwap'),
  ...Object.keys(MDEXConfig),
  ...Object.keys(BiSwapConfig),
  ...Object.keys(DfynConfig),
];

const transformToNetworkMap = (config: {
  [dexKey: string]: { [network: number]: any };
}) =>
  Object.entries(config).reduce(
    (
      acc: { [network: number]: string[] },
      [dexKey, networkConfig]: [string, { [network: number]: string[] }],
    ) => {
      if (dexKey === 'BakerySwap') return acc;
      Object.keys(networkConfig).forEach((_n: string) => {
        const n = parseInt(_n);
        if (!(n in acc)) acc[n] = [];
        acc[n].push(dexKey.toLowerCase());
      });
      return acc;
    },
    {},
  );

export const UniswapForksWithNetwork = transformToNetworkMap({
  ...UniswapV2Config,
  ...MDEXConfig,
  ...BiSwapConfig,
  ...DfynConfig,
});

export const UniswapV2Alias: { [network: number]: string } = {
  [Network.MAINNET]: 'uniswapv2',
  [Network.BSC]: 'uniswapv2',
  [Network.POLYGON]: 'uniswapv2',
  [Network.AVALANCHE]: 'uniswapv2',
  [Network.ARBITRUM]: 'uniswapv2',
  [Network.OPTIMISM]: 'uniswapv2',
  [Network.BASE]: 'uniswapv2',

  // use only to handle UniswapForkOptimized build with this dex
  [Network.FANTOM]: 'spookyswap',
};
