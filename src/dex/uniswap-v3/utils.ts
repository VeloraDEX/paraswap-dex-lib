import { BytesLike, ethers } from 'ethers';
import { assert } from 'ts-essentials';
import { extractSuccessAndValue } from '../../lib/decoders';
import { MultiResult } from '../../lib/multi-wrapper';
import { DexConfigMap } from '../../types';
import {
  DexParams,
  DecodedStateMultiCallResultWithRelativeBitmaps,
} from './types';

export function getUniswapV3DexKey(UniswapV3Config: DexConfigMap<DexParams>) {
  const UniswapV3Keys = Object.keys(UniswapV3Config);
  if (UniswapV3Keys.length !== 1) {
    throw new Error(
      `UniswapV3 key in UniswapV3Config is not unique. Update relevant places (optimizer) or fix config issue. Received: ${JSON.stringify(
        UniswapV3Config,
        (_0, value) => (typeof value === 'bigint' ? value.toString() : value),
      )}`,
    );
  }

  return UniswapV3Keys[0].toLowerCase();
}

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
        ) observation,
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
  return decoded as DecodedStateMultiCallResultWithRelativeBitmaps;
}
