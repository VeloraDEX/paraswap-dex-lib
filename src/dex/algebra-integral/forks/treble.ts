import _ from 'lodash';
import { Interface } from 'ethers/lib/utils';
import { Network } from '../../../constants';
import { getDexKeysWithNetwork } from '../../../utils';
import { IDexHelper } from '../../../dex-helper/idex-helper';
import SwapRouter from '../../../abi/algebra-integral/SwapRouter.abi.json';
import TrebleQuoterABI from '../../../abi/algebra-integral/treble/Quoter.abi.json';
import { AlgebraIntegralConfig } from '../config';
import { AlgebraIntegral } from '../algebra-integral';

export class Treble extends AlgebraIntegral {
  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(TrebleQuoterABI),
    readonly config = AlgebraIntegralConfig[dexKey][network],
  ) {
    super(network, dexKey, dexHelper, routerIface, quoterIface, config);
  }

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(AlgebraIntegralConfig, ['TrebleSwap']));
}
