import { Interface } from 'ethers/lib/utils';
import { Address, Token } from '../../types';

export type PoolState = {
  // fetched from WooPPV2.tokenInfos(address baseToken) :
  // https://arbiscan.io/address/0x8693F9701D6DB361Fe9CC15Bc455Ef4366E39AE0
  tokenInfos: Record<Address, TokenInfo>;

  // fetched from WooracleV2.state(address baseToken)
  // https://arbiscan.io/address/0x962d37fb9d75fe1af9aab323727183e4eae1322d
  tokenStates: Record<Address, TokenState>;

  // fetched from WooPPV2.decimalInfo(address baseToken)
  // https://arbiscan.io/address/0x8693F9701D6DB361Fe9CC15Bc455Ef4366E39AE0
  decimals: Record<Address, DecimalInfo>;
  oracleTimestamp: bigint;
  isPaused: boolean;
};

export type WooFiV2Data = {};

export type DexParams = {
  wooPPV2Address: Address;
  wooOracleV2Address: Address;
  integrationHelperAddress: Address;
  quoteToken: Token;
};

export type TokenInfo = {
  reserve: bigint;
  feeRate: bigint;
  maxGamma: bigint;
  maxNotionalSwap: bigint;
  capBal: bigint;
};

export type TokenState = {
  price: bigint;
  spread: bigint;
  coeff: bigint;
  woFeasible: boolean;
};

export type DecimalInfo = {
  priceDec: bigint;
  quoteDec: bigint;
  baseDec: bigint;
};

export type LatestRoundData = {
  answer: bigint;
};

export type MulticallResultOutputs =
  | boolean
  | bigint
  | TokenInfo
  | DecimalInfo
  | TokenState;

export type WooFiV2Interfaces = {
  PPV2: Interface;
  oracleV2: Interface;
  integrationHelper: Interface;
  chainlink: Interface;
  erc20BalanceOf: Interface;
};
