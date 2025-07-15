import { Solidly } from '../solidly';
import { SolidlyPair } from '../types';
import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { Interface } from '@ethersproject/abi';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { SolidlyRpcPoolTracker } from '../rpc-pool-tracker';
import { uint256DecodeToNumber, addressDecode } from '../../../lib/decoders';
import { MultiCallParams } from '../../../lib/multi-wrapper';

const EqualizerFactoryABI = [
  {
    inputs: [{ internalType: 'address', name: '_pair', type: 'address' }],
    name: 'getRealFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
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

const equalizerFactoryIface = new Interface(EqualizerFactoryABI);

export class Equalizer extends SolidlyRpcPoolTracker {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['Equalizer']));

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
      callData: equalizerFactoryIface.encodeFunctionData('getRealFee', [
        pair.exchange,
      ]),
    };
    const callDecoder = (values: any[]) =>
      parseInt(
        equalizerFactoryIface
          .decodeFunctionResult('getRealFee', values)[0]
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
      callData: equalizerFactoryIface.encodeFunctionData('allPairsLength', []),
      decodeFunction: uint256DecodeToNumber,
    };
  }

  protected getPoolCallData(index: number): MultiCallParams<string> {
    return {
      target: this.factoryAddress,
      callData: equalizerFactoryIface.encodeFunctionData('allPairs', [index]),
      decodeFunction: addressDecode,
    };
  }
}
