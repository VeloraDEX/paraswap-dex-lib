import { Network } from '../../../constants';
import { IDexHelper } from '../../dex-helper/index';
import { UniswapV2 } from '../uniswap-v2/uniswap-v2';
import { AeonVAMMConfig, Adapters } from './config';

/**
 * AEON Protocol vAMM — constant product (x*y=k) AMM on Avalanche.
 * Identical interface to UniswapV2; extends it with AEON-specific config.
 *
 * Factory: 0x3ECf287990A2365d48C6681620393aC1cdF3D268
 * Chain:   Avalanche C-Chain (43114)
 * Docs:    https://app.aeonprotocol.xyz/docs
 */
export class AeonVAMM extends UniswapV2 {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] = [
    { key: 'AeonVAMM', networks: [Network.AVALANCHE] },
  ];

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, {
      ...AeonVAMMConfig[dexKey][network],
      adapters: Adapters,
    });
  }
}
