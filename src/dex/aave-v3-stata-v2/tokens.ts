import { Network } from '../../constants';
import { StataToken, TokenType } from './types';

export const Tokens: { [network: number]: { [symbol: string]: StataToken } } =
  {};

const TokensByAddress: {
  [network: number]: { [address: string]: StataToken };
} = {};

export function setTokensOnNetwork(network: Network, tokens: StataToken[]) {
  if (Tokens[network] === undefined) {
    Tokens[network] = {};
  }

  if (TokensByAddress[network] === undefined) {
    TokensByAddress[network] = {};
  }

  for (let token of tokens) {
    token.address = token.address.toLowerCase();
    token.underlying = token.underlying.toLowerCase();
    token.underlyingAToken = token.underlyingAToken.toLowerCase();

    Tokens[network][token.stataSymbol] = token;
    TokensByAddress[network][token.address] = token;
    TokensByAddress[network][token.underlying] = token;
    TokensByAddress[network][token.underlyingAToken] = token;
  }
}

export function getTokenType(network: Network, address: string): TokenType {
  const addressLower = address.toLowerCase();
  const token = TokensByAddress[network]?.[addressLower];

  if (!token) return TokenType.UNKNOWN;
  if (token.address === addressLower) return TokenType.STATA_TOKEN;
  if (token.underlying === addressLower) return TokenType.UNDERLYING;
  if (token.underlyingAToken === addressLower) return TokenType.A_TOKEN;
  return TokenType.UNKNOWN;
}

export function getTokenFromAddress(
  network: Network,
  address: string,
): StataToken {
  return TokensByAddress[network]?.[address.toLowerCase()];
}
