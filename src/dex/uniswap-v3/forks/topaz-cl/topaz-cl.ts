import { VelodromeSlipstream } from '../velodrome-slipstream/velodrome-slipstream';
import { Network } from '../../../../constants';
import { getDexKeysWithNetwork } from '../../../../utils';
import { UniswapV3Config } from '../../config';
import _ from 'lodash';

export class TopazCL extends VelodromeSlipstream {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(UniswapV3Config, ['TopazCL']));
}
