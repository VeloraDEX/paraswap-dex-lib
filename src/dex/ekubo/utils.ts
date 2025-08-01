import { Provider } from '@ethersproject/providers';
import { hexlify, hexZeroPad, Interface } from 'ethers/lib/utils';
import { Contract } from 'ethers';
import { ETHER_ADDRESS } from '../../constants';
import { Token } from '../../types';
import { isETHAddress } from '../../utils';
import { DexParams, EkuboContracts } from './types';

import CoreABI from '../../abi/ekubo/core.json';
import DataFetcherABI from '../../abi/ekubo/data-fetcher.json';
import TwammDataFetcherABI from '../../abi/ekubo/twamm-data-fetcher.json';
import TwammABI from '../../abi/ekubo/twamm.json';

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

export function hexStringTokenPair(token0: bigint, token1: bigint): string {
  return `${hexZeroPad(hexlify(token0), 20)}/${hexZeroPad(
    hexlify(token1),
    20,
  )}`;
}

export function contractsFromDexParams(
  params: DexParams,
  provider: Provider,
): EkuboContracts {
  return {
    core: {
      contract: new Contract(params.core, CoreABI, provider),
      interface: new Interface(CoreABI),
      dataFetcher: new Contract(params.dataFetcher, DataFetcherABI, provider),
    },
    twamm: {
      contract: new Contract(params.twamm, TwammABI, provider),
      interface: new Interface(TwammABI),
      dataFetcher: new Contract(
        params.twammDataFetcher,
        TwammDataFetcherABI,
        provider,
      ),
    },
  };
}
