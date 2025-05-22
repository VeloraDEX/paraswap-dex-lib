import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';
import { DexParam } from './types';
import {
  AaveV3Arbitrum,
  AaveV3Avalanche,
  AaveV3BNB,
  AaveV3Base,
  AaveV3Ethereum,
  AaveV3Fantom,
  AaveV3Optimism,
  AaveV3Polygon,
  AaveV3Gnosis,
  AaveV3EthereumLido,
} from '@bgd-labs/aave-address-book';

// TODO: find vals for V3
export const Config: DexConfigMap<DexParam> = {
  AaveV3: {
    [Network.FANTOM]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Fantom.POOL,
      wethGatewayAddress: AaveV3Fantom.WETH_GATEWAY,
    },
    [Network.POLYGON]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Polygon.POOL,
      wethGatewayAddress: AaveV3Polygon.WETH_GATEWAY,
    },
    [Network.AVALANCHE]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Avalanche.POOL,
      wethGatewayAddress: AaveV3Avalanche.WETH_GATEWAY,
    },
    [Network.ARBITRUM]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Arbitrum.POOL,
      wethGatewayAddress: AaveV3Arbitrum.WETH_GATEWAY,
    },
    [Network.OPTIMISM]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Optimism.POOL,
      wethGatewayAddress: AaveV3Optimism.WETH_GATEWAY,
    },
    [Network.MAINNET]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Ethereum.POOL,
      wethGatewayAddress: AaveV3Ethereum.WETH_GATEWAY,
    },
    [Network.BASE]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Base.POOL,
      wethGatewayAddress: AaveV3Base.WETH_GATEWAY,
    },
    [Network.BSC]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3BNB.POOL,
      wethGatewayAddress: AaveV3BNB.WETH_GATEWAY,
    },
    // [Network.ZKEVM]: {
    //   ethGasCost: 246 * 100,
    //   lendingGasCost: 328 * 1000,
    //   poolAddress: AaveV3PolygonZkEvm.POOL,
    //   wethGatewayAddress: AaveV3PolygonZkEvm.WETH_GATEWAY,
    // },
    [Network.GNOSIS]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3Gnosis.POOL,
      wethGatewayAddress: AaveV3Gnosis.WETH_GATEWAY,
    },
  },
  AaveV3Lido: {
    [Network.MAINNET]: {
      ethGasCost: 246 * 100,
      lendingGasCost: 328 * 1000,
      poolAddress: AaveV3EthereumLido.POOL,
      wethGatewayAddress: AaveV3EthereumLido.WETH_GATEWAY,
    },
  },
};

export const Adapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  [Network.FANTOM]: {
    [SwapSide.SELL]: [
      {
        name: 'FantomAdapter01',
        index: 6,
      },
    ],
  },
  [Network.POLYGON]: {
    [SwapSide.SELL]: [
      {
        name: 'PolygonAdapter02',
        index: 1,
      },
    ],
  },
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [
      {
        name: 'AvalancheAdapter01',
        index: 9,
      },
    ],
  },
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [
      {
        name: 'ArbitrumAdapter01',
        index: 12,
      },
    ],
  },
  [Network.OPTIMISM]: {
    [SwapSide.SELL]: [
      {
        name: 'OptimismAdapter01',
        index: 6,
      },
    ],
  },
  [Network.MAINNET]: {
    [SwapSide.SELL]: [
      {
        name: 'Adapter03',
        index: 13,
      },
    ],
  },
  [Network.BASE]: {
    [SwapSide.SELL]: [
      {
        name: 'BaseAdapter01',
        index: 9,
      },
    ],
  },
  [Network.BSC]: {
    [SwapSide.SELL]: [
      {
        name: 'BscAdapter02',
        index: 9,
      },
    ],
  },
  [Network.ZKEVM]: {
    [SwapSide.SELL]: [
      {
        name: 'PolygonZkEvmAdapter02',
        index: 1,
      },
    ],
  },
};
