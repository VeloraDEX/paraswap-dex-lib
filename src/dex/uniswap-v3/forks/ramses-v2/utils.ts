import { MultiResult } from '../../../../lib/multi-wrapper';
import { BytesLike, ethers } from 'ethers';
import { DecodedStateMultiCallResultWithRelativeBitmaps } from '../../types';
import { extractSuccessAndValue } from '../../../../lib/decoders';
import { assert } from 'ts-essentials';

export function decodeStateMultiCallResultWithRelativeBitmaps(
  result: MultiResult<BytesLike> | BytesLike,
): DecodedStateMultiCallResultWithRelativeBitmaps {
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
          uint160 sqrtPriceX96,
          int24 tick,
          uint16 observationIndex,
          uint16 observationCardinality,
          uint16 observationCardinalityNext,
          uint8 feeProtocol,
          bool unlocked,
        ) slot0,
        uint128 liquidity,
        int24 tickSpacing,
        uint128 maxLiquidityPerTick,
        tuple(
          uint32 blockTimestamp,
          int56 tickCumulative,
          uint160 secondsPerLiquidityCumulativeX128,
          bool initialized,
          uint160 secondsPerBoostedLiquidityPeriodX128,
          uint32 boostedInRange,
        ) observation,
        tuple(
          int16 index,
          uint256 value
        )[] tickBitmap,
        tuple(
          int24 index,
          tuple(
            uint128 liquidityGross,
            int128 liquidityNet,
            uint128 cleanUnusedSlot,
            uint128 cleanUnusedSlot2,
            uint256 feeGrowthOutside0X128,
            uint256 feeGrowthOutside1X128,
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
  return decoded as DecodedStateMultiCallResultWithRelativeBitmaps;
}
