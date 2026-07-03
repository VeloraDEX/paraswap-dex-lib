import { Address } from '../../types';

export type PoolState = {
  // WAD (1e18) tGBP-per-wstGBP prices read off the wrapper.
  mintcost: bigint; // ask: a buy of wstGBP executes at this price
  burncost: bigint; // bid: a sell of wstGBP executes at this price
  // Depth caps.
  capacity: bigint; // max wstGBP total supply (buys revert past it)
  totalSupply: bigint; // current wstGBP supply
  tGBPReserve: bigint; // wrapper's tGBP balance (sells pay out of this)
  // Availability gates.
  mintable: boolean;
  burnable: boolean;
  cooldown: bigint; // must be 0 for atomic sells
};

export type WstGBPData = {};

export type DexParams = {
  // The swap venue: WsgemDirectAdapter (approve -> swap, direction inferred from tokenIn).
  adapterAddress: Address;
  // The wrapper token itself — also the pricing/gating read target.
  wstGBPAddress: Address;
  // The wrapper's underlying.
  tGBPAddress: Address;
};
