import { aToken, Token } from '../../types';
import { Network } from '../../constants';

import { AaveToken } from './types';

export const Tokens: {
  [network: number]: { [dexKey: string]: { [symbol: string]: aToken } };
} = {};

export const TokensByAddress: {
  [network: number]: { [dexKey: string]: { [address: string]: aToken } };
} = {};

// return null if the pair does not exists otherwise return the aToken
export function getATokenIfAaveV3Pair(
  network: number,
  dexKey: string,
  src: Token,
  dst: Token,
): Token | null {
  const srcAddr = src.address.toLowerCase();
  const dstAddr = dst.address.toLowerCase();

  if (srcAddr === dstAddr) {
    return null;
  }

  const _src = TokensByAddress[network][dexKey][srcAddr];
  const _dst = TokensByAddress[network][dexKey][dstAddr];

  if (_src && _src.address.toLowerCase() == dstAddr) {
    return src;
  }

  if (_dst && _dst.address.toLowerCase() == srcAddr) {
    return dst;
  }

  return null;
}

export function getTokenFromASymbol(
  network: number,
  dexKey: string,
  symbol: string,
): Token | null {
  const aToken = Tokens[network][dexKey][symbol];

  if (!aToken) return null;

  return {
    address: aToken.aAddress,
    decimals: aToken.decimals,
    symbol: aToken.aSymbol,
  };
}

export function setTokensOnNetwork(
  network: Network,
  dexKey: string,
  tokens: AaveToken[],
) {
  if (Tokens[network] === undefined) {
    Tokens[network] = {};
  }
  if (Tokens[network][dexKey] === undefined) {
    Tokens[network][dexKey] = {};
  }
  if (TokensByAddress[network] === undefined) {
    TokensByAddress[network] = {};
  }
  if (TokensByAddress[network][dexKey] === undefined) {
    TokensByAddress[network][dexKey] = {};
  }

  for (let token of tokens) {
    token.address = token.address.toLowerCase();
    token.aAddress = token.aAddress.toLowerCase();
    Tokens[network][dexKey][token.aSymbol] = token;
    TokensByAddress[network][dexKey][token.aAddress] = token;
    TokensByAddress[network][dexKey][token.address] = token;
  }
}
