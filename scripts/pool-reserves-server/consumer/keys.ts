export const DEFAULT_KEY_PREFIX = 'dexlib:pools_reserves_legacy';

export type ReservesKeys = {
  target: string;
  meta: string;
  lastFailure: string;
  tmp: (runId: string) => string;
};

export function reservesKeys(
  dexKey: string,
  chainId: number,
  prefix: string = DEFAULT_KEY_PREFIX,
): ReservesKeys {
  // `{…}` is a Redis Cluster hash tag: target, meta, staging and failure
  // keys land in one slot, which RENAME and MULTI/EVAL across them require
  const target = `${prefix}:{${dexKey}:${chainId}}`;
  return {
    target,
    meta: `${target}:meta`,
    lastFailure: `${target}:lastFailure`,
    tmp: runId => `${target}:tmp:${runId}`,
  };
}

export function newRunId(now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${rand}`;
}
