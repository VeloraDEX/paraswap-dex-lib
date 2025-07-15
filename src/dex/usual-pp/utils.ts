import { Contract } from 'web3-eth-contract';
import { Interface } from '@ethersproject/abi';
import { PoolState } from './types';

export async function getOnChainState(
  multiContract: Contract,
  poolAddress: string,
  poolInterface: Interface,
  blockNumber: number | 'latest',
): Promise<PoolState> {
  const data: { returnData: any[] } = await multiContract.methods
    .aggregate([
      {
        target: poolAddress,
        callData: poolInterface.encodeFunctionData('getFloorPrice', []),
      },
    ])
    .call({}, blockNumber);

  const price = BigInt(
    poolInterface.decodeFunctionResult('getFloorPrice', data.returnData[0])[0],
  );

  return {
    price,
  };
}
