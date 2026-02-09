import { Address } from '../../types';

export type ERC4626PoolState = {
  totalShares: bigint;
  totalAssets: bigint;
  cooldownDuration?: bigint; // only for sUSDe
};

export type ERC4626Data = {
  exchange: string;
  state: {
    totalShares: string;
    totalAssets: string;
  };
};

export enum ERC4626Functions {
  deposit = 'deposit',
  redeem = 'redeem',
  withdraw = 'withdraw',
  mint = 'mint',
}

export type ERC4626Params = {
  vault: Address;
  asset: Address;
  cooldownEnabled?: boolean; // only for sUSDe
  decimals?: number; // for assets with non-18 decimals
  withdrawDisabled?: boolean; // for vaults that that do not support withdraw (yoETH, yoUSD)
};
