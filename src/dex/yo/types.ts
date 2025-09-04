import { Address } from '../../types';

export type YoData = {
  exchange: Address;
  state: {
    totalShares: string;
    totalAssets: string;
  };
};

export type DexParams = {
  vault: string;
  asset: string;
  decimals: number;
};
