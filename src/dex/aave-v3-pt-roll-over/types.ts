import { Address } from '../../types';
import { BigNumber } from 'ethers';

export type AaveV3PtRollOverData = {};

export type DexParams = {
  pendleRouterAddress: Address;
  oldPtAddress: { address: Address; decimals: number };
  newPtAddress: { address: Address; decimals: number };
  oldMarketAddress: Address;
  newMarketAddress: Address;
  oracleAddress: Address;
  decimals: number;
};
