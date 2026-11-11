import { Token } from '../../types';

export type DexParams = {
  factory: string;
  deploymentBlock: number;
  excludedPools?: string[];
};

export type PoolConfig = {
  address: string;
  tokens: [string, string];
  weights: [bigint, bigint];
};

export type TokenState = Token & {
  assimilator: string;
  proxy: string;
  aggregator: string;
  oracleDecimals: number;
  balance: bigint;
  answer: bigint;
  updatedAt: bigint;
};

export type CurveParameters = {
  alpha: bigint;
  beta: bigint;
  delta: bigint;
  epsilon: bigint;
  lambda: bigint;
};

export type PoolState = {
  tokens: [TokenState, TokenState];
  parameters: CurveParameters;
  weights: [bigint, bigint];
  frozen: boolean;
  emergency: boolean;
  globallyFrozen: boolean;
};

export type StabullData = { pool: string };
