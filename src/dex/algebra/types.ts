import { BigNumber } from '@ethersproject/bignumber';
import { Address, NumberAsString } from '../../types';
import { TickInfo } from '../uniswap-v3/types';

export type GlobalStateV1_1 = {
  price: bigint; // The square root of the current price in Q64.96 format
  tick: bigint; // The current tick
  fee: bigint; // The current fee in hundredths of a bip, i.e. 1e-6
  communityFeeToken0: bigint; // The community fee represented as a percent of all collected fee in thousandths (1e-3)
  communityFeeToken1: bigint;
};

export type PoolStateV1_1 = {
  pool: string;
  blockTimestamp: bigint;
  tickSpacing: bigint; // is actually constant
  globalState: GlobalStateV1_1; // eq slot0
  liquidity: bigint;
  maxLiquidityPerTick: bigint; // is actually constant
  tickBitmap: Record<NumberAsString, bigint>; // actually called tickTable in contract-
  ticks: Record<NumberAsString, TickInfo>; // although variable names are different in contracts but matches UniswapV3 TickInfo struct 1:1
  isValid: boolean;
  startTickBitmap: bigint;
  balance0: bigint;
  balance1: bigint;
  areTicksCompressed: boolean;
};

type GlobalState_v1_9 = {
  price: bigint; // The square root of the current price in Q64.96 format
  tick: bigint; // The current tick
  feeZto: bigint; // The current fee in hundredths of a bip, i.e. 1e-6
  feeOtz: bigint; // The current fee in hundredths of a bip, i.e. 1e-6
  communityFeeToken0: bigint; // The community fee represented as a percent of all collected fee in thousandths (1e-3)
  communityFeeToken1: bigint;
};

export type PoolState_v1_9 = {
  pool: string;
  blockTimestamp: bigint;
  tickSpacing: bigint;
  globalState: GlobalState_v1_9; // eq slot0
  liquidity: bigint;
  maxLiquidityPerTick: bigint;
  tickBitmap: Record<NumberAsString, bigint>; // actually called tickTable in contract-
  ticks: Record<NumberAsString, TickInfo>; // although variable names are different in contracts but matches UniswapV3 TickInfo struct 1:1
  isValid: boolean;
  startTickBitmap: bigint;
  balance0: bigint;
  balance1: bigint;
  areTicksCompressed: boolean;
};

export type FactoryState = Record<string, never>;

export type AlgebraData = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
  }[];
  feeOnTransfer: boolean;
  isApproved?: boolean;
};

export type AlgebraDataWithFee = {
  tokenIn: Address;
  tokenOut: Address;
};

export enum AlgebraFunctions {
  exactInput = 'exactInput',
  exactOutput = 'exactOutput',
  exactInputWithFeeToken = 'exactInputSingleSupportingFeeOnTransferTokens',
}

export type DexParams = {
  router: Address;
  quoter: Address;
  factory: Address;
  algebraStateMulticall: Address;
  uniswapMulticall: Address;
  chunksCount: number;
  initRetryFrequency: number;
  deployer: Address;
  subgraphURL: string;
  initHash: string;
  version: 'v1.1' | 'v1.9' | 'v1.9-bidirectional-fee';
  forceRPC?: boolean;
  forceManualStateGenerate?: boolean;
};

export type IAlgebraPoolState = PoolStateV1_1 | PoolState_v1_9;

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

export type DecodedGlobalStateV1_1 = {
  price: BigNumber;
  tick: number;
  fee: number;
  communityFeeToken1: number;
  communityFeeToken0: number;
};

export type DecodedGlobalStateV1_9 = {
  price: BigNumber;
  tick: number;
  feeZto: number;
  feeOtz: number;
  communityFeeToken1: number;
  communityFeeToken0: number;
};

export type DecodedStateMultiCallResultWithRelativeBitmaps<DecodedGlobalState> =
  {
    pool: Address;
    blockTimestamp: BigNumber;
    globalState: DecodedGlobalState;
    liquidity: BigNumber;
    tickSpacing: number;
    maxLiquidityPerTick: BigNumber;
    tickBitmap: TickBitMapMappingsWithBigNumber[];
    ticks: TickInfoMappingsWithBigNumber[];
  };

export type DecodedStateMultiCallResultWithRelativeBitmapsV1_1 =
  DecodedStateMultiCallResultWithRelativeBitmaps<DecodedGlobalStateV1_1>;

export type DecodedStateMultiCallResultWithRelativeBitmapsV1_9 =
  DecodedStateMultiCallResultWithRelativeBitmaps<DecodedGlobalStateV1_9>;
