import { Network } from '../../constants';
import { RingV2Config } from './config';

// BakerySwap and Dystopia were removed from AllRingForks and RingForksWithNetwork
// as they have a modified pool implementation which are not compatible with
// standard contract methods

export const AllRingForks = [
  ...Object.keys(RingV2Config).filter(dexKey => dexKey !== 'BakerySwap'),
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

export const RingForksWithNetwork = transformToNetworkMap({
  ...RingV2Config,
});

export const RingV2Alias: { [network: number]: string } = {
  [Network.MAINNET]: 'ringv2',
  [Network.BSC]: 'ringv2',
  [Network.POLYGON]: 'ringv2',
  [Network.AVALANCHE]: 'ringv2',
  [Network.ARBITRUM]: 'ringv2',
  [Network.OPTIMISM]: 'ringv2',
  [Network.BASE]: 'ringv2',

  // use only to handle RingForkOptimized build with this dex
  [Network.FANTOM]: 'spookyswap',
};
