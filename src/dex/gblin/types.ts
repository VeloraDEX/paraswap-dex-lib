import { Address } from '../../types';

// The minimum the mint price depends on. `navEth` and `supply` move only on vault or
// price-feed events; the management fee accrues with time and is applied at pricing.
export type GblinPoolState = {
  // shares outstanding before the management fee that the next mint accrues
  supply: bigint;
  // net asset value in wei of ETH, stray ETH held by the vault included
  navEth: bigint;
  // timestamp of the last management-fee accrual
  lastAccrual: bigint;
  managementFeeBps: bigint;
  protocolFeeBps: bigint;
  stabilityFeeBps: bigint;
  // false while a price feed is stale, a basket token does not answer or a fill is open;
  // the vault refuses to mint then
  navReliable: boolean;
  // timestamp of the block the state was read at; used as the accrual time
  timestamp: bigint;
};

export type GblinData = {
  exchange: Address;
};

export type DexParams = {
  vault: Address;
  lens: Address;
  weth: Address;
  // Chainlink aggregators (not the proxies) whose AnswerUpdated events move the NAV
  feedAggregators: Address[];
};
