import { BytesLike } from 'ethers';
import { NumberAsString } from '../../types';
import { Address } from '../../types';
import { AbiItem } from 'web3-utils';
import { MultiResult } from '../../lib/multi-wrapper';

export type FactoryState = Record<string, never>;

export type TickInfo = {
  liquidityGross: bigint;
  liquidityNet: bigint;
  initialized: boolean;
};

export type Slot0 = {
  sqrtPriceX96: bigint;
  tick: bigint;
  fee: bigint;
};

export type PoolState = {
  pool: string;
  blockTimestamp: bigint;
  tickSpacing: bigint;
  slot0: Slot0;
  liquidity: bigint;
  maxLiquidityPerTick: bigint;
  tickBitmap: Record<NumberAsString, bigint>;
  ticks: Record<NumberAsString, TickInfo>;
  isValid: boolean;
  startTickBitmap: bigint;
  lowestKnownTick: bigint;
  highestKnownTick: bigint;
  balance0: bigint;
  balance1: bigint;
};

export type SolidlyV3Data = {
  zeroForOne: boolean;
  poolAddress: string;
  isApproved?: boolean;
};

export type DecodeStateMultiCallFunc = (
  result: MultiResult<BytesLike> | BytesLike,
) => DecodedStateMultiCallResultWithRelativeBitmaps;

export type DexParams = {
  factory: Address;
  stateMulticall: Address;
  supportedTickSpacings: bigint[];
  chunksCount: number;
  initRetryFrequency: number;
  deployer?: Address;
  subgraphURL: string;
  initHash: string;
  stateMultiCallAbi?: AbiItem[];
  decodeStateMultiCallResultWithRelativeBitmaps?: DecodeStateMultiCallFunc;
};

export type UniswapV3SimpleSwapSellParam = {
  path: string;
  recipient: Address;
  deadline: string;
  amountIn: NumberAsString;
  amountOutMinimum: NumberAsString;
};

export type UniswapV3SimpleSwapBuyParam = {
  path: string;
  recipient: Address;
  deadline: string;
  amountOut: NumberAsString;
  amountInMaximum: NumberAsString;
};

export type UniswapV3SimpleSwapParams =
  | UniswapV3SimpleSwapSellParam
  | UniswapV3SimpleSwapBuyParam;

export type SolidlyV3SimpleSwapParams = {
  recipient: string;
  zeroForOne: boolean;
  amountSpecified: NumberAsString;
  sqrtPriceLimitX96: NumberAsString;
};

export type UniswapV3Param = [
  fromToken: Address,
  toToken: Address,
  exchange: Address,
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  expectedAmount: NumberAsString,
  feePercent: NumberAsString,
  deadline: NumberAsString,
  partner: Address,
  isApproved: boolean,
  beneficiary: Address,
  path: string,
  permit: string,
  uuid: string,
];

export enum UniswapV3Functions {
  exactInput = 'exactInput',
  exactOutput = 'exactOutput',
}

export type TickInfoMappings = {
  index: number;
  value: TickInfo;
};

export type TickBitMapMappings = {
  index: number;
  value: bigint;
};

export type OutputResult = {
  outputs: bigint[];
  tickCounts: number[];
};

// Just rewrote every type with BigNumber basically

export type DecodedStateMultiCallResultWithRelativeBitmaps = {
  pool: Address;
  blockTimestamp: bigint;
  slot0: {
    sqrtPriceX96: bigint;
    tick: number;
    fee: number;
    unlocked: boolean;
  };
  liquidity: bigint;
  tickSpacing: number;
  maxLiquidityPerTick: bigint;
  tickBitmap: TickBitMapMappings[];
  ticks: TickInfoMappings[];
};
