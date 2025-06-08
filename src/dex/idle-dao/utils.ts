import { endpoints } from './config';
import { BytesLike, Interface } from 'ethers';
import { stringDecode, addressDecode, uint8ToNumber } from '../../lib/decoders';
import {
  MultiCallParams,
  MultiResult,
  MultiWrapper,
} from '../../lib/multi-wrapper';
import { IdleToken, TrancheToken } from './types';
import axios from 'axios';
import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { TOKEN_LISTS } from './token_list';

async function _getIdleTokenSymbols(
  idleTokens: string[],
  erc20Interface: Interface,
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<any> {
  let calls: MultiCallParams<any>[] = [];

  for (const idleAddress of idleTokens) {
    calls.push({
      target: idleAddress,
      callData: erc20Interface.encodeFunctionData('symbol', []),
      decodeFunction: (result: MultiResult<BytesLike> | BytesLike): any => {
        return {
          idleAddress,
          idleSymbol: stringDecode(result),
        };
      },
    });
  }
  const results = await multiWrapper.aggregate<any>(calls, blockNumber);

  return results.reduce((output, item) => {
    return {
      ...output,
      [item.idleAddress]: item.idleSymbol,
    };
  }, {});
}

async function _getIdleTokenDecimals(
  underlyingTokens: string[],
  erc20Interface: Interface,
  multiWrapper: MultiWrapper,
  blockNumber?: number,
): Promise<any> {
  let calls: MultiCallParams<any>[] = [];

  for (const address of underlyingTokens) {
    calls.push({
      target: address,
      callData: erc20Interface.encodeFunctionData('decimals', []),
      decodeFunction: (result: MultiResult<BytesLike> | BytesLike): any => {
        return {
          address,
          decimals: uint8ToNumber(result),
        };
      },
    });
  }
  const results = await multiWrapper.aggregate<any>(calls, blockNumber);

  return results.reduce((output, item) => {
    return {
      ...output,
      [item.address]: item.decimals,
    };
  }, {});
}

const getDataWithAuth = async (
  endpoint: string,
  token: string,
  error_callback?: Function,
) => {
  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };

  const data = await axios.post(endpoint, {}, config).catch(err => {
    if (typeof error_callback === 'function') {
      error_callback(err);
    }
  });
  return data?.data;
};

export const fetchTokenList_api = async (
  network: Network,
  dexHelper: IDexHelper,
  cdoInterface: Interface,
  erc20Interface: Interface,
  multiWrapper: MultiWrapper,
  token: string,
  blockNumber?: number,
): Promise<IdleToken[]> => {
  const data = await getDataWithAuth(endpoints[network], token);

  // Fetch tokenslist from static file
  if (!data) {
    return TOKEN_LISTS[network];
  }

  const deployedContract = data
    .filter((d: any) => !!d.cdoAddress)
    .reduce((acc: any[], d: any) => {
      if (acc.includes(d.cdoAddress)) return acc;
      return [...acc, d.cdoAddress];
    }, []);

  const calls = deployedContract.reduce(
    (calls: MultiCallParams<any>[], cdoAddress: string) => {
      calls.push({
        target: cdoAddress,
        callData: cdoInterface.encodeFunctionData('AATranche', []),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): TrancheToken => {
          return {
            cdoAddress,
            tokenType: 'AA',
            idleAddress: addressDecode(result),
          };
        },
      });

      calls.push({
        target: cdoAddress,
        callData: cdoInterface.encodeFunctionData('BBTranche', []),
        decodeFunction: (
          result: MultiResult<BytesLike> | BytesLike,
        ): TrancheToken => {
          return {
            cdoAddress,
            tokenType: 'BB',
            idleAddress: addressDecode(result),
          };
        },
      });

      calls.push({
        target: cdoAddress,
        callData: cdoInterface.encodeFunctionData('token', []),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike): any => {
          return {
            cdoAddress,
            address: addressDecode(result),
          };
        },
      });

      return calls;
    },
    [],
  );

  const results = await multiWrapper.aggregate<Record<string, string>>(
    calls,
    blockNumber,
  );

  const cdosUnderlying: Record<string, string> = results.reduce(
    (cdosUnderlying, result: any) => {
      if (!result.address) return cdosUnderlying;
      return {
        ...cdosUnderlying,
        [result.cdoAddress]: result.address,
      };
    },
    {},
  );

  const idleTokenSymbolsList = await _getIdleTokenSymbols(
    results
      .filter(result => !!result.tokenType)
      .map(result => result.idleAddress),
    erc20Interface,
    multiWrapper,
    blockNumber,
  );

  const idleTokenDecimals = await _getIdleTokenDecimals(
    results.filter(result => !result.tokenType).map(result => result.address),
    erc20Interface,
    multiWrapper,
    blockNumber,
  );

  const output: IdleToken[] = [];
  for (const result of results) {
    if (result.tokenType) {
      const idleToken: IdleToken = {
        blockNumber: 0,
        idleDecimals: 18,
        cdoAddress: result.cdoAddress,
        idleAddress: result.idleAddress,
        address: cdosUnderlying[result.cdoAddress],
        idleSymbol: idleTokenSymbolsList[result.idleAddress],
        tokenType: result.tokenType as IdleToken['tokenType'],
        decimals: idleTokenDecimals[cdosUnderlying[result.cdoAddress]],
      };
      output.push(idleToken);
    }
  }

  return output;
};
