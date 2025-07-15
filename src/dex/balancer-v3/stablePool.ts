import { defaultAbiCoder } from '@ethersproject/abi';
import { PoolState } from '@balancer-labs/balancer-maths';
import { StableMutableState } from './types';

// TODO - Update with more accurate
export const STABLE_GAS_COST = 155000;

export function isStableMutableState(
  poolState: any,
): poolState is StableMutableState {
  return (
    poolState &&
    typeof poolState === 'object' &&
    'amp' in poolState &&
    'ampIsUpdating' in poolState &&
    'ampStartValue' in poolState &&
    'ampEndValue' in poolState &&
    'ampStartTime' in poolState &&
    'ampStopTime' in poolState
  );
}

// https://github.com/balancer/balancer-v3-monorepo/blob/009f2793abda248b150ccd15c1db25930c96ca82/pkg/pool-stable/contracts/StablePool.sol#L274
export function getAmplificationParameter(
  startValue: bigint,
  endValue: bigint,
  startTime: bigint,
  endTime: bigint,
  timestamp: bigint,
): bigint {
  let value: bigint;
  if (timestamp < endTime) {
    if (endValue > startValue) {
      value =
        startValue +
        ((endValue - startValue) * (timestamp - startTime)) /
          (endTime - startTime);
    } else {
      value =
        startValue -
        ((startValue - endValue) * (timestamp - startTime)) /
          (endTime - startTime);
    }
  } else {
    value = endValue;
  }
  return value;
}

export function ampUpdateStartedEvent(poolState: PoolState, eventData: any) {
  // abi.encode(currentValueUint64, endValueUint64, startTimeUint32, endTimeUint32)
  const decodedParams = defaultAbiCoder.decode(
    ['uint64', 'uint64', 'uint32', 'uint32'],
    eventData,
  );
  if (isStableMutableState(poolState)) {
    if (decodedParams[3] > decodedParams[2]) poolState.ampIsUpdating = true;
    poolState.ampStartValue = decodedParams[0].toBigInt();
    poolState.ampEndValue = decodedParams[1].toBigInt();
    poolState.ampStartTime = BigInt(decodedParams[2]);
    poolState.ampStopTime = BigInt(decodedParams[3]);
  } else throw new Error("Can't update amp on non-stable pool");
}

export function ampUpdateStoppedEvent(poolState: PoolState, eventData: any) {
  // abi.encode(currentValue)
  const decodedParams = defaultAbiCoder.decode(['uint256'], eventData);
  if (isStableMutableState(poolState)) {
    poolState.ampIsUpdating = false;
    poolState.amp = decodedParams[0].toBigInt();
    poolState.ampStartValue = decodedParams[0].toBigInt();
    poolState.ampEndValue = decodedParams[0].toBigInt();
    // In Contract these are update to timestamp event is called.
    // There doesn't appear to be a way to easily get timestamp non-async so default to 0n which should have no effect
    poolState.ampStartTime = BigInt(0n);
    poolState.ampStopTime = BigInt(0n);
  } else throw new Error("Can't update amp on non-stable pool");
}
