import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper/index';
import { UniswapV2 } from '../uniswap-v2/uniswap-v2';
import { AeonVAMMConfig } from './config';
import { getDexKeysWithNetwork } from '../../utils';

/**
 * AEON Protocol vAMM — constant product (x*y=k) AMM on Avalanche.
 * Factory: 0x3ECf287990A2365d48C6681620393aC1cdF3D268
 * Chain:   Avalanche C-Chain (43114)
 * Docs:    https://app.aeonprotocol.xyz/docs
 */
export class AeonVAMM extends UniswapV2 {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AeonVAMMConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    const cfg = AeonVAMMConfig[dexKey][network];
    super(
      network,
      dexKey,
      dexHelper,
      false,              // isDynamicFees
      cfg.factoryAddress,
      cfg.subgraphURL,
      cfg.initCode,
      cfg.feeCode,
      cfg.poolGasCost,
    );
  }
}
