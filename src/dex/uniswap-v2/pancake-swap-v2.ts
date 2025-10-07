import _ from 'lodash';
import { Network } from '../../constants';
import { getDexKeysWithNetwork } from '../../utils';
import { UniswapV2Config } from './config';
import { UniswapV2RpcPoolTracker } from './rpc-pool-tracker';

export class PancakeSwapV2 extends UniswapV2RpcPoolTracker {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(UniswapV2Config, ['PancakeSwapV2']));
}
