import { _require } from '../../../utils';
import { TickMath } from './TickMath';
import { PoolState, TickInfo } from '../types';
import { LiquidityMath } from './LiquidityMath';
import { NumberAsString } from '@paraswap/core';

export class Tick {
  static check(tickLower: bigint, tickUpper: bigint) {
    _require(
      tickLower <= tickUpper,
      '',
      { tickLower, tickUpper },
      'tickLower <= tickUpper',
    );
    _require(
      tickLower >= TickMath.MIN_TICK,
      '',
      { tickLower },
      'tickLower >= TickMath.MIN_TICK',
    );
    _require(
      tickUpper <= TickMath.MAX_TICK,
      '',
      { tickUpper },
      'tickUpper <= TickMath.MAX_TICK',
    );
  }

  static clear(poolState: PoolState, tick: bigint): void {
    delete poolState.ticks[Number(tick)];
  }

  static cross(ticks: Record<NumberAsString, TickInfo>, _tick: bigint): bigint {
    const tick = Number(_tick);
    let info = ticks[tick];

    if (!info) {
      ticks[tick] = {
        liquidityGross: 0n,
        liquidityNet: 0n,
      };
      info = ticks[tick];
    }

    return info.liquidityNet;
  }

  static update(
    poolState: PoolState,
    tick: bigint,
    liquidityDelta: bigint,
    upper: boolean,
  ): { flipped: boolean; liquidityGrossAfter: bigint } {
    let info: TickInfo = poolState.ticks[Number(tick)];

    if (!info) {
      poolState.ticks[Number(tick)] = {
        liquidityGross: 0n,
        liquidityNet: 0n,
      };
      info = poolState.ticks[Number(tick)];
    }

    const liquidityGrossBefore = info.liquidityGross;
    const liquidityNetBefore = info.liquidityNet;

    const liquidityGrossAfter = LiquidityMath.addDelta(
      liquidityGrossBefore,
      liquidityDelta,
    );

    const flipped =
      (liquidityGrossAfter === 0n) !== (liquidityGrossBefore === 0n);

    const liquidityNet = upper
      ? liquidityNetBefore - liquidityDelta
      : liquidityNetBefore + liquidityDelta;

    info.liquidityGross = liquidityGrossAfter;
    info.liquidityNet = liquidityNet;

    return {
      flipped,
      liquidityGrossAfter,
    };
  }
}
