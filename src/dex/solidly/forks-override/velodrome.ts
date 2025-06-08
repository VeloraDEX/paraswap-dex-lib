import { Solidly } from '../solidly';
import { SolidlyPair } from '../types';
import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { BytesLike, Interface } from 'ethers';

const VelodromeFactoryABI = [
  {
    inputs: [{ internalType: 'bool', name: '_stable', type: 'bool' }],
    name: 'getFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const velodromeFactoryIface = new Interface(VelodromeFactoryABI);

export class Velodrome extends Solidly {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['Velodrome']));

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      true, // dynamic fees
    );
  }

  protected getFeesMultiCallData(pair: SolidlyPair) {
    const callEntry = {
      target: this.factoryAddress,
      callData: velodromeFactoryIface.encodeFunctionData('getFee', [
        pair.stable,
      ]),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        velodromeFactoryIface
          .decodeFunctionResult('getFee', values)[0]
          .toString(),
      );

    return {
      callEntry,
      callDecoder,
    };
  }
}
