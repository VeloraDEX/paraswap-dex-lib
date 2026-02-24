import { BigNumber } from 'ethers';
import { Address, NumberAsString } from '../../types';
import { TickInfo } from '../uniswap-v3/types';
import {
  TickBitMapMappingsWithBigNumber,
  TickInfoMappingsWithBigNumber,
} from '../algebra/types';

export type AlgebraIntegralData = {
  path: {
    tokenIn: Address;
    tokenOut: Address;
    deployer: Address;
  }[];
  feeOnTransfer: boolean;
  isApproved?: boolean;
};

export type AlgebraDataWithFee = {
  tokenIn: Address;
  tokenOut: Address;
};

export type DexParams = {
  factory: Address;
  quoter: Address;
  router: Address;
  subgraphURL: string;
  chunksCount: number;
  algebraStateMulticall: Address;
};

// Pool state compatible with PoolStateV1_1 shape for AlgebraMath reuse
export type AlgebraIntegralPoolState = {
  pool: string;
  blockTimestamp: bigint;
  tickSpacing: bigint;
  globalState: {
    price: bigint;
    tick: bigint;
    fee: bigint; // mapped from lastFee
    communityFeeToken0: bigint; // mapped from communityFee
    communityFeeToken1: bigint; // mapped from communityFee
  };
  liquidity: bigint;
  maxLiquidityPerTick: bigint;
  tickBitmap: Record<NumberAsString, bigint>;
  ticks: Record<NumberAsString, TickInfo>;
  isValid: boolean;
  startTickBitmap: bigint;
  balance0: bigint;
  balance1: bigint;
  areTicksCompressed: boolean;
};

export type Pool = {
  poolAddress: Address;
  token0: Address;
  token1: Address;
  deployer: string;
  tvlUSD: number;
};

export type FactoryState = Record<string, never>;

export enum AlgebraIntegralFunctions {
  exactInput = 'exactInput',
  exactOutput = 'exactOutput',
  exactInputWithFeeToken = 'exactInputSingleSupportingFeeOnTransferTokens',
}

export type DecodedGlobalStateIntegral = {
  price: BigNumber;
  tick: number;
  lastFee: number;
  pluginConfig: number;
  communityFee: number;
};

export type DecodedStateMultiCallResultIntegral = {
  pool: Address;
  blockTimestamp: BigNumber;
  globalState: DecodedGlobalStateIntegral;
  liquidity: BigNumber;
  tickSpacing: number;
  maxLiquidityPerTick: BigNumber;
  tickBitmap: TickBitMapMappingsWithBigNumber[];
  ticks: TickInfoMappingsWithBigNumber[];
};
