import { PoolState, PositionState } from '../types';
import { _require } from '../../../utils';

export class Position {
  public static calculatePositionKey(
    owner: string,
    tickLower: bigint,
    tickUpper: bigint,
    salt: string,
  ): string {
    return `${owner}-${tickLower.toString()}-${tickUpper.toString()}-${salt}`;
  }

  static get(
    poolState: PoolState,
    owner: string,
    tickLower: bigint,
    tickUpper: bigint,
    salt: string,
  ): PositionState | undefined {
    const positionKey = Position.calculatePositionKey(
      owner,
      tickLower,
      tickUpper,
      salt,
    );

    return poolState.positions![positionKey];
  }

  static update(
    poolState: PoolState,
    owner: string,
    tickLower: bigint,
    tickUpper: bigint,
    salt: string,
    liquidityDelta: bigint,
    feeGrowthInside0X128: bigint,
    feeGrowthInside1X128: bigint,
  ): { feesOwed0: bigint; feesOwed1: bigint } {
    const positionKey = Position.calculatePositionKey(
      owner,
      tickLower,
      tickUpper,
      salt,
    );
    let position = poolState.positions![positionKey];

    _require(Boolean(position), 'Position does not exist', { position });

    let { liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128 } =
      position;

    if (liquidityDelta === 0n) {
      _require(liquidity !== 0n, 'Cannot update empty position', {
        liquidityDelta,
      });
    } else {
      liquidity += liquidityDelta;
    }

    const feesOwed0 =
      ((feeGrowthInside0X128 - feeGrowthInside0LastX128) * liquidity) /
      BigInt(1 << 128);
    const feesOwed1 =
      ((feeGrowthInside1X128 - feeGrowthInside1LastX128) * liquidity) /
      BigInt(1 << 128);

    poolState.positions![positionKey] = {
      liquidity,
      feeGrowthInside0LastX128: feeGrowthInside0X128,
      feeGrowthInside1LastX128: feeGrowthInside1X128,
    };

    return { feesOwed0, feesOwed1 };
  }
}
