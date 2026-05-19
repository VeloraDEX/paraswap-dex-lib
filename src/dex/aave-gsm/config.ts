import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';
import { AaveV3Ethereum } from '@bgd-labs/aave-address-book';

export const AaveGsmConfig: DexConfigMap<DexParams> = {
  AaveGsm: {
    [Network.MAINNET]: {
      POOL: AaveV3Ethereum.POOL.toLowerCase(),
      GSM_USDT: '0x882285E62656b9623AF136Ce3078c6BdCc33F5E3'.toLowerCase(),
      GSM_USDC: '0x3A3868898305f04beC7FEa77BecFf04C13444112'.toLowerCase(),
      waEthUSDT: AaveV3Ethereum.ASSETS.USDT.STATA_TOKEN.toLowerCase(),
      waEthUSDC: AaveV3Ethereum.ASSETS.USDC.STATA_TOKEN.toLowerCase(),
      GHO: AaveV3Ethereum.ASSETS.GHO.UNDERLYING.toLowerCase(),
    },
  },
};
