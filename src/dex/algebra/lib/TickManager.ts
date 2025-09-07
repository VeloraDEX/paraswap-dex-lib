import { IAlgebraPoolState } from '../types';
import { LiquidityMath } from '../../uniswap-v3/contract-math/LiquidityMath';
import { _require } from '../../../utils';
import { NumberAsString } from '@paraswap/core';
import { ZERO_TICK_INFO } from '../../uniswap-v3/constants';
import { TickInfo } from '../../uniswap-v3/types';

export class TickManager {
  static update(
    state: Pick<IAlgebraPoolState, 'ticks'>,
    tick: bigint,
    tickCurrent: bigint,
    liquidityDelta: bigint,
    secondsPerLiquidityCumulativeX128: bigint,
    tickCumulative: bigint,
    time: bigint,
    upper: boolean,
    maxLiquidity: bigint,
  ): boolean {
    let info = state.ticks[Number(tick)];

    if (info === undefined) {
      info = { ...ZERO_TICK_INFO };
      state.ticks[Number(tick)] = info;
    }

    // uint128 liquidityTotalBefore = data.liquidityTotal;
    // uint128 liquidityTotalAfter = LiquidityMath.addDelta(liquidityTotalBefore, liquidityDelta);
    // require(liquidityTotalAfter < Constants.MAX_LIQUIDITY_PER_TICK + 1, 'LO');
    const liquidityGrossBefore = info.liquidityGross;
    const liquidityGrossAfter = LiquidityMath.addDelta(
      liquidityGrossBefore,
      liquidityDelta,
    );
    _require(
      liquidityGrossAfter <= maxLiquidity,
      'LO',
      { liquidityGrossAfter, maxLiquidity },
      'liquidityGrossAfter <= maxLiquidity',
    );

    // int128 liquidityDeltaBefore = data.liquidityDelta;
    const liquidityNetBefore = info.liquidityNet;

    // // when the lower (upper) tick is crossed left to right (right to left), liquidity must be added (removed)
    // data.liquidityDelta = upper
    //   ? int256(liquidityDeltaBefore).sub(liquidityDelta).toInt128()
    //   : int256(liquidityDeltaBefore).add(liquidityDelta).toInt128();
    //
    // data.liquidityTotal = liquidityTotalAfter;
    info.liquidityNet = upper
      ? BigInt.asIntN(
          128,
          BigInt.asIntN(256, liquidityNetBefore) - liquidityDelta,
        )
      : BigInt.asIntN(
          128,
          BigInt.asIntN(256, liquidityNetBefore) + liquidityDelta,
        );

    // flipped = (liquidityTotalAfter == 0);
    // if (liquidityTotalBefore == 0) {
    //   flipped = !flipped;
    //   // by convention, we assume that all growth before a tick was initialized happened _below_ the tick
    //   if (tick <= currentTick) {
    //     data.outerFeeGrowth0Token = totalFeeGrowth0Token;
    //     data.outerFeeGrowth1Token = totalFeeGrowth1Token;
    //     data.outerSecondsPerLiquidity = secondsPerLiquidityCumulative;
    //     data.outerTickCumulative = tickCumulative;
    //     data.outerSecondsSpent = time;
    //   }
    //   data.initialized = true;
    // }

    let flipped = liquidityGrossAfter === 0n;
    if (liquidityGrossBefore === 0n) {
      flipped = !flipped;
      if (tick <= tickCurrent) {
        info.secondsPerLiquidityOutsideX128 = secondsPerLiquidityCumulativeX128;
        info.tickCumulativeOutside = tickCumulative;
        info.secondsOutside = time;
      }
      info.initialized = true;
    }

    // data.liquidityTotal = liquidityTotalAfter;
    info.liquidityGross = liquidityGrossAfter;

    return flipped;
  }
}
