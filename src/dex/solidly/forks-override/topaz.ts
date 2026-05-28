import { Network } from '../../../constants';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { SolidlyPair } from '../types';
import { Interface } from '@ethersproject/abi';
import { IDexHelper } from '../../../dex-helper';
import { addressDecode, uint256DecodeToNumber } from '../../../lib/decoders';
import { MultiCallParams } from '../../../lib/multi-wrapper';
import { SolidlyRpcPoolTracker } from '../rpc-pool-tracker';

const TopazFactoryABI = [
  {
    inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    name: 'allPools',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPoolsLength',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'pool', type: 'address' },
      { internalType: 'bool', name: '_stable', type: 'bool' },
    ],
    name: 'getFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const topazFactoryIface = new Interface(TopazFactoryABI);

export class Topaz extends SolidlyRpcPoolTracker {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['Topaz']));

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(network, dexKey, dexHelper, true);
  }

  protected getFeesMultiCallData(pair: SolidlyPair) {
    const callEntry = {
      target: this.factoryAddress,
      callData: topazFactoryIface.encodeFunctionData('getFee', [
        pair.exchange,
        pair.stable,
      ]),
    };
    const callDecoder = (values: any[]) =>
      parseInt(
        topazFactoryIface.decodeFunctionResult('getFee', values)[0].toString(),
      );

    return {
      callEntry,
      callDecoder,
    };
  }

  protected getAllPoolsCallData(): MultiCallParams<number> {
    return {
      target: this.factoryAddress,
      callData: topazFactoryIface.encodeFunctionData('allPoolsLength', []),
      decodeFunction: uint256DecodeToNumber,
    };
  }

  protected getPoolCallData(index: number): MultiCallParams<string> {
    return {
      target: this.factoryAddress,
      callData: topazFactoryIface.encodeFunctionData('allPools', [index]),
      decodeFunction: addressDecode,
    };
  }
}
