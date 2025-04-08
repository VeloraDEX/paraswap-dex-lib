import { Address } from '../../types';

export type PoolState = {
  // Since the exchange rate is always 1:1, we don't need to track any state
  // This is just a placeholder
  initialized: boolean;
};

export type UsdcTransmuterData = {
  // TODO: UsdcTransmuterData is the dex data that is
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  // Complete me!
  exchange: Address;
};

export type DexParams = {
  // TODO: DexParams is set of parameters the can
  // be used to initiate a DEX fork.
  // Complete me!
  address: Address;
};
