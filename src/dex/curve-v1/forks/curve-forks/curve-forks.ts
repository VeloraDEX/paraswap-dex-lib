import { bigNumberify, getDexKeysWithNetwork } from '../../../../utils';
import { CurveV1 } from '../../curve-v1';
import { ThreePool } from '../../pools/3pool';
import { CurvePool } from '../../pools/curve-pool';
import StableSwap3Pool from '../../../../abi/curve-v1/StableSwap3Pool.json';
import { Network } from '../../../../constants';
import { IDexHelper } from '../../../../dex-helper';
import { Adapters, CurveForksConfig } from './config';

export class CurveFork extends CurveV1 {
  // Ellipsis, Acryptos etc. are not Curve deployments and are absent from
  // the Curve API, so they report no reserves.
  protected curveApiSlug = null;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CurveForksConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    dexHelper: IDexHelper,
    dexConfig = CurveForksConfig[dexKey][network],
    adapters = Adapters[network],
  ) {
    super(network, dexKey, dexHelper, dexConfig, adapters);
  }

  getEventPoolInstance(poolAddress: string): CurvePool | null {
    const config = Object.values(this.pools).find(
      c => c.address.toLowerCase() === poolAddress.toLowerCase(),
    );
    if (!config) return null;
    // TODO: Fix Me: fix the support for events pools for metapools
    // if (config.isMetapool){
    //   if(!config.basePoolAddress) return null;
    //   const basePool = this.getEventPoolInstance(config.basePoolAddress);
    //   if(!basePool) return null;
    //   return new USTPool(
    //     this.typeName,
    //     this.web3Provider,
    //     this.network,
    //     config.name,
    //     config.address,
    //     config.tokenAddress,
    //     config.trackCoins,
    //     StableSwapUST,
    //     config.coins.length,
    //     config.precisionMul.map(bignumberify),
    //     config.useLending,
    //     config.coins,
    //     basePool
    //   )
    // }
    if (
      config.tokenAddress === undefined ||
      config.precisionMul === undefined ||
      config.useLending === undefined ||
      config.trackCoins === undefined
    ) {
      throw new Error(`missing parameters for pool`);
    }

    return new ThreePool(
      this.dexKey,
      this.dexHelper,
      config.name,
      config.address,
      config.tokenAddress,
      config.trackCoins,
      StableSwap3Pool,
      config.coins.length,
      config.precisionMul!.map(bigNumberify),
      config.useLending,
      config.coins,
    );
  }
}
