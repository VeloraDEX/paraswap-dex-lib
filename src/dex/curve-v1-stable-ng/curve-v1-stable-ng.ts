import {
  CurveV1Factory,
  DefaultCoinsABI,
} from '../curve-v1-factory/curve-v1-factory';
import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { Adapters, CurveV1StableNgConfig } from './config';
import { AbiItem } from 'web3-utils';
import { getDexKeysWithNetwork } from '../../utils';

export class CurveV1StableNg extends CurveV1Factory {
  // implemented as a function because need to follow CurveV1Factory interface
  needWrapNative = () => {
    return true;
  };

  needWrapNativeForPricing = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CurveV1StableNgConfig);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    protected config = CurveV1StableNgConfig['CurveV1StableNg'][network],
    // This type is used to support different encoding for uint128 and uint256 args
    protected coinsTypeTemplate: AbiItem = DefaultCoinsABI,
  ) {
    super(network, dexKey, dexHelper, adapters, config, coinsTypeTemplate);
  }
}
