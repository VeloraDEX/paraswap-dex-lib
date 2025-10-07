import { Network } from '../../../constants';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { SolidlyRpcPoolTracker } from '../rpc-pool-tracker';
import { Interface } from '@ethersproject/abi';
import { uint256DecodeToNumber, addressDecode } from '../../../lib/decoders';
import { MultiCallParams } from '../../../lib/multi-wrapper';

const pharaohV1FactoryABI = [
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
];

const pharaohFactoryIface = new Interface(pharaohV1FactoryABI);

export class PharaohV1 extends SolidlyRpcPoolTracker {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['PharaohV1']));

  protected getAllPoolsCallData(): MultiCallParams<number> {
    return {
      target: this.factoryAddress,
      callData: pharaohFactoryIface.encodeFunctionData('allPairsLength', []),
      decodeFunction: uint256DecodeToNumber,
    };
  }

  protected getPoolCallData(index: number): MultiCallParams<string> {
    return {
      target: this.factoryAddress,
      callData: pharaohFactoryIface.encodeFunctionData('allPairs', [index]),
      decodeFunction: addressDecode,
    };
  }
}
