import { BufferState } from '@balancer-labs/balancer-maths';
import { CommonPoolState, PoolState } from './types';
import { defaultAbiCoder } from '@ethersproject/abi';

export const ReClammApiName = 'RECLAMM';

// https://github.com/balancer/reclamm/blob/main/test/gas/.hardhat-snapshots
export const RECLAMM_GAS_COST = 186000;

// reClamm specific mutable data
export interface ReClammMutableState {
  lastTimestamp: bigint;
  lastVirtualBalances: bigint[];
  dailyPriceShiftBase: bigint;
  centerednessMargin: bigint;
  startFourthRootPriceRatio: bigint;
  endFourthRootPriceRatio: bigint;
  priceRatioUpdateStartTime: bigint;
  priceRatioUpdateEndTime: bigint;
  currentTimestamp: bigint;
}

export type ReClammPoolState = CommonPoolState & ReClammMutableState;

export function isReClammMutableState(
  poolState: any,
): poolState is ReClammMutableState {
  return (
    poolState &&
    typeof poolState === 'object' &&
    'lastTimestamp' in poolState &&
    'lastVirtualBalances' in poolState &&
    'dailyPriceShiftBase' in poolState &&
    'centerednessMargin' in poolState &&
    'startFourthRootPriceRatio' in poolState &&
    'endFourthRootPriceRatio' in poolState &&
    'priceRatioUpdateStartTime' in poolState &&
    'priceRatioUpdateEndTime' in poolState &&
    'currentTimestamp' in poolState
  );
}

export function isReClammPool(poolState: PoolState | BufferState) {
  return poolState.poolType === 'RECLAMM' && isReClammMutableState(poolState);
}

export function lastTimestampUpdatedEvent(
  poolState: PoolState,
  eventData: any,
) {
  // abi.encode(lastTimestamp32)
  const decodedParams = defaultAbiCoder.decode(['uint256'], eventData);
  if (isReClammMutableState(poolState)) {
    poolState.lastTimestamp = decodedParams[0].toBigInt();
  } else throw new Error("Can't update lastTimestamp on non-reClamm pool");
}

export function priceRatioStateUpdatedEvent(
  poolState: PoolState,
  eventData: any,
) {
  // abi.encode(startFourthRootPriceRatio,endFourthRootPriceRatio,priceRatioUpdateStartTime,priceRatioUpdateEndTime)
  const decodedParams = defaultAbiCoder.decode(
    ['uint256', 'uint256', 'uint256', 'uint256'],
    eventData,
  );
  if (isReClammMutableState(poolState)) {
    poolState.startFourthRootPriceRatio = decodedParams[0].toBigInt();
    poolState.endFourthRootPriceRatio = decodedParams[1].toBigInt();
    poolState.priceRatioUpdateStartTime = decodedParams[2].toBigInt();
    poolState.priceRatioUpdateEndTime = decodedParams[3].toBigInt();
  } else throw new Error("Can't update priceRatioState on non-reClamm pool");
}

export function dailyPriceShiftExponentUpdatedEvent(
  poolState: PoolState,
  eventData: any,
) {
  // abi.encode(dailyPriceShiftExponent, dailyPriceShiftBase)
  const decodedParams = defaultAbiCoder.decode(
    ['uint256', 'uint128'],
    eventData,
  );
  if (isReClammMutableState(poolState)) {
    poolState.dailyPriceShiftBase = decodedParams[1].toBigInt();
  } else
    throw new Error("Can't update dailyPriceShiftExponent on non-reClamm pool");
}

export function centerednessMarginUpdatedEvent(
  poolState: PoolState,
  eventData: any,
) {
  // abi.encode(centerednessMargin)
  const decodedParams = defaultAbiCoder.decode(['uint256'], eventData);
  if (isReClammMutableState(poolState)) {
    poolState.centerednessMargin = decodedParams[0].toBigInt();
  } else throw new Error("Can't update centerednessMargin on non-reClamm pool");
}

export function virtualBalancesUpdatedEvent(
  poolState: PoolState,
  eventData: any,
) {
  // abi.encode(virtualBalanceA, virtualBalanceB)
  const decodedParams = defaultAbiCoder.decode(
    ['uint256', 'uint256'],
    eventData,
  );
  if (isReClammMutableState(poolState)) {
    poolState.lastVirtualBalances = [
      decodedParams[0].toBigInt(),
      decodedParams[1].toBigInt(),
    ];
  } else
    throw new Error("Can't update lastVirtualBalances on non-reClamm pool");
}
