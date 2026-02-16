import { MAX_U256, TWO_POW_128, TWO_POW_160, TWO_POW_96 } from './constants';

export const MIN_TICK = -88722835;
export const MAX_TICK = 88722835;
export const MAX_SQRT_RATIO: bigint =
  6276949602062853172742588666607187473671941430179807625216n;
export const MIN_SQRT_RATIO: bigint = 18447191164202170524n;
export const FULL_RANGE_TICK_SPACING = 0;

export function toSqrtRatio(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK)
    throw new Error(`Invalid tick: ${tick}`);
  let sign = tick < 0;
  tick = Math.abs(tick);
  let ratio = 0x100000000000000000000000000000000n;
  if ((tick & 0x1) != 0) {
    ratio = 0xfffff79c8499329c7cbb2510d893283bn;
  }
  if ((tick & 0x2) != 0) {
    ratio = (ratio * 0xffffef390978c398134b4ff3764fe410n) >> 128n;
  }
  if ((tick & 0x4) != 0) {
    ratio = (ratio * 0xffffde72140b00a354bd3dc828e976c9n) >> 128n;
  }
  if ((tick & 0x8) != 0) {
    ratio = (ratio * 0xffffbce42c7be6c998ad6318193c0b18n) >> 128n;
  }
  if ((tick & 0x10) != 0) {
    ratio = (ratio * 0xffff79c86a8f6150a32d9778eceef97cn) >> 128n;
  }
  if ((tick & 0x20) != 0) {
    ratio = (ratio * 0xfffef3911b7cff24ba1b3dbb5f8f5974n) >> 128n;
  }
  if ((tick & 0x40) != 0) {
    ratio = (ratio * 0xfffde72350725cc4ea8feece3b5f13c8n) >> 128n;
  }
  if ((tick & 0x80) != 0) {
    ratio = (ratio * 0xfffbce4b06c196e9247ac87695d53c60n) >> 128n;
  }
  if ((tick & 0x100) != 0) {
    ratio = (ratio * 0xfff79ca7a4d1bf1ee8556cea23cdbaa5n) >> 128n;
  }
  if ((tick & 0x200) != 0) {
    ratio = (ratio * 0xffef3995a5b6a6267530f207142a5764n) >> 128n;
  }
  if ((tick & 0x400) != 0) {
    ratio = (ratio * 0xffde7444b28145508125d10077ba83b8n) >> 128n;
  }
  if ((tick & 0x800) != 0) {
    ratio = (ratio * 0xffbceceeb791747f10df216f2e53ec57n) >> 128n;
  }
  if ((tick & 0x1000) != 0) {
    ratio = (ratio * 0xff79eb706b9a64c6431d76e63531e929n) >> 128n;
  }
  if ((tick & 0x2000) != 0) {
    ratio = (ratio * 0xfef41d1a5f2ae3a20676bec6f7f9459an) >> 128n;
  }
  if ((tick & 0x4000) != 0) {
    ratio = (ratio * 0xfde95287d26d81bea159c37073122c73n) >> 128n;
  }
  if ((tick & 0x8000) != 0) {
    ratio = (ratio * 0xfbd701c7cbc4c8a6bb81efd232d1e4e7n) >> 128n;
  }
  if ((tick & 0x10000) != 0) {
    ratio = (ratio * 0xf7bf5211c72f5185f372aeb1d48f937en) >> 128n;
  }
  if ((tick & 0x20000) != 0) {
    ratio = (ratio * 0xefc2bf59df33ecc28125cf78ec4f167fn) >> 128n;
  }
  if ((tick & 0x40000) != 0) {
    ratio = (ratio * 0xe08d35706200796273f0b3a981d90cfdn) >> 128n;
  }
  if ((tick & 0x80000) != 0) {
    ratio = (ratio * 0xc4f76b68947482dc198a48a54348c4edn) >> 128n;
  }
  if ((tick & 0x100000) != 0) {
    ratio = (ratio * 0x978bcb9894317807e5fa4498eee7c0fan) >> 128n;
  }
  if ((tick & 0x200000) != 0) {
    ratio = (ratio * 0x59b63684b86e9f486ec54727371ba6can) >> 128n;
  }
  if ((tick & 0x400000) != 0) {
    ratio = (ratio * 0x1f703399d88f6aa83a28b22d4a1f56e3n) >> 128n;
  }
  if ((tick & 0x800000) != 0) {
    ratio = (ratio * 0x3dc5dac7376e20fc8679758d1bcdcfcn) >> 128n;
  }
  if ((tick & 0x1000000) != 0) {
    ratio = (ratio * 0xee7e32d61fdb0a5e622b820f681d0n) >> 128n;
  }
  if ((tick & 0x2000000) != 0) {
    ratio = (ratio * 0xde2ee4bc381afa7089aa84bb66n) >> 128n;
  }
  if ((tick & 0x4000000) != 0) {
    ratio = (ratio * 0xc0d55d4d7152c25fb139n) >> 128n;
  }

  if (tick > 0 && !sign) {
    ratio = MAX_U256 / ratio;
  }

  if (ratio >= TWO_POW_160) {
    ratio = (ratio >> 98n) << 98n;
  } else if (ratio >= TWO_POW_128) {
    ratio = (ratio >> 66n) << 66n;
  } else if (ratio >= TWO_POW_96) {
    ratio = (ratio >> 34n) << 34n;
  } else {
    ratio = (ratio >> 2n) << 2n;
  }

  return ratio;
}

const LOG_BASE_SQRT_TICK_SIZE = Math.log(Math.sqrt(1.000001));

export function approximateNumberOfTickSpacingsCrossed(
  sqrtRatioStart: bigint,
  sqrtRatioEnd: bigint,
  tickSpacing: number,
): number {
  if (tickSpacing === 0) {
    return 0;
  }

  const logPriceDiff =
    Math.log(Number(sqrtRatioEnd) / Number(sqrtRatioStart)) /
    LOG_BASE_SQRT_TICK_SIZE;

  return Math.floor(Math.abs(logPriceDiff / tickSpacing));
}

export function approximateSqrtRatioToTick(sqrtRatio: bigint): number {
  return Math.round(
    Math.log(Number(sqrtRatio) / 2 ** 128) / LOG_BASE_SQRT_TICK_SIZE,
  );
}
