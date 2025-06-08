import { defaultAbiCoder, Result } from '@ethersproject/abi';
import { BytesLike, ethers } from 'ethers';
import { extractSuccessAndValue, generalDecoder } from '../../lib/decoders';
import { MultiResult } from '../../lib/multi-wrapper';
import { LatestRoundData, OracleObservation, Slot0 } from './types';

export const encodeStringToBytes32 = (value: string) =>
  ethers.encodeBytes32String(value);

export const decodeObserveTickCumulatives = (
  result: MultiResult<BytesLike> | BytesLike,
): Record<0 | 1, bigint> => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return {
      0: 0n,
      1: 0n,
    };
  }
  const decoded = defaultAbiCoder.decode(
    ['int56[] tickCumulatives', 'uint160[]'],
    toDecode,
  );

  return {
    0: BigInt(decoded.tickCumulatives[0]),
    1: BigInt(decoded.tickCumulatives[1]),
  };
};

export const decodeUniswapV3Slot0 = (
  result: MultiResult<BytesLike> | BytesLike,
): Slot0 => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return {
      tick: 0n,
      observationCardinality: 0n,
      observationIndex: 0n,
    };
  }
  const decoded = defaultAbiCoder.decode(
    [
      'tuple(uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    ],
    toDecode,
  )[0];

  return {
    tick: BigInt(decoded.tick),
    observationCardinality: BigInt(decoded.observationCardinality),
    observationIndex: BigInt(decoded.observationIndex),
  };
};

export const decodeOracleObservation = (
  result: MultiResult<BytesLike> | BytesLike,
): OracleObservation => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return {
      blockTimestamp: 0n,
      tickCumulative: 0n,
      secondsPerLiquidityCumulativeX128: 0n,
      initialized: false,
    };
  }
  const decoded = defaultAbiCoder.decode(
    [
      'tuple(uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)',
    ],
    toDecode,
  )[0];

  return {
    blockTimestamp: BigInt(decoded.blockTimestamp),
    tickCumulative: BigInt(decoded.tickCumulative),
    secondsPerLiquidityCumulativeX128: BigInt(
      decoded.secondsPerLiquidityCumulativeX128,
    ),
    initialized: decoded.initialized,
  };
};

export const decodeLatestRoundData = (
  result: MultiResult<BytesLike> | BytesLike,
): LatestRoundData => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return {
      answer: 0n,
      updatedAt: 0n,
      roundId: 0n,
    };
  }

  const decoded = defaultAbiCoder.decode(
    [
      'tuple(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
    ],
    toDecode,
  )[0];

  return {
    answer: BigInt(decoded.answer),
    updatedAt: BigInt(decoded.updatedAt),
    roundId: BigInt(decoded.roundId),
  };
};

export function synthStatusDecoder(
  result: MultiResult<BytesLike> | BytesLike,
): boolean[] {
  return generalDecoder(
    result,
    ['bool[]', 'uint256[]'],
    [false],
    (toParse: Result) =>
      toParse[0].map((isSuspended: boolean) => !!isSuspended),
  );
}
