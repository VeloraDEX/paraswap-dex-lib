import { Solidly } from '../solidly';
import { SolidlyPair } from '../types';
import { Network } from '../../../constants';
import { IDexHelper } from '../../../dex-helper';
import { Interface } from '@ethersproject/abi';
import { SolidlyConfig } from '../config';
import { getDexKeysWithNetwork } from '../../../utils';
import _ from 'lodash';
import { BytesLike } from 'ethers';

const SpiritSwapV2PairABI = [
  {
    inputs: [],
    name: 'fee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const spiritSwapV2PairIface = new Interface(SpiritSwapV2PairABI);

export class SpiritSwapV2 extends Solidly {
  feeFactor = 1e9;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['SpiritSwapV2']));

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
      target: pair.exchange!,
      callData: spiritSwapV2PairIface.encodeFunctionData('fee', []),
    };
    const callDecoder = (values: BytesLike) => {
      const fees = parseInt(
        spiritSwapV2PairIface.decodeFunctionResult('fee', values)[0].toString(),
      );
      if (!fees) return 0;

      const feeCode = Math.ceil(this.feeFactor / fees);
      return feeCode;
    };

    return {
      callEntry,
      callDecoder,
    };
  }
}
