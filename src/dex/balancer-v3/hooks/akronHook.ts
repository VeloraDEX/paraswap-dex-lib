import { SUPPORTED_POOLS } from '../config';
import { CommonPoolState, PoolState } from '../types';
import { BufferState } from '@balancer-labs/balancer-maths';

export const Akron = {
  type: 'Akron' as const,
  apiName: 'AKRON' as const,
};

export type AkronConfig = {
  type: typeof Akron.type;
  apiName: typeof Akron.apiName;
  hookAddress: string;
};

export type AkronHookState = {
  weights: ReadonlyArray<bigint>;
  minimumSwapFeePercentage: bigint;
};

export function isAkronPoolState(poolState: any): poolState is CommonPoolState {
  return (
    poolState &&
    typeof poolState === 'object' &&
    'poolType' in poolState &&
    poolState.poolType === SUPPORTED_POOLS.WEIGHTED &&
    'hookType' in poolState &&
    poolState.hookType === Akron.type &&
    'weights' in poolState &&
    'swapFee' in poolState
  );
}
