import { Address, Token } from '../../types';

export type VaultsStates = {
  [poolAddress: string]: VaultState;
};

export type VaultState = {
  totalSupply: bigint;
  capPrice: bigint;
  assetPrice: Record<Address, bigint>;
  assetSupply: Record<Address, bigint>;
  assetFeeConfig: Record<
    Address,
    {
      minMintFee: bigint;
      slope0: bigint;
      slope1: bigint;
      mintKinkRatio: bigint;
      optimalRatio: bigint;
      burnKinkRatio: bigint;
    }
  >;
};

export type VaultConfig = {
  // infra
  priceOracle: Address;
  // vault
  name: string;
  vault: Token;
  // todo: dynamic assets list?
  assets: Record<Address, Token>;
};

export type AllVaultConfigs = Record<Address, VaultConfig>;
