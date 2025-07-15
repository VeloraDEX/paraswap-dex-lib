import { Interface } from '@ethersproject/abi';
import { Address } from '../../types';

export type SkyConverterData = null;

export type DexParams = {
  converterAddress: Address;
  oldTokenAddress: Address;
  newTokenAddress: Address;
  newTokenRateMultiplier: bigint;
  oldToNewFunctionName: string;
  newToOldFunctionName?: string;
  converterIface: Interface;
};
