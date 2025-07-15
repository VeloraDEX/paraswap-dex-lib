// import {
//   IStaticATokenFactory_ABI,
//   IStaticATokenLM_ABI,
// } from '@bgd-labs/aave-address-book';
import { Interface } from '@ethersproject/abi';
import Web3 from 'web3';
import { MultiCallParams, MultiWrapper } from '../../lib/multi-wrapper';
import { stringDecode, uint8ToNumber, addressDecode } from '../../lib/decoders';
import { StataToken, DexParams } from './types';
import FactoryABI from '../../abi/aavev3statav2/Factory.json';
import TokenABI from '../../abi/aavev3statav2/Token.json';
import { AbiItem } from 'web3-utils';

type PoolAndToken = {
  token: string;
  pool: string;
};

// const stataInterface = new Interface(IStaticATokenLM_ABI);
const statav2Interface = new Interface(TokenABI);

async function getTokenMetaData(
  stataTokens: PoolAndToken[],
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<StataToken[]> {
  const calls: MultiCallParams<any>[] = stataTokens
    .map(({ token }) => {
      return [
        {
          target: token,
          callData: statav2Interface.encodeFunctionData('symbol'),
          decodeFunction: stringDecode,
        },
        {
          target: token,
          callData: statav2Interface.encodeFunctionData('decimals'),
          decodeFunction: uint8ToNumber,
        },
        {
          target: token,
          callData: statav2Interface.encodeFunctionData('asset'),
          decodeFunction: addressDecode,
        },
        {
          target: token,
          callData: statav2Interface.encodeFunctionData('aToken'),
          decodeFunction: addressDecode,
        },
      ];
    })
    .flat();

  const results = await multiWrapper.aggregate<string | number>(
    calls,
    blockNumber,
  );

  let tokenList: StataToken[] = [];
  for (let i = 0, x = 0; i < stataTokens.length; ++i, x += 4) {
    tokenList.push({
      address: stataTokens[i].token.toLowerCase(),
      pool: stataTokens[i].pool.toLowerCase(),
      stataSymbol: results[x] as string,
      decimals: results[x + 1] as number,
      underlying: (results[x + 2] as string).toLowerCase(),
      underlyingAToken: (results[x + 3] as string).toLowerCase(),
    });
  }
  return tokenList;
}

export const fetchTokenList = async (
  web3Provider: Web3,
  config: DexParams,
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<StataToken[]> => {
  let stataList: PoolAndToken[] = (
    (await Promise.all(
      config.map(async ({ factory, pool }) => {
        let factoryContract = new web3Provider.eth.Contract(
          FactoryABI as AbiItem[],
          // IStaticATokenFactory_ABI as any,
          factory,
        );

        return (
          (await factoryContract.methods.getStataTokens().call()) as string[]
        ).map(address => ({ token: address, pool }));
      }),
    )) as PoolAndToken[][]
  ).flat();

  return getTokenMetaData(stataList, multiWrapper, blockNumber);
};
