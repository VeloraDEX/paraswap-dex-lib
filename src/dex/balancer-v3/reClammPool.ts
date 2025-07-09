import { BufferState } from '@balancer-labs/balancer-maths';
import { CommonPoolState, PoolState, callData } from './types';
import { defaultAbiCoder, Interface } from '@ethersproject/abi';

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
  return (
    (poolState.poolType === 'RECLAMM' || poolState.poolType === 'RECLAMM_V2') &&
    isReClammMutableState(poolState)
  );
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

// Shared encoding function for ReClamm pools
export function encodeReClammOnChainData(
  contractInterface: Interface,
  address: string,
): callData[] {
  return [
    {
      target: address,
      callData: contractInterface.encodeFunctionData(
        'getReClammPoolDynamicData',
      ),
    },
  ];
}

// Shared decoding function for ReClamm pools
export function decodeReClammOnChainData(
  contractInterface: Interface,
  poolAddress: string,
  data: any,
  startIndex: number,
  decodeThrowError: (
    contractInterface: Interface,
    functionName: string,
    resultEntry: { success: boolean; returnData: any },
    poolAddress: string,
  ) => any,
): ReClammMutableState {
  const resultDynamicData = decodeThrowError(
    contractInterface,
    'getReClammPoolDynamicData',
    data[startIndex],
    poolAddress,
  );
  if (!resultDynamicData)
    throw new Error(
      `Failed to get result for getReClammPoolDynamicData for ${poolAddress}`,
    );

  return {
    lastTimestamp: BigInt(resultDynamicData[0].lastTimestamp),
    lastVirtualBalances: resultDynamicData[0].lastVirtualBalances.map(
      (b: any) => BigInt(b),
    ),
    dailyPriceShiftBase: BigInt(resultDynamicData[0].dailyPriceShiftBase),
    centerednessMargin: BigInt(resultDynamicData[0].centerednessMargin),
    startFourthRootPriceRatio: BigInt(
      resultDynamicData[0].startFourthRootPriceRatio,
    ),
    endFourthRootPriceRatio: BigInt(
      resultDynamicData[0].endFourthRootPriceRatio,
    ),
    priceRatioUpdateStartTime: BigInt(
      resultDynamicData[0].priceRatioUpdateStartTime,
    ),
    priceRatioUpdateEndTime: BigInt(
      resultDynamicData[0].priceRatioUpdateEndTime,
    ),
    currentTimestamp: 0n, // This will be updated at swap time
  };
}
