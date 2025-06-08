import { Solidly } from '../solidly';
import { SolidlyPair } from '../types';
import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { BytesLike, Interface } from 'ethers';
import { uint256DecodeToNumber, addressDecode } from '../../../lib/decoders';
import { MultiCallParams } from '../../../lib/multi-wrapper';
import { SolidlyRpcPoolTracker } from '../rpc-pool-tracker';

const velocimeterFactoryABI = [
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: '_pair', name: '_stable', type: 'address' }],
    name: 'getFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const velocimeterFactoryIface = new Interface(velocimeterFactoryABI);

export class Velocimeter extends SolidlyRpcPoolTracker {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['Velocimeter']));

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
      callData: velocimeterFactoryIface.encodeFunctionData('getFee', [
        pair.exchange,
      ]),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        velocimeterFactoryIface
          .decodeFunctionResult('getFee', values)[0]
          .toString(),
      );

    return {
      callEntry,
      callDecoder,
    };
  }

  protected getAllPoolsCallData(): MultiCallParams<number> {
    return {
      target: this.factoryAddress,
      callData: velocimeterFactoryIface.encodeFunctionData(
        'allPairsLength',
        [],
      ),
      decodeFunction: uint256DecodeToNumber,
    };
  }

  protected getPoolCallData(index: number): MultiCallParams<string> {
    return {
      target: this.factoryAddress,
      callData: velocimeterFactoryIface.encodeFunctionData('allPairs', [index]),
      decodeFunction: addressDecode,
    };
  }
}
