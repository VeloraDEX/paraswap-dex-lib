import { BytesLike, ethers } from 'ethers';
import { extractSuccessAndValue, uint16ToBigInt } from '../../lib/decoders';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { DecodedStateMultiCallResultIntegral } from './types';
import { AlgebraIntegralEventPool } from './algebra-integral-pool';

export function decodeStateMultiCallResultIntegral(
  result: MultiResult<BytesLike> | BytesLike,
): DecodedStateMultiCallResultIntegral | null {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    return null;
  }

  const decoded = ethers.utils.defaultAbiCoder.decode(
    [
      `
        tuple(
          address pool,
          uint256 blockTimestamp,
          tuple(
            uint160 price,
            int24 tick,
            uint16 lastFee,
            uint8 pluginConfig,
            uint16 communityFee,
            bool unlocked
          ) globalState,
          uint128 liquidity,
          int24 tickSpacing,
          uint128 maxLiquidityPerTick,
          tuple(
            int16 index,
            uint256 value
          )[] tickBitmap,
          tuple(
            int24 index,
            tuple(
              uint256 liquidityGross,
              int128 liquidityNet,
              int56 tickCumulativeOutside,
              uint160 secondsPerLiquidityOutsideX128,
              uint32 secondsOutside,
              bool initialized
            ) value
          )[] ticks
        )
      `,
    ],
    toDecode,
  )[0];

  return decoded as DecodedStateMultiCallResultIntegral;
}

export function buildFeeCallData(
  pools: AlgebraIntegralEventPool[],
): MultiCallParams<bigint>[] {
  return pools.map(pool => ({
    target: pool.poolAddress,
    callData: pool.poolIface.encodeFunctionData('fee', []),
    decodeFunction: uint16ToBigInt,
  }));
}
