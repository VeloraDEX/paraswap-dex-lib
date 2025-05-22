import { aToken, Token } from '../../types';
import { Network } from '../../constants';

import { AaveToken } from './types';

export const Tokens: { [network: number]: { [symbol: string]: aToken } } = {};

export const TokensByAddress: {
  [network: number]: { [address: string]: aToken };
} = {};

// return null if the pair does not exists otherwise return the aToken
export function getATokenIfAaveV3Pair(
  network: number,
  src: Token,
  dst: Token,
): Token | null {
  const srcAddr = src.address.toLowerCase();
  const dstAddr = dst.address.toLowerCase();

  if (srcAddr === dstAddr) {
    return null;
  }

  const _src = TokensByAddress[network][srcAddr];
  const _dst = TokensByAddress[network][dstAddr];

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
  symbol: string,
): Token | null {
  const aToken = Tokens[network][symbol];

  if (!aToken) return null;

  return {
    address: aToken.aAddress,
    decimals: aToken.decimals,
    symbol: aToken.aSymbol,
  };
}

export function setTokensOnNetwork(network: Network, tokens: AaveToken[]) {
  if (Tokens[network] === undefined) {
    Tokens[network] = {};
  }
  if (TokensByAddress[network] === undefined) {
    TokensByAddress[network] = {};
  }

  for (let token of tokens) {
    token.address = token.address.toLowerCase();
    token.aAddress = token.aAddress.toLowerCase();
    Tokens[network][token.aSymbol] = token;
    TokensByAddress[network][token.aAddress] = token;
    TokensByAddress[network][token.address] = token;
  }
}
