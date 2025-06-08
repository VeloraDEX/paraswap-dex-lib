import { Contract } from 'web3-eth-contract';
import { ETHxPoolState } from './types';
import { Interface, AbiCoder } from 'ethers';

export async function getOnChainStateETHx(
  multiContract: Contract,
  poolAddress: string,
  poolInterface: Interface,
  blockNumber: number | 'latest',
): Promise<ETHxPoolState> {
  const coder = new AbiCoder();
  const data: { returnData: any[] } = await multiContract.methods
    .aggregate([
      {
        target: poolAddress,
        callData: poolInterface.encodeFunctionData('getExchangeRate', []),
      },
    ])
    .call({}, blockNumber);

  const decodedData = coder.decode(
    ['uint256', 'uint256', 'uint256'],
    data.returnData[0],
  );

  const totalETHBalance = BigInt(decodedData[1].toString());
  const totalETHXSupply = BigInt(decodedData[2].toString());

  return {
    totalETHBalance,
    totalETHXSupply,
  };
}
