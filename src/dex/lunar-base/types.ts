import { Address } from '../../types';

export type LunarBaseTokenConfig = {
  address: Address;
  poolAddress: Address;
  decimals: number;
  symbol: string;
};

export type LunarBasePoolConfig = {
  address: Address;
  tokenX: LunarBaseTokenConfig;
  tokenY: LunarBaseTokenConfig;
};

export type DexParams = {
  pools: LunarBasePoolConfig[];
};

export type LunarBaseData = {
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  isXToY: boolean;
};

export type LunarBasePoolState = {
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

export type LunarBaseQuoteResult = {
  amountOut: bigint;
  sqrtPriceNext: bigint;
  fee: bigint;
};
