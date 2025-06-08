import { BytesLike, ethers } from 'ethers';
import { assert } from 'ts-essentials';
import { extractSuccessAndValue } from '../../lib/decoders';
import { MultiResult } from '../../lib/multi-wrapper';
import {
  DecodedGlobalStateV1_1,
  DecodedStateMultiCallResultWithRelativeBitmapsV1_1,
  DecodedStateMultiCallResultWithRelativeBitmapsV1_9,
  TickInfoWithBigNumber,
} from './types';
import { BigNumber } from '@ethersproject/bignumber';

export function decodeStateMultiCallResultWithRelativeBitmapsV1_1(
  result: MultiResult<BytesLike> | BytesLike,
): DecodedStateMultiCallResultWithRelativeBitmapsV1_1 {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  assert(
    isSuccess && toDecode !== '0x',
    `decodeStateMultiCallResultWithRelativeBitmaps failed to get decodable result: ${result}`,
  );

  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    [
      // I don't want to pass here any interface, so I just use it in ethers format
      `
        tuple(
          address pool,
          uint256 blockTimestamp,
          tuple(
            uint160 price,
            int24 tick,
            uint16 fee,
            uint16 timepointIndex,
            uint8 communityFeeToken0,
            uint8 communityFeeToken1,
            bool unlocked,
          ) globalState,
          uint128 liquidity,
          int24 tickSpacing,
          uint128 maxLiquidityPerTick,
          tuple(
            bool initialized,
            uint32 blockTimestamp,
            int56 tickCumulative,
            uint160 secondsPerLiquidityCumulative,
            uint88 volatilityCumulative,
            int24 averageTick,
            uint144 volumePerLiquidityCumulative,
          ) timepoints,
          tuple(
            int16 index,
            uint256 value,
          )[] tickBitmap,
          tuple(
            int24 index,
            tuple(
              uint128 liquidityGross,
              int128 liquidityNet,
              int56 tickCumulativeOutside,
              uint160 secondsPerLiquidityOutsideX128,
              uint32 secondsOutside,
              bool initialized,
            ) value,
          )[] ticks
        )
      `,
    ],
    toDecode,
  )[0];
  // This conversion is not precise, because when we decode, we have more values
  // But I typed only the ones that are used later
  return decoded as DecodedStateMultiCallResultWithRelativeBitmapsV1_1;
}

export function decodeStateMultiCallResultWithRelativeBitmapsV1_9(
  result: MultiResult<BytesLike> | BytesLike,
): DecodedStateMultiCallResultWithRelativeBitmapsV1_9 {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  assert(
    isSuccess && toDecode !== '0x',
    `decodeStateMultiCallResultWithRelativeBitmaps failed to get decodable result: ${result}`,
  );

  const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
    [
      // I don't want to pass here any interface, so I just use it in ethers format
      `
        tuple(
          address pool,
          uint256 blockTimestamp,
          tuple(
            uint160 price,
            int24 tick,
            uint16 feeZto,
            uint16 feeOtz,
            uint16 timepointIndex,
            uint8 communityFeeToken0,
            uint8 communityFeeToken1,
            bool unlocked,
          ) globalState,
          uint128 liquidity,
          int24 tickSpacing,
          uint128 maxLiquidityPerTick,
          tuple(
            bool initialized,
            uint32 blockTimestamp,
            int56 tickCumulative,
            uint160 secondsPerLiquidityCumulative,
            uint88 volatilityCumulative,
            int24 averageTick,
            uint144 volumePerLiquidityCumulative,
          ) timepoints,
          tuple(
            int16 index,
            uint256 value,
          )[] tickBitmap,
          tuple(
            int24 index,
            tuple(
              uint128 liquidityGross,
              int128 liquidityNet,
              int56 tickCumulativeOutside,
              uint160 secondsPerLiquidityOutsideX128,
              uint32 secondsOutside,
              bool initialized,
            ) value,
          )[] ticks
        )
      `,
    ],
    toDecode,
  )[0];
  // This conversion is not precise, because when we decode, we have more values
  // But I typed only the ones that are used later
  return decoded as DecodedStateMultiCallResultWithRelativeBitmapsV1_9;
}

export function decodeGlobalStateV1_1(
  result: MultiResult<BytesLike> | BytesLike,
): DecodedGlobalStateV1_1 {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  assert(
    isSuccess && toDecode !== '0x',
    `decodeGlobalStateV1_1 failed to get decodable result: ${result}`,
  );

  const results: DecodedGlobalStateV1_1 = {
    price: BigNumber.from(0),
    tick: 0,
    fee: 0,
    communityFeeToken0: 0,
    communityFeeToken1: 0,
  };

  [
    results.price,
    results.tick,
    results.fee,
    ,
    results.communityFeeToken0,
    results.communityFeeToken1,
  ] = ethers.AbiCoder.defaultAbiCoder().decode(
    [`uint160`, `int24`, `uint16`, `uint16`, `uint8`, `uint8`, `bool`],
    toDecode,
  );
  // This conversion is not precise, because when we decode, we have more values
  // But used later
  return results;
}

export function decodeTicksV1_1(
  result: MultiResult<BytesLike> | BytesLike,
): TickInfoWithBigNumber {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  assert(
    isSuccess && toDecode !== '0x',
    `decodeGlobalStateV1_1 failed to get decodable result: ${result}`,
  );

  const results: TickInfoWithBigNumber = {
    liquidityNet: BigNumber.from(0),
    liquidityGross: BigNumber.from(0),
    secondsOutside: 0,
    secondsPerLiquidityOutsideX128: BigNumber.from(0),
    tickCumulativeOutside: BigNumber.from(0),
    initialized: false,
  };

  [
    results.liquidityGross,
    results.liquidityNet,
    ,
    ,
    results.tickCumulativeOutside,
    results.secondsPerLiquidityOutsideX128,
    results.secondsOutside,
    results.initialized,
  ] = ethers.AbiCoder.defaultAbiCoder().decode(
    [
      `uint128`,
      `int128`,
      `uint256`,
      `uint256`,
      `int256`,
      `uint160`,
      `uint32`,
      `bool`,
    ],
    toDecode,
  );
  // This conversion is not precise, because when we decode, we have more values
  // But used later
  return results;
}
