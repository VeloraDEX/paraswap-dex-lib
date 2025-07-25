import { BI_MAX_UINT256 } from '../../../bigint-constants';
import { BitMath } from './BitMath';

function mulShift(val: bigint, mulBy: string) {
  return (val * BigInt(mulBy)) >> 128n;
}

const Q32: bigint = 2n ** 32n;

export abstract class TickMath {
  private constructor() {}

  public static MIN_TICK: bigint = -887272n;
  public static MAX_TICK: bigint = 887272n;

  public static MIN_SQRT_PRICE: bigint = 4295128739n;
  public static MAX_SQRT_PRICE: bigint =
    1461446703485210103287273052203988822378723970342n;

  static maxUsableTick(tickSpacing: bigint): bigint {
    return (this.MAX_TICK / tickSpacing) * tickSpacing;
  }

  static minUsableTick(tickSpacing: bigint): bigint {
    return (this.MIN_TICK / tickSpacing) * tickSpacing;
  }

  static getSqrtPriceAtTick(tick: bigint) {
    if (tick < this.MIN_TICK || this.MAX_TICK < tick) {
      throw new Error(`InvalidTick(${tick})`);
    }

    const absTick: bigint = tick < 0n ? -tick : tick;

    let ratio: bigint =
      (absTick & 1n) !== 0n
        ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001')
        : BigInt('0x100000000000000000000000000000000');

    if ((absTick & 2n) !== 0n)
      ratio = mulShift(ratio, '0xfff97272373d413259a46990580e213a');
    if ((absTick & 4n) !== 0n)
      ratio = mulShift(ratio, '0xfff2e50f5f656932ef12357cf3c7fdcc');
    if ((absTick & 8n) !== 0n)
      ratio = mulShift(ratio, '0xffe5caca7e10e4e61c3624eaa0941cd0');
    if ((absTick & 16n) !== 0n)
      ratio = mulShift(ratio, '0xffcb9843d60f6159c9db58835c926644');
    if ((absTick & 32n) !== 0n)
      ratio = mulShift(ratio, '0xff973b41fa98c081472e6896dfb254c0');
    if ((absTick & 64n) !== 0n)
      ratio = mulShift(ratio, '0xff2ea16466c96a3843ec78b326b52861');
    if ((absTick & 128n) !== 0n)
      ratio = mulShift(ratio, '0xfe5dee046a99a2a811c461f1969c3053');
    if ((absTick & 256n) !== 0n)
      ratio = mulShift(ratio, '0xfcbe86c7900a88aedcffc83b479aa3a4');
    if ((absTick & 512n) !== 0n)
      ratio = mulShift(ratio, '0xf987a7253ac413176f2b074cf7815e54');
    if ((absTick & 1024n) !== 0n)
      ratio = mulShift(ratio, '0xf3392b0822b70005940c7a398e4b70f3');
    if ((absTick & 2048n) !== 0n)
      ratio = mulShift(ratio, '0xe7159475a2c29b7443b29c7fa6e889d9');
    if ((absTick & 4096n) !== 0n)
      ratio = mulShift(ratio, '0xd097f3bdfd2022b8845ad8f792aa5825');
    if ((absTick & 8192n) !== 0n)
      ratio = mulShift(ratio, '0xa9f746462d870fdf8a65dc1f90e061e5');
    if ((absTick & 16384n) !== 0n)
      ratio = mulShift(ratio, '0x70d869a156d2a1b890bb3df62baf32f7');
    if ((absTick & 32768n) !== 0n)
      ratio = mulShift(ratio, '0x31be135f97d08fd981231505542fcfa6');
    if ((absTick & 65536n) !== 0n)
      ratio = mulShift(ratio, '0x9aa508b5b7a84e1c677de54f3e99bc9');
    if ((absTick & 131072n) !== 0n)
      ratio = mulShift(ratio, '0x5d6af8dedb81196699c329225ee604');
    if ((absTick & 262144n) !== 0n)
      ratio = mulShift(ratio, '0x2216e584f5fa1ea926041bedfe98');
    if ((absTick & 524288n) !== 0n)
      ratio = mulShift(ratio, '0x48a170391f7dc42444e8fa2');

    if (tick > 0n) ratio = BI_MAX_UINT256 / ratio;

    return ratio % Q32 > 0n ? ratio / Q32 + 1n : ratio / Q32;
  }

  static getTickAtSqrtPrice(sqrtPriceX96: bigint): bigint {
    const sqrtPriceX128: bigint = sqrtPriceX96 << 32n;
    const msb: bigint = BitMath.mostSignificantBit(sqrtPriceX128);

    let r: bigint;
    if (msb >= 128n) {
      r = sqrtPriceX128 >> (msb - 127n);
    } else {
      r = sqrtPriceX128 << (127n - msb);
    }

    let log_2 = (msb - 128n) << 64n;

    for (let i = 0; i < 14; i++) {
      r = (r * r) >> 127n;
      const f = r >> 128n;
      log_2 = log_2 | (f << BigInt(63 - i));
      r = r >> f;
    }

    const log_sqrt10001 = log_2 * 255738958999603826347141n;

    const tickLow =
      (log_sqrt10001 - 3402992956809132418596140100660247210n) >> 128n;

    const tickHigh =
      (log_sqrt10001 + 291339464771989622907027621153398088495n) >> 128n;

    return tickLow === tickHigh
      ? tickLow
      : TickMath.getSqrtPriceAtTick(tickHigh) <= sqrtPriceX96
      ? tickHigh
      : tickLow;
  }
}
