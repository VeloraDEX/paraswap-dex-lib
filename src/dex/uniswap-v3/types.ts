import { BytesLike } from 'ethers';
import { NumberAsString } from '../../types';
import { Address } from '../../types';
import { AbiItem } from 'web3-utils';
import { MultiResult } from '../../lib/multi-wrapper';
import { UniswapV3EventPool } from './uniswap-v3-pool';
import { UniswapV3Factory } from './uniswap-v3-factory';
import { BigNumber } from '@ethersproject/bignumber';

export type OracleObservation = {
  blockTimestamp: bigint;
  tickCumulative: bigint;
  secondsPerLiquidityCumulativeX128: bigint;
  initialized: boolean;
};

export type OracleObservationCandidates = {
  beforeOrAt: OracleObservation;
  atOrAfter: OracleObservation;
};

export type TickInfo = {
  liquidityGross: bigint;
  liquidityNet: bigint;
  tickCumulativeOutside: bigint;
  secondsPerLiquidityOutsideX128: bigint;
  secondsOutside: bigint;
  initialized: boolean;
};

export type Slot0 = {
  sqrtPriceX96: bigint;
  tick: bigint;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: bigint;
};

export type PoolState = {
  networkId: number;
  pool: string;
  blockTimestamp: bigint;
  tickSpacing: bigint;
  fee: bigint;
  slot0: Slot0;
  liquidity: bigint;
  maxLiquidityPerTick: bigint;
  tickBitmap: Record<NumberAsString, bigint>;
  ticks: Record<NumberAsString, TickInfo>;
  observations: Record<number, OracleObservation>;
  isValid: boolean;
  startTickBitmap: bigint;
  lowestKnownTick: bigint;
  highestKnownTick: bigint;
  balance0: bigint;
  balance1: bigint;
};

export type FactoryState = Record<string, never>;

export type UniswapV3Data = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
    fee: NumberAsString;
    currentFee?: NumberAsString;
  }[];
  isApproved?: boolean;
};

export type DecodeStateMultiCallFunc = (
  result: MultiResult<BytesLike> | BytesLike,
) => DecodedStateMultiCallResultWithRelativeBitmaps;

export type DexParams = {
  subgraphType?: 'subgraphs' | 'deployments';
  router: Address;
  quoter: Address;
  factory: Address;
  stateMulticall: Address;
  uniswapMulticall: Address;
  supportedFees: bigint[];
  tickSpacings?: bigint[];
  tickSpacingsToFees?: { [key: string]: bigint };
  chunksCount: number;
  initRetryFrequency: number;
  deployer?: Address;
  subgraphURL?: string;
  initHash: string;
  stateMultiCallAbi?: AbiItem[];
  eventPoolImplementation?: typeof UniswapV3EventPool;
  factoryImplementation?: typeof UniswapV3Factory;
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

export type UniswapV3ParamsDirectBase = [
  srcToken: Address,
  destToken: Address,
  fromAmount: NumberAsString,
  toAmount: NumberAsString,
  quotedAmount: NumberAsString,
  metadata: string,
  beneficiary: Address,
  pools: string,
];

export type UniswapV3ParamsDirect = [
  params: UniswapV3ParamsDirectBase,
  partnerAndFee: string,
  permit: string,
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

export type TickBitMapMappingsWithBigNumber = {
  index: number;
  value: BigNumber;
};

export type TickInfoWithBigNumber = {
  initialized: boolean;
  liquidityGross: BigNumber;
  liquidityNet: BigNumber;
  secondsOutside: number;
  secondsPerLiquidityOutsideX128: BigNumber;
  tickCumulativeOutside: BigNumber;
};

export type TickInfoMappingsWithBigNumber = {
  index: number;
  value: TickInfoWithBigNumber;
};

export type DecodedStateMultiCallResultWithRelativeBitmaps = {
  pool: Address;
  blockTimestamp: BigNumber;
  slot0: {
    feeProtocol: number;
    observationCardinality: number;
    observationCardinalityNext: number;
    observationIndex: number;
    sqrtPriceX96: BigNumber;
    tick: number;
    unlocked: boolean;
  };
  liquidity: BigNumber;
  tickSpacing: number;
  maxLiquidityPerTick: BigNumber;
  observation: {
    blockTimestamp: number;
    initialized: boolean;
    secondsPerLiquidityCumulativeX128: BigNumber;
    tickCumulative: BigNumber;
  };
  tickBitmap: TickBitMapMappingsWithBigNumber[];
  ticks: TickInfoMappingsWithBigNumber[];
};
