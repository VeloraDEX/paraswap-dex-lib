import { BufferState } from '@balancer-labs/balancer-maths';
import { CommonPoolState, PoolState } from './types';

// QuantAMM specific mutable data
export interface QuantAMMMutableState {
  lastUpdateTime: bigint;
  firstFourWeightsAndMultipliers: bigint[];
  secondFourWeightsAndMultipliers: bigint[];
  lastInteropTime: bigint;
  currentTimestamp: bigint;
}

export type QuantAmmImmutable = {
  maxTradeSizeRatio: bigint;
};

export type QauntAMMPoolState = CommonPoolState &
  QuantAMMMutableState &
  QuantAmmImmutable;

export function isQuantAMMMutableState(
  poolState: any,
): poolState is QuantAMMMutableState {
  return (
    poolState &&
    typeof poolState === 'object' &&
    'lastUpdateTime' in poolState &&
    'firstFourWeightsAndMultipliers' in poolState &&
    'secondFourWeightsAndMultipliers' in poolState &&
    'lastInteropTime' in poolState
  );
}

export function isQuantAMMPoolState(poolState: PoolState | BufferState) {
  return (
    poolState.poolType === 'QUANT_AMM_WEIGHTED' &&
    isQuantAMMMutableState(poolState)
  );
}

export function updateLatestQuantAMMState(
  poolState: QauntAMMPoolState,
  timestamp: bigint,
) {
  poolState.currentTimestamp = timestamp;
}

export function updateQuantAMMPoolState(
  poolState: QauntAMMPoolState,
  weightsAndMultipliers: string[],
  lastUpdateTime: string,
  lastInterpolationTimePossible: string,
) {
  const firstFourWeightsAndMultipliers: bigint[] = new Array(8);
  const secondFourWeightsAndMultipliers: bigint[] = new Array(8);

  for (let i = 0; i < 4; i++) {
    // w,w,w,w,w,w,w,w,m,m,m,m,m,m,m,m
    // First 4 elements go to firstFourWeightsAndMultipliers[0-3]
    firstFourWeightsAndMultipliers[i] = BigInt(weightsAndMultipliers[i]);

    // Next 4 elements go to secondFourWeightsAndMultipliers[0-3]
    secondFourWeightsAndMultipliers[i] = BigInt(weightsAndMultipliers[i + 4]);

    // Next 4 elements go to firstFourWeightsAndMultipliers[4-7]
    firstFourWeightsAndMultipliers[i + 4] = BigInt(
      weightsAndMultipliers[i + 8],
    );

    // Last 4 elements go to secondFourWeightsAndMultipliers[4-7]
    secondFourWeightsAndMultipliers[i + 4] = BigInt(
      weightsAndMultipliers[i + 12],
    );
  }

  // Update the pool state
  poolState.firstFourWeightsAndMultipliers = firstFourWeightsAndMultipliers;
  poolState.secondFourWeightsAndMultipliers = secondFourWeightsAndMultipliers;

  // Update timestamps
  poolState.lastUpdateTime = BigInt(lastUpdateTime);
  poolState.lastInteropTime = BigInt(lastInterpolationTimePossible);
}
