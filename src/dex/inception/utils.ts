import { Contract } from 'web3-eth-contract';
import { DexParams, PoolState } from './types';
import { AbiCoder, Interface } from '@ethersproject/abi';
import { InceptionConfig } from './config';
import { Network } from '../../constants';

const coder = new AbiCoder();

export async function getOnChainState(
  multiContract: Contract,
  poolInterface: Interface,
  network: Network,
  blockNumber: number | 'latest',
): Promise<PoolState> {
  let tokenList = await getTokenList(network);
  const state: PoolState = {};
  for (const p of tokenList) {
    let addr;
    if (p.baseTokenSlug === 'ETH') {
      addr = p.token;
    } else {
      addr = p.vault;
    }

    const data = await multiContract.methods
      .aggregate([
        {
          target: addr,
          callData: poolInterface.encodeFunctionData('ratio', []),
        },
      ])
      .call({}, blockNumber);

    const decodedData = coder.decode(['uint256'], data.returnData[0]);
    const ratio = BigInt(decodedData[0].toString());
    state[p.symbol.toLowerCase()] = { ratio };
  }

  return state;
}

export const getTokenList = async (network: Network): Promise<DexParams[]> => {
  return InceptionConfig['InceptionLRT'][network];
};
