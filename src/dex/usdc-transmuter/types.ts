import { Address } from '../../types';

export type PoolState = {
  balance: bigint; // transmuter USDC token balance
};

export type UsdcTransmuterData = null;

export type DexParams = {
  usdcTransmuterAddress: Address;
  usdcToken: {
    address: Address;
    decimals: number;
  };
  usdceToken: {
    address: Address;
    decimals: number;
  };
};

export enum UsdcTransmuterFunctions {
  deposit = 'deposit',
  withdraw = 'withdraw',
}
