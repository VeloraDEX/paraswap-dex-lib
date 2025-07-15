import { aToken, Token } from '../../types';
import { Network } from '../../constants';
import tokens from './tokenlist.json';
import { aaveLendingPool } from './config';

function getTokensForPool(pool: string): aToken[] {
  return tokens
    .filter(
      token =>
        token.extensions?.pool &&
        token.extensions?.pool.toLowerCase() === pool.toLowerCase(),
    )
    .map(token => ({
      aSymbol: token.symbol,
      aAddress: token.address.toLowerCase(),
      // the type is a bit imprecise, when tag is aTokenV2, underlying will exist
      address: token.extensions!.underlying.toLowerCase(),
      decimals: token.decimals,
    }));
}

export const Tokens: { [network: number]: { [symbol: string]: aToken } } = {};
const TokensByAddress: { [network: number]: { [address: string]: aToken } } =
  {};

const tokensByNetwork: { [network: number]: any } = {
  [Network.MAINNET]: getTokensForPool(aaveLendingPool[Network.MAINNET]),
  [Network.POLYGON]: getTokensForPool(aaveLendingPool[Network.POLYGON]),
  [Network.AVALANCHE]: getTokensForPool(aaveLendingPool[Network.AVALANCHE]),
};

for (const [key, tokens] of Object.entries(tokensByNetwork)) {
  const network = +key;
  Tokens[network] = {};
  TokensByAddress[network] = {};
  for (const token of tokens) {
    Tokens[network][token.aSymbol] = token;
    TokensByAddress[network][token.aAddress.toLowerCase()] = token;
  }
}

// return null if pair does not exists otherwise return the aToken
export function isAaveV2Pair(
  network: number,
  src: Token,
  dst: Token,
): Token | null {
  const srcAddr = src.address.toLowerCase();
  const dstAddr = dst.address.toLowerCase();

  const _src = TokensByAddress[network][srcAddr];
  const _dst = TokensByAddress[network][dstAddr];

  if (_src && _src.address == dstAddr) {
    return src;
  }

  if (_dst && _dst.address == srcAddr) {
    return dst;
  }

  return null;
}

export function aaveV2GetToken(network: number, symbol: string): Token | null {
  const aToken = Tokens[network][symbol];
  if (!aToken) {
    return null;
  }

  return {
    address: aToken.aAddress,
    decimals: aToken.decimals,
    symbol: aToken.aSymbol,
  };
}
