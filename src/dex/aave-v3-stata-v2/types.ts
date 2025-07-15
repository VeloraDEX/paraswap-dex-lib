import { Address } from '../../types';

export enum TokenType {
  UNDERLYING,
  A_TOKEN,
  STATA_TOKEN,
  UNKNOWN,
}

export type DexParams = {
  factory: string;
  pool: string;
}[];

export type AaveV3StataV2Data = {
  exchange: Address;
  srcType: TokenType;
  destType: TokenType;
};

export type StataToken = {
  address: string;
  underlying: string;
  underlyingAToken: string;
  stataSymbol: string;
  decimals: number;
  pool: string;
};

export enum StataFunctions {
  deposit = 'deposit',
  depositATokens = 'depositATokens',
  redeem = 'redeem',
  redeemATokens = 'redeemATokens',
  mint = 'mint',
  withdraw = 'withdraw',
}

export enum Rounding {
  UP = 'UP',
  DOWN = 'DOWN',
}
