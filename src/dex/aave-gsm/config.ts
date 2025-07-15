import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import { AaveV3Ethereum } from '@bgd-labs/aave-address-book';

export const AaveGsmConfig: DexConfigMap<DexParams> = {
  AaveGsm: {
    [Network.MAINNET]: {
      POOL: AaveV3Ethereum.POOL.toLowerCase(),
      GSM_USDT: '0x535b2f7C20B9C83d70e519cf9991578eF9816B7B'.toLowerCase(),
      GSM_USDC: '0xFeeb6FE430B7523fEF2a38327241eE7153779535'.toLowerCase(),
      waEthUSDT: AaveV3Ethereum.ASSETS.USDT.STATA_TOKEN.toLowerCase(),
      waEthUSDC: AaveV3Ethereum.ASSETS.USDC.STATA_TOKEN.toLowerCase(),
      GHO: AaveV3Ethereum.ASSETS.GHO.UNDERLYING.toLowerCase(),
    },
  },
};
