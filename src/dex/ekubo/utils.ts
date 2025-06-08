import { toBeHex, zeroPadValue } from 'ethers';
import { Token } from '../../types';
import { isETHAddress } from '../../utils';
import { ETHER_ADDRESS } from '../../constants';

export const NATIVE_TOKEN_ADDRESS = 0x0000000000000000000000000000000000000000n;

export function convertParaSwapToEkubo(address: string): bigint {
  return isETHAddress(address) ? NATIVE_TOKEN_ADDRESS : BigInt(address);
}

export function convertEkuboToParaSwap(address: bigint): string {
  return address === NATIVE_TOKEN_ADDRESS
    ? ETHER_ADDRESS
    : zeroPadValue(toBeHex(address), 20);
}

export function sortAndConvertTokens(
  tokenA: Token,
  tokenB: Token,
): [bigint, bigint] {
  const [a, b] = [
    convertParaSwapToEkubo(tokenA.address),
    convertParaSwapToEkubo(tokenB.address),
  ];
  return a > b ? [b, a] : [a, b];
}

export function hexStringTokenPair(token0: bigint, token1: bigint): string {
  return `${zeroPadValue(toBeHex(token0), 20)}/${zeroPadValue(
    toBeHex(token1),
    20,
  )}`;
}
