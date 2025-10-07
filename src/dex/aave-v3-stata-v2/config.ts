import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import {
  AaveV3Arbitrum,
  AaveV3Base,
  AaveV3Ethereum,
  AaveV3EthereumLido,
  AaveV3Gnosis,
  AaveV3Optimism,
  AaveV3Sonic,
} from '@bgd-labs/aave-address-book';

export const AaveV3StataConfig: DexConfigMap<DexParams> = {
  AaveV3StataV2: {
    [Network.MAINNET]: [
      { factory: AaveV3Ethereum.STATA_FACTORY, pool: AaveV3Ethereum.POOL },
      {
        factory: AaveV3EthereumLido.STATA_FACTORY,
        pool: AaveV3EthereumLido.POOL,
      },
    ],
    [Network.GNOSIS]: [
      {
        factory: AaveV3Gnosis.STATA_FACTORY,
        pool: AaveV3Gnosis.POOL,
      },
    ],
    [Network.OPTIMISM]: [
      {
        factory: AaveV3Optimism.STATA_FACTORY,
        pool: AaveV3Optimism.POOL,
      },
    ],
    [Network.ARBITRUM]: [
      {
        factory: AaveV3Arbitrum.STATA_FACTORY,
        pool: AaveV3Arbitrum.POOL,
      },
    ],
    [Network.BASE]: [
      {
        factory: AaveV3Base.STATA_FACTORY,
        pool: AaveV3Base.POOL,
      },
    ],
    [Network.SONIC]: [
      {
        factory: AaveV3Sonic.STATA_FACTORY,
        pool: AaveV3Sonic.POOL,
      },
    ],
  },
};
