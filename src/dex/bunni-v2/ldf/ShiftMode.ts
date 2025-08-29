export enum ShiftMode {
  BOTH,
  LEFT,
  RIGHT,
  STATIC,
}

export function enforceShiftMode(
  tick: bigint,
  lastTick: bigint,
  shiftMode: ShiftMode,
): bigint {
  if (
    (shiftMode === ShiftMode.LEFT && tick > lastTick) ||
    (shiftMode === ShiftMode.RIGHT && tick < lastTick)
  ) {
    return lastTick;
  }
  return tick;
}
