import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';
import {
  AaveV3Arbitrum,
  AaveV3Avalanche,
  AaveV3BNB,
  AaveV3Base,
  AaveV3Ethereum,
  AaveV3Gnosis,
  // AaveV3Metis,
  AaveV3Optimism,
  AaveV3Polygon,
  // AaveV3Scroll,
} from '@bgd-labs/aave-address-book';

export const AaveV3StataConfig: DexConfigMap<DexParams> = {
  AaveV3Stata: {
    [Network.MAINNET]: {
      factoryAddress: AaveV3Ethereum.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.POLYGON]: {
      factoryAddress: AaveV3Polygon.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.AVALANCHE]: {
      factoryAddress: AaveV3Avalanche.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.ARBITRUM]: {
      factoryAddress: AaveV3Arbitrum.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.OPTIMISM]: {
      factoryAddress: AaveV3Optimism.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.BASE]: {
      factoryAddress: AaveV3Base.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.BSC]: {
      factoryAddress: AaveV3BNB.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    [Network.GNOSIS]: {
      factoryAddress: AaveV3Gnosis.LEGACY_STATIC_A_TOKEN_FACTORY,
    },
    // [Network.Scroll]: {
    //   factoryAddress: AaveV3Scroll.STATIC_A_TOKEN_FACTORY,
    // },
    // [Network.Metis]: {
    //   factoryAddress: AaveV3Metis.STATIC_A_TOKEN_FACTORY,
    // },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  // TODO: add adapters for each chain for V5 support
  [Network.MAINNET]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
  [Network.POLYGON]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
  [Network.AVALANCHE]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
  [Network.ARBITRUM]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
  [Network.OPTIMISM]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
  [Network.BASE]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
  [Network.BSC]: { [SwapSide.SELL]: [{ name: '', index: 0 }] },
};
