import { BI_MAX_UINT8 } from '../../../bigint-constants';
import { PoolState } from '../types';
import { BitMath } from './BitMath';
import { _require } from '../../../utils';
import { DeepReadonly } from 'ts-essentials';
import {
  OUT_OF_RANGE_ERROR_POSTFIX,
  TICK_BITMAP_BUFFER,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_TO_USE_BY_CHAIN,
} from '../constants';

function isWordPosOut(
  wordPos: bigint,
  startTickBitmap: bigint,
  // For pricing we use wider range to check price impact. If function called from event
  // it must always be within buffer
  isPriceQuery: boolean,
  networkId: number,
) {
  let lowerTickBitmapLimit;
  let upperTickBitmapLimit;

  const tickBitMapToUse =
    TICK_BITMAP_TO_USE_BY_CHAIN[networkId] ?? TICK_BITMAP_TO_USE;
  const tickBitMapBuffer =
    TICK_BITMAP_BUFFER_BY_CHAIN[networkId] ?? TICK_BITMAP_BUFFER;

  if (isPriceQuery) {
    lowerTickBitmapLimit =
      startTickBitmap - (tickBitMapBuffer + tickBitMapToUse);
    upperTickBitmapLimit =
      startTickBitmap + (tickBitMapBuffer + tickBitMapToUse);
  } else {
    lowerTickBitmapLimit = startTickBitmap - tickBitMapBuffer;
    upperTickBitmapLimit = startTickBitmap + tickBitMapBuffer;
  }

  _require(
    wordPos >= lowerTickBitmapLimit && wordPos <= upperTickBitmapLimit,
    `wordPos is out of safe state tickBitmap request range: ${OUT_OF_RANGE_ERROR_POSTFIX}`,
    { wordPos },
    `wordPos >= LOWER_TICK_REQUEST_LIMIT && wordPos <= UPPER_TICK_REQUEST_LIMIT`,
  );
}

export class TickBitMap {
  static position(tick: bigint): [bigint, bigint] {
    return [BigInt.asIntN(16, tick >> 8n), BigInt.asUintN(8, tick % 256n)];
  }

  static flipTick(
    state: Pick<PoolState, 'startTickBitmap' | 'tickBitmap' | 'networkId'>,
    tick: bigint,
    tickSpacing: bigint,
  ) {
    _require(
      tick % tickSpacing === 0n,
      '',
      { tick, tickSpacing },
      'tick % tickSpacing == 0n,',
    );
    const [wordPos, bitPos] = TickBitMap.position(tick / tickSpacing);
    const mask = 1n << bitPos;

    // flipTick is used only in _updatePosition which is always state changing event
    // Therefore it is never used in price query
    isWordPosOut(wordPos, state.startTickBitmap, false, state.networkId);

    const stringWordPos = wordPos.toString();
    if (state.tickBitmap[stringWordPos] === undefined) {
      state.tickBitmap[stringWordPos] = 0n;
    }

    state.tickBitmap[stringWordPos] ^= mask;
  }

  static nextInitializedTickWithinOneWord(
    state: DeepReadonly<
      Pick<PoolState, 'startTickBitmap' | 'tickBitmap' | 'networkId'>
    >,
    tick: bigint,
    tickSpacing: bigint,
    lte: boolean,
    isPriceQuery: boolean,
  ): [bigint, boolean] {
    let compressed = tick / tickSpacing;
    if (tick < 0n && tick % tickSpacing != 0n) compressed--;

    let next = 0n;
    let initialized = false;

    if (lte) {
      const [wordPos, bitPos] = TickBitMap.position(compressed);
      const mask = (1n << bitPos) - 1n + (1n << bitPos);

      isWordPosOut(
        wordPos,
        state.startTickBitmap,
        isPriceQuery,
        state.networkId,
      );
      let tickBitmapValue = state.tickBitmap[wordPos.toString()];
      tickBitmapValue = tickBitmapValue === undefined ? 0n : tickBitmapValue;

      const masked = tickBitmapValue & mask;

      initialized = masked != 0n;
      next = initialized
        ? (compressed -
            BigInt.asIntN(24, bitPos - BitMath.mostSignificantBit(masked))) *
          tickSpacing
        : (compressed - BigInt.asIntN(24, bitPos)) * tickSpacing;
    } else {
      // start from the word of the next tick, since the current tick state doesn't matter
      const [wordPos, bitPos] = TickBitMap.position(compressed + 1n);
      const mask = ~((1n << bitPos) - 1n);

      isWordPosOut(
        wordPos,
        state.startTickBitmap,
        isPriceQuery,
        state.networkId,
      );
      let tickBitmapValue = state.tickBitmap[wordPos.toString()];
      tickBitmapValue = tickBitmapValue === undefined ? 0n : tickBitmapValue;

      const masked = tickBitmapValue & mask;

      initialized = masked != 0n;
      next = initialized
        ? (compressed +
            1n +
            BigInt.asIntN(24, BitMath.leastSignificantBit(masked) - bitPos)) *
          tickSpacing
        : (compressed + 1n + BigInt.asIntN(24, BI_MAX_UINT8 - bitPos)) *
          tickSpacing;
    }

    return [next, initialized];
  }
}
