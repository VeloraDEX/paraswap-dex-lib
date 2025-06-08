import { Contract } from 'web3-eth-contract';
import { ConcentratorArusdState } from './types';
import { Interface } from 'ethers';

export async function getOnChainState(
  multiContract: Contract,
  poolAddress: string,
  poolInterface: Interface,
  blockNumber: number | 'latest',
): Promise<ConcentratorArusdState> {
  const data: { returnData: any[] } = await multiContract.methods
    .aggregate([
      {
        target: poolAddress,
        callData: poolInterface.encodeFunctionData('totalSupply', []),
      },
      {
        target: poolAddress,
        callData: poolInterface.encodeFunctionData('getTotalAssets', []),
      },
    ])
    .call({}, blockNumber);

  const totalSupply = BigInt(
    poolInterface.decodeFunctionResult('totalSupply', data.returnData[0])[0],
  ).toString();
  const totalAssets = BigInt(
    poolInterface.decodeFunctionResult('getTotalAssets', data.returnData[1])[0],
  ).toString();
  return {
    totalSupply,
    totalAssets,
  };
}
