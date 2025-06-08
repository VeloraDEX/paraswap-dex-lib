import { BytesLike, AbiCoder, Interface } from 'ethers';
import {
  extractSuccessAndValue,
  stringDecode,
  uint8ToNumber,
} from '../../lib/decoders';
import {
  MultiCallParams,
  MultiResult,
  MultiWrapper,
} from '../../lib/multi-wrapper';
import Web3 from 'web3';
import POOL_ABI from '../../abi/AaveV3_lending_pool.json';
import { AaveToken } from './types';

export const decodeATokenFromReserveData = (
  result: MultiResult<BytesLike> | BytesLike,
): string => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    throw new Error(
      'Could not extract value from struct DataTypes.ReserveData.',
    );
  }

  const decoded = AbiCoder.defaultAbiCoder().decode(
    [
      'tuple(uint256) configuration',
      'uint128 liquidityIndex',
      'uint128 currentLiquidityRate',
      'uint128 variableBorrowIndex',
      'uint128 currentVariableBorrowRate',
      'uint128 currentStableBorrowRate',
      'uint40 lastUpdateTimestamp',
      'uint16 id',
      'address aTokenAddress',
      'address stableDebtTokenAddress',
      'address variableDebtTokenAddress',
      'address interestRateStrategyAddress',
      'uint128 accruedToTreasury',
      'uint128 unbacked',
      'uint128 isolationModeTotalDebt',
    ],
    toDecode,
  );

  return decoded.aTokenAddress.toLowerCase();
};

async function _getAllTokenMetadata(
  reservesList: string[],
  poolAddress: string,
  poolInterface: Interface,
  erc20Interface: Interface,
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<
  {
    address: string;
    aAddress: string;
    decimals: number;
  }[]
> {
  let calls: MultiCallParams<any>[] = [];

  for (const tokenAddress of reservesList) {
    calls.push({
      target: poolAddress,
      callData: poolInterface.encodeFunctionData('getReserveData', [
        tokenAddress,
      ]),
      decodeFunction: decodeATokenFromReserveData,
    });
  }
  for (const proxyAddress of reservesList) {
    calls.push({
      target: proxyAddress,
      callData: erc20Interface.encodeFunctionData('decimals'),
      decodeFunction: uint8ToNumber,
    });
  }

  const results = await multiWrapper.aggregate<string | number>(
    calls,
    blockNumber,
  );

  let tokenList = reservesList.map((tokenAddress: string, i: number) => ({
    address: tokenAddress as string,
    aAddress: results[i] as string,
    decimals: results[reservesList.length + i] as number,
  }));

  return tokenList;
}

async function _getATokenSymbols(
  aTokens: string[],
  erc20Interface: Interface,
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<{ aSymbol: string }[]> {
  let calls: MultiCallParams<any>[] = [];

  for (const proxyAddress of aTokens) {
    calls.push({
      target: proxyAddress,
      callData: erc20Interface.encodeFunctionData('symbol', []),
      decodeFunction: stringDecode,
    });
  }
  const results = await multiWrapper.aggregate<string>(calls, blockNumber);

  return results.map(item => ({ aSymbol: item }));
}

export const fetchTokenList = async (
  web3Provider: Web3,
  poolAddress: string,
  poolInterface: Interface,
  erc20Interface: Interface,
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<AaveToken[]> => {
  let poolContract = new web3Provider.eth.Contract(
    POOL_ABI as any,
    poolAddress,
  );
  let reservesList = await poolContract.methods.getReservesList().call();

  let tokenMetadataList = await _getAllTokenMetadata(
    reservesList,
    poolAddress,
    poolInterface,
    erc20Interface,
    multiWrapper,
    blockNumber,
  );
  let aTokenSymbolsList = await _getATokenSymbols(
    tokenMetadataList.map(metadata => metadata.aAddress),
    erc20Interface,
    multiWrapper,
    blockNumber,
  );
  let tokenList = tokenMetadataList.map((metadata, i: number) => ({
    ...metadata,
    ...aTokenSymbolsList[i],
  }));

  return tokenList;
};
