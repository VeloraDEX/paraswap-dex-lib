
import { SolidlyPair } from '../types';
import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { Interface } from '@ethersproject/abi';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { Address, Token } from '../../../types';
import { addressDecode, uint256DecodeToNumber } from '../../../lib/decoders';
import { MultiCallParams } from '../../../lib/multi-wrapper';
import { SolidlyRpcPoolTracker } from '../rpc-pool-tracker';

const BlackholeFactoryABI = [
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
      inputs: [
        { internalType: 'address', name: '_pairAddress', type: 'address' },
        { internalType: 'bool', name: '_stable', type: 'bool' },
      ],
      name: 'getFee',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];
  const blackholeFactoryIface = new Interface(BlackholeFactoryABI);
  type Pool = {
    address: Address;
    token0: Token;
    token1: Token;
    reserve0: bigint;
    reserve1: bigint;
  };

  export class Blackhole extends SolidlyRpcPoolTracker {
    public pools: Pool[] = [];
  
    public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
      getDexKeysWithNetwork(_.pick(SolidlyConfig, ['Blackhole']));
  
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
          callData: blackholeFactoryIface.encodeFunctionData('getFee', [
            pair.exchange,
            pair.stable,
          ]),
        };
        const callDecoder = (values: any[]) =>
          parseInt(
            blackholeFactoryIface
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
          callData: blackholeFactoryIface.encodeFunctionData(
            'allPairsLength',
            [],
          ),
          decodeFunction: uint256DecodeToNumber,
        };
    }

    protected getPoolCallData(index: number): MultiCallParams<string> {
        return {
          target: this.factoryAddress,
          callData: blackholeFactoryIface.encodeFunctionData('allPairs', [index]),
          decodeFunction: addressDecode,
        };
    }
}