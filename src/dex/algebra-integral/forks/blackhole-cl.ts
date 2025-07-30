import _ from 'lodash';
import { Interface } from 'ethers/lib/utils';
import SwapRouter from '../../../abi/algebra-integral/SwapRouter.abi.json';
import AlgebraQuoterABI from '../../../abi/algebra-integral/Quoter.abi.json';

import {
  _require,
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isDestTokenTransferFeeToBeExchanged,
  isSrcTokenTransferFeeToBeExchanged,
} from '../../../utils';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import { AlgebraIntegralConfig } from '../config';
import { AlgebraIntegral } from '../algebra-integral';
import { Network } from '../../../constants';

export class BlackholeCL extends AlgebraIntegral {
  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(AlgebraQuoterABI),
    readonly config = AlgebraIntegralConfig[dexKey][network],
  ) {
    super(network, dexKey, dexHelper, routerIface, quoterIface, config);
  }

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(AlgebraIntegralConfig, ['BlackholeCL']));
}
