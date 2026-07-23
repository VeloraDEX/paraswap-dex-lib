import { Address, Token } from '../../types';
import { ETHER_ADDRESS, NULL_ADDRESS } from '../../constants';
import { Network } from '../../constants';
import { STABLE_COINS } from './stable-coins';

export const getIdentifierPrefix = (
  dexKey: string,
  tokenA: Address,
  tokenB: Address,
) => {
  return `${dexKey}_${getPairName(tokenA, tokenB)}`.toLowerCase();
};

export const getPairName = (tokenA: Address, tokenB: Address) => {
  const sortedAddresses = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
  return `${sortedAddresses[0]}_${sortedAddresses[1]}`.toLowerCase();
};

export const getPoolIdentifier = (
  dexKey: string,
  tokenA: Address,
  tokenB: Address,
) => {
  return `${getIdentifierPrefix(dexKey, tokenA, tokenB)}`.toLowerCase();
};

export const normalizeTokenAddress = (address: string): string => {
  return address.toLowerCase() === ETHER_ADDRESS.toLowerCase()
    ? NULL_ADDRESS
    : address.toLowerCase();
};

export const denormalizeTokenAddress = (address: string): string => {
  return address.toLowerCase() === NULL_ADDRESS
    ? ETHER_ADDRESS
    : address.toLowerCase();
};

export const isStablePair = (
  network: Network,
  normalizedSrcTokenAddress: string,
  normalizedDestTokenAddress: string,
): boolean => {
  const networkStableCoins = STABLE_COINS[network];
  if (networkStableCoins === undefined) {
    return false;
  }
  return (
    networkStableCoins[normalizedSrcTokenAddress] === true &&
    networkStableCoins[normalizedDestTokenAddress] === true
  );
};
