import { Provider } from '@ethersproject/providers';
import { hexlify, hexZeroPad, Interface } from 'ethers/lib/utils';
import { Contract } from 'ethers';
import { ETHER_ADDRESS } from '../../constants';
import { Token } from '../../types';
import { isETHAddress } from '../../utils';
import { EkuboContracts } from './types';

import CoreABI from '../../abi/ekubo-v3/core.json';
import QuoteDataFetcherABI from '../../abi/ekubo-v3/quote-data-fetcher.json';
import TwammDataFetcherABI from '../../abi/ekubo-v3/twamm-data-fetcher.json';
import TwammABI from '../../abi/ekubo-v3/twamm.json';
import {
  CORE_ADDRESS,
  QUOTE_DATA_FETCHER_ADDRESS,
  TWAMM_ADDRESS,
  TWAMM_DATA_FETCHER_ADDRESS,
} from './config';

export const NATIVE_TOKEN_ADDRESS = 0x0000000000000000000000000000000000000000n;

export function convertParaSwapToEkubo(address: string): bigint {
  return isETHAddress(address) ? NATIVE_TOKEN_ADDRESS : BigInt(address);
}

export function convertEkuboToParaSwap(address: bigint): string {
  return address === NATIVE_TOKEN_ADDRESS
    ? ETHER_ADDRESS
    : hexZeroPad(hexlify(address), 20);
}

export function convertAndSortTokens(
  tokenA: Token,
  tokenB: Token,
): [bigint, bigint] {
  const [a, b] = [
    convertParaSwapToEkubo(tokenA.address),
    convertParaSwapToEkubo(tokenB.address),
  ];
  return a > b ? [b, a] : [a, b];
}

export function ekuboContracts(provider: Provider): EkuboContracts {
  return {
    core: {
      contract: new Contract(CORE_ADDRESS, CoreABI, provider),
      interface: new Interface(CoreABI),
      quoteDataFetcher: new Contract(
        QUOTE_DATA_FETCHER_ADDRESS,
        QuoteDataFetcherABI,
        provider,
      ),
    },
    twamm: {
      contract: new Contract(TWAMM_ADDRESS, TwammABI, provider),
      interface: new Interface(TwammABI),
      quoteDataFetcher: new Contract(
        TWAMM_DATA_FETCHER_ADDRESS,
        TwammDataFetcherABI,
        provider,
      ),
    },
  };
}

export const bigintMax = (a: bigint, b: bigint): bigint => (a > b ? a : b);

export const bigintMin = (a: bigint, b: bigint): bigint => (a < b ? a : b);
