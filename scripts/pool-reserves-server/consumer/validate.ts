import { PoolReserves } from '../../../src/types';
import { UNLIMITED_RESERVES } from '../../../src/constants';

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const DECIMAL_RE = /^(0|[1-9][0-9]*)$/;

// Structural contract of a `PoolReserves` row (same invariants as
// tests/utils-pool-reserves.ts). Accepts anything the dex returned and
// reports the first violation, or null when the row is well formed.
export function validateRow(candidate: unknown, dexKey: string): string | null {
  if (candidate === null || typeof candidate !== 'object') {
    return `row is ${candidate === null ? 'null' : typeof candidate}`;
  }
  const row = candidate as Partial<PoolReserves>;
  if (row.dex !== dexKey) return `dex ${String(row.dex)} != ${dexKey}`;
  if (typeof row.id !== 'string' || row.id.length === 0) return 'empty id';
  if (typeof row.address !== 'string' || !ADDRESS_RE.test(row.address)) {
    return `address ${String(row.address)}`;
  }
  if (row.reserves === null || typeof row.reserves !== 'object') {
    return 'reserves not an object';
  }

  const keys = Object.keys(row.reserves);
  if (keys.length === 0) return 'no reserves';

  let directional = 0;
  for (const key of keys) {
    const parts = key.split('_');
    if (parts.length === 2) {
      directional++;
      if (!ADDRESS_RE.test(parts[0]) || !ADDRESS_RE.test(parts[1])) {
        return `key ${key}`;
      }
      if (parts[0] === parts[1]) return `key ${key} src == dest`;
    } else if (parts.length !== 1 || !ADDRESS_RE.test(key)) {
      return `key ${key}`;
    }

    const value = row.reserves[key];
    if (
      typeof value !== 'string' ||
      (value !== UNLIMITED_RESERVES && !DECIMAL_RE.test(value))
    ) {
      return `value ${key}=${String(value)}`;
    }
  }

  if (directional !== 0 && directional !== keys.length) return 'mixed keys';
  if (directional === 0 && keys.length < 2) return 'single plain token';
  return null;
}

export function isZeroReserves(reserves: Record<string, string>): boolean {
  return Object.values(reserves).every(v => v === '0');
}

export function hasUnlimited(reserves: Record<string, string>): boolean {
  return Object.values(reserves).some(v => v === UNLIMITED_RESERVES);
}
