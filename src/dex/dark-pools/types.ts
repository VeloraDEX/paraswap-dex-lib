import { Address } from '../../types';

export type DarkPoolsTokenConfig = {
  address: Address;
  poolAddress: Address;
  decimals: number;
  symbol: string;
};

export type DarkPoolsPoolConfig = {
  address: Address;
  tokenX: DarkPoolsTokenConfig;
  tokenY: DarkPoolsTokenConfig;
};

export type DexParams = {
  pools: DarkPoolsPoolConfig[];
};

export type DarkPoolsData = {
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  isXToY: boolean;
};

export type DarkPoolsPoolState = {
  anchorPrice: bigint;
  feeAskX24: number;
  feeBidX24: number;
  latestUpdateBlock: number;
  reserveX: bigint;
  reserveY: bigint;
  concentrationK: number;
  blockDelay: number;
  blacklistFeeMultiplier: bigint;
  paused: boolean;
};

export type DarkPoolsQuoteResult = {
  amountOut: bigint;
  sqrtPriceNext: bigint;
  fee: bigint;
};
