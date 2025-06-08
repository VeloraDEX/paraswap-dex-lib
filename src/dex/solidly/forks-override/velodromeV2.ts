import { Network } from '../../../constants';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { Address, Token } from '../../../types';
import { SolidlyPair } from '../types';
import { IDexHelper } from '../../../dex-helper';
import { BytesLike, Interface } from 'ethers';
import { addressDecode, uint256DecodeToNumber } from '../../../lib/decoders';
import { MultiCallParams } from '../../../lib/multi-wrapper';
import { SolidlyRpcPoolTracker } from '../rpc-pool-tracker';

const VelodromeV2FactoryABI = [
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

const velodromeV2FactoryIface = new Interface(VelodromeV2FactoryABI);

type Pool = {
  address: Address;
  token0: Token;
  token1: Token;
  reserve0: bigint;
  reserve1: bigint;
};

export class VelodromeV2 extends SolidlyRpcPoolTracker {
  public pools: Pool[] = [];

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['VelodromeV2']));

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
      callData: velodromeV2FactoryIface.encodeFunctionData('getFee', [
        pair.exchange,
        pair.stable,
      ]),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        velodromeV2FactoryIface
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
      callData: velodromeV2FactoryIface.encodeFunctionData(
        'allPoolsLength',
        [],
      ),
      decodeFunction: uint256DecodeToNumber,
    };
  }

  protected getPoolCallData(index: number): MultiCallParams<string> {
    return {
      target: this.factoryAddress,
      callData: velodromeV2FactoryIface.encodeFunctionData('allPools', [index]),
      decodeFunction: addressDecode,
    };
  }
}
