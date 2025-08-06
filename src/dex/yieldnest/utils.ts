import { Contract } from 'web3-eth-contract';
import { YNETHPoolState } from './type';
import { Interface, AbiCoder } from '@ethersproject/abi';
import { BigNumber } from 'ethers';

const coder = new AbiCoder();

export async function getOnChainStateYnETH(
  multiContract: Contract,
  poolAddress: string,
  poolInterface: Interface,
  blockNumber: number | 'latest',
): Promise<YNETHPoolState> {
  const data: { returnData: any[] } = await multiContract.methods
    .aggregate([
      {
        target: poolAddress,
        callData: poolInterface.encodeFunctionData('previewDeposit', [
          BigNumber.from(10).pow(18),
        ]),
      },
    ])
    .call({}, blockNumber);

  const decodedData = coder.decode(['uint256'], data.returnData[0]);

  const ETHToynETHRateFixed = BigInt(decodedData[0].toString());
  const ynETHToETHRateFixed = 1n / ETHToynETHRateFixed;

  return {
    ynETHToETHRateFixed,
  };
}
