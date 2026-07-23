import { Network } from '../../constants';
import { UniswapV2Config } from './config';
import { BiSwapConfig } from './biswap';

export const AllUniswapForks = [
  ...Object.keys(UniswapV2Config),
  ...Object.keys(BiSwapConfig),
];

const transformToNetworkMap = (config: {
  [dexKey: string]: { [network: number]: any };
}) =>
  Object.entries(config).reduce(
    (
      acc: { [network: number]: string[] },
      [dexKey, networkConfig]: [string, { [network: number]: string[] }],
    ) => {
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
  ...BiSwapConfig,
});

export const UniswapV2Alias: { [network: number]: string } = {
  [Network.MAINNET]: 'uniswapv2',
  [Network.BSC]: 'uniswapv2',
  [Network.POLYGON]: 'uniswapv2',
  [Network.AVALANCHE]: 'uniswapv2',
  [Network.ARBITRUM]: 'uniswapv2',
  [Network.OPTIMISM]: 'uniswapv2',
  [Network.BASE]: 'uniswapv2',
  [Network.GNOSIS]: 'sushiswap', // no direct UniswapV2 integration on Gnosis
  [Network.UNICHAIN]: 'uniswapv2',
};
