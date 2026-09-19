import { Address } from '../../types';

// Returned by getPricesVolume, consumed by getDexParam. Keep minimal.
export type FlowStateData = {
  pool: Address; // the C1 pool clone to buy from
  resellerCode: string; // Velora fee-attribution code (may be '')
  rate: string; // 1inch weiPerToken at quote time; getDexParam re-derives the exact token `amount` from srcAmount so it matches the contract's checkAmounts band
};

export type DexParams = {
  router: Address; // FlowState contract exposing buyFromPool (0x93B7C8… today)
  oracle: Address; // 1inch spot aggregator used on-chain to price the fill
  graphqlURL: string; // Hasura endpoint for pool discovery
  resellerCode: string; // '' = no reseller (safe default until Velora code is registered on-chain)
};
