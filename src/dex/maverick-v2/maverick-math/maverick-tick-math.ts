import { BI_MAX_UINT256, BI_POWS } from '../../../bigint-constants';
import { MaverickBasicMath } from './maverick-basic-math';

const MAX_TICK = 460540;

export class MaverickTickMath {
  static getTickSqrtPriceAndL(
    reserveA: bigint,
    reserveB: bigint,
    sqrtLowerTickPrice: bigint,
    sqrtUpperTickPrice: bigint,
  ): [bigint, bigint] {
    let liquidity = this.getTickL(
      reserveA,
      reserveB,
      sqrtLowerTickPrice,
      sqrtUpperTickPrice,
    );

    let sqrtPrice = this.getSqrtPrice(
      reserveA,
      reserveB,
      sqrtLowerTickPrice,
      sqrtUpperTickPrice,
      liquidity,
    );

    return [sqrtPrice, liquidity];
  }

  static getSqrtPrice(
    reserveA: bigint,
    reserveB: bigint,
    sqrtLowerTickPrice: bigint,
    sqrtUpperTickPrice: bigint,
    liquidity: bigint,
  ): bigint {
    if (reserveA === 0n) {
      return sqrtLowerTickPrice;
    }
    if (reserveB === 0n) {
      return sqrtUpperTickPrice;
    }

    let sqrtPrice = MaverickBasicMath.sqrt(
      BI_POWS[18] *
        MaverickBasicMath.divDown(
          reserveA + MaverickBasicMath.mulDown(liquidity, sqrtLowerTickPrice),
          reserveB + MaverickBasicMath.divDown(liquidity, sqrtUpperTickPrice),
        ),
    );

    return MaverickBasicMath.min(
      MaverickBasicMath.max(sqrtPrice, sqrtLowerTickPrice),
      sqrtUpperTickPrice,
    );
  }

  static getTickL(
    reserveA: bigint,
    reserveB: bigint,
    sqrtLowerTickPrice: bigint,
    sqrtUpperTickPrice: bigint,
  ): bigint {
    let precisionBump = 0n;

    if (reserveA >> 78n === 0n && reserveB >> 78n === 0n) {
      precisionBump = 57n;
      reserveA <<= precisionBump;
      reserveB <<= precisionBump;
    }

    const diff = sqrtUpperTickPrice - sqrtLowerTickPrice;

    if (reserveB === 0n)
      return MaverickBasicMath.divDown(reserveA, diff) >> precisionBump;
    if (reserveA === 0n)
      return (
        MaverickBasicMath.mulDivDown(
          MaverickBasicMath.mulDown(reserveB, sqrtLowerTickPrice),
          sqrtUpperTickPrice,
          diff,
        ) >> precisionBump
      );

    const b =
      (MaverickBasicMath.divDown(reserveA, sqrtUpperTickPrice) +
        MaverickBasicMath.mulDown(reserveB, sqrtLowerTickPrice)) >>
      1n;

    return (
      MaverickBasicMath.mulDiv(
        b +
          MaverickBasicMath.sqrt(
            MaverickBasicMath.mulDiv(b, b, BI_POWS[18]) +
              MaverickBasicMath.mulDiv(
                MaverickBasicMath.mulFloor(reserveB, reserveA),
                diff,
                sqrtUpperTickPrice,
              ),
          ) *
            BI_POWS[9],
        sqrtUpperTickPrice,
        diff,
      ) >> precisionBump
    );
  }

  static tickSqrtPrices(tickSpacing: bigint, tick: bigint): [bigint, bigint] {
    return [
      this.tickSqrtPrice(tickSpacing, tick),
      this.tickSqrtPrice(tickSpacing, tick + 1n),
    ];
  }

  static subTickIndex(tickSpacing: bigint, tick: bigint): bigint {
    let subTick = MaverickBasicMath.abs(tick);
    subTick *= tickSpacing;
    if (subTick > MAX_TICK) {
      throw new Error('OB');
    }
    return subTick;
  }

  static tickSqrtPrice(tickSpacing: bigint, _tick: bigint): bigint {
    let tick = this.subTickIndex(tickSpacing, _tick);

    let ratio: bigint =
      (tick & 0x1n) != 0n
        ? 0xfffcb933bd6fad9d3af5f0b9f25db4d6n
        : 0x100000000000000000000000000000000n;
    if ((tick & 0x2n) != 0n)
      ratio = (ratio * 0xfff97272373d41fd789c8cb37ffcaa1cn) >> 128n;
    if ((tick & 0x4n) != 0n)
      ratio = (ratio * 0xfff2e50f5f656ac9229c67059486f389n) >> 128n;
    if ((tick & 0x8n) != 0n)
      ratio = (ratio * 0xffe5caca7e10e81259b3cddc7a064941n) >> 128n;
    if ((tick & 0x10n) != 0n)
      ratio = (ratio * 0xffcb9843d60f67b19e8887e0bd251eb7n) >> 128n;
    if ((tick & 0x20n) != 0n)
      ratio = (ratio * 0xff973b41fa98cd2e57b660be99eb2c4an) >> 128n;
    if ((tick & 0x40n) != 0n)
      ratio = (ratio * 0xff2ea16466c9838804e327cb417cafcbn) >> 128n;
    if ((tick & 0x80n) != 0n)
      ratio = (ratio * 0xfe5dee046a99d51e2cc356c2f617dbe0n) >> 128n;
    if ((tick & 0x100n) != 0n)
      ratio = (ratio * 0xfcbe86c7900aecf64236ab31f1f9dcb5n) >> 128n;
    if ((tick & 0x200n) != 0n)
      ratio = (ratio * 0xf987a7253ac4d9194200696907cf2e37n) >> 128n;
    if ((tick & 0x400n) != 0n)
      ratio = (ratio * 0xf3392b0822b88206f8abe8a3b44dd9ben) >> 128n;
    if ((tick & 0x800n) != 0n)
      ratio = (ratio * 0xe7159475a2c578ef4f1d17b2b235d480n) >> 128n;
    if ((tick & 0x1000n) != 0n)
      ratio = (ratio * 0xd097f3bdfd254ee83bdd3f248e7e785en) >> 128n;
    if ((tick & 0x2000n) != 0n)
      ratio = (ratio * 0xa9f746462d8f7dd10e744d913d033333n) >> 128n;
    if ((tick & 0x4000n) != 0n)
      ratio = (ratio * 0x70d869a156ddd32a39e257bc3f50aa9bn) >> 128n;
    if ((tick & 0x8000n) != 0n)
      ratio = (ratio * 0x31be135f97da6e09a19dc367e3b6da40n) >> 128n;
    if ((tick & 0x10000n) != 0n)
      ratio = (ratio * 0x9aa508b5b7e5a9780b0cc4e25d61a56n) >> 128n;
    if ((tick & 0x20000n) != 0n)
      ratio = (ratio * 0x5d6af8dedbcb3a6ccb7ce618d14225n) >> 128n;
    if ((tick & 0x40000n) != 0n)
      ratio = (ratio * 0x2216e584f630389b2052b8db590en) >> 128n;
    if ((tick & 0x80000n) != 0n)
      ratio = (ratio * 0x48a1703920644d4030024fen) >> 128n;
    if ((tick & 0x100000n) != 0n) ratio = (ratio * 0x149b34ee7b4532n) >> 128n;
    if (_tick > 0) ratio = BI_MAX_UINT256 / ratio;
    return (ratio * BI_POWS[18]) >> 128n;
  }
}
