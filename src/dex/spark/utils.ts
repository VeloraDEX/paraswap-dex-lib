import { Contract } from 'web3-eth-contract';
import { SparkSDaiPoolState } from './types';
import { Interface, AbiCoder } from '@ethersproject/abi';

const coder = new AbiCoder();

// - `dsr` || `ssr`: the Dai Savings Rate or USDS savings rate
// - `chi`: the Rate Accumulator
// - `rho`: time of last drip
export async function getOnChainState(
  multiContract: Contract,
  potAddress: string,
  potInterface: Interface,
  savingsRateSymbol: 'dsr' | 'ssr' | 'ssrOracle',
  blockNumber: number | 'latest',
): Promise<SparkSDaiPoolState> {
  if (savingsRateSymbol === 'dsr') {
    return getOnChainStateSDAI(
      multiContract,
      potAddress,
      potInterface,
      blockNumber,
    );
  }

  if (savingsRateSymbol === 'ssrOracle') {
    return getOnChainStateUSDSOracle(
      multiContract,
      potAddress,
      potInterface,
      blockNumber,
    );
  }

  return getOnChainStateUSDS(
    multiContract,
    potAddress,
    potInterface,
    blockNumber,
  );
}

export async function getOnChainStateSDAI(
  multiContract: Contract,
  potAddress: string,
  potInterface: Interface,
  blockNumber: number | 'latest',
): Promise<SparkSDaiPoolState> {
  const calls = [
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('dsr', []),
    },
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('chi', []),
    },
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('rho', []),
    },
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('live', []),
    },
  ];

  const data: { returnData: any[] } = await multiContract.methods
    .aggregate(calls)
    .call({}, blockNumber);

  const [dsr, chi, rho, live] = data.returnData.map(item =>
    coder.decode(['uint256'], item)[0].toString(),
  );

  return {
    live: !!live,
    dsr,
    chi,
    rho,
  };
}

export async function getOnChainStateUSDSOracle(
  multiContract: Contract,
  potAddress: string,
  potInterface: Interface,
  blockNumber: number | 'latest',
): Promise<SparkSDaiPoolState> {
  const calls = [
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('getSUSDSData', []),
    },
  ];

  const data: { returnData: any[] } = await multiContract.methods
    .aggregate(calls)
    .call({}, blockNumber);

  const decoded = potInterface.decodeFunctionResult(
    'getSUSDSData',
    data.returnData[0],
  );

  return {
    // 'hack' - sUSDS doesn't have global shutdown and no notion of `live`, so it's always `live`
    live: true,
    dsr: decoded[0].ssr.toString(),
    chi: decoded[0].chi.toString(),
    rho: decoded[0].rho.toString(),
  };
}

export async function getOnChainStateUSDS(
  multiContract: Contract,
  potAddress: string,
  potInterface: Interface,
  blockNumber: number | 'latest',
): Promise<SparkSDaiPoolState> {
  const calls = [
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('ssr', []),
    },
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('chi', []),
    },
    {
      target: potAddress,
      callData: potInterface.encodeFunctionData('rho', []),
    },
  ];

  const data: { returnData: any[] } = await multiContract.methods
    .aggregate(calls)
    .call({}, blockNumber);

  const [dsr, chi, rho] = data.returnData.map(item =>
    coder.decode(['uint256'], item)[0].toString(),
  );

  return {
    // 'hack' - sUSDS doesn't have global shutdown and no notion of `live`, so it's always `live`
    live: true,
    dsr,
    chi,
    rho,
  };
}
