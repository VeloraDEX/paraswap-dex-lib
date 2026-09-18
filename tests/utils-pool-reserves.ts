import { PoolReserves } from '../src/types';
import { UNLIMITED_RESERVES } from '../src/constants';

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const DECIMAL_RE = /^(0|[1-9][0-9]*)$/;

const isDirectional = (key: string) => key.includes('_');

// Shape checks shared by every `getPoolReserves` test: ids unique, addresses
// lowercase, keys either all plain tokens or all `src_dest` pairs within one
// pool, values decimal strings or UNLIMITED_RESERVES.
export function expectPoolReserves(
  results: PoolReserves[],
  dexKey: string,
): void {
  const ids = new Set<string>();
  for (const pool of results) {
    expect(pool.dex).toEqual(dexKey);
    expect(typeof pool.id).toEqual('string');
    expect(pool.id.length).toBeGreaterThan(0);
    expect(ids.has(pool.id)).toBeFalsy();
    ids.add(pool.id);

    expect(pool.address).toMatch(ADDRESS_RE);

    const keys = Object.keys(pool.reserves);
    expect(keys.length).toBeGreaterThan(0);

    const directional = keys.filter(isDirectional).length;
    expect(directional === 0 || directional === keys.length).toBeTruthy();

    for (const key of keys) {
      if (isDirectional(key)) {
        const [src, dest, ...rest] = key.split('_');
        expect(rest).toHaveLength(0);
        expect(src).toMatch(ADDRESS_RE);
        expect(dest).toMatch(ADDRESS_RE);
        expect(src).not.toEqual(dest);
      } else {
        expect(key).toMatch(ADDRESS_RE);
      }

      const value = pool.reserves[key];
      expect(typeof value).toEqual('string');
      expect(
        value === UNLIMITED_RESERVES || DECIMAL_RE.test(value),
      ).toBeTruthy();
    }
    if (directional === 0) expect(keys.length).toBeGreaterThanOrEqual(2);
  }
}

// Directed pairs implied by `reserves`: plain keys expand to every ordered
// pair of listed tokens; directional keys map to themselves.
export function impliedDirections(
  reserves: Record<string, string>,
): Set<string> {
  const keys = Object.keys(reserves);
  const out = new Set<string>();
  if (keys.some(isDirectional)) {
    keys.forEach(k => out.add(k));
    return out;
  }
  for (const a of keys) for (const b of keys) if (a !== b) out.add(`${a}_${b}`);
  return out;
}
