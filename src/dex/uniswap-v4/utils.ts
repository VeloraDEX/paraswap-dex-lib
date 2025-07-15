import { PoolState } from './types';

export function sortPools(a: PoolState, b: PoolState) {
  const idA = a.id.toUpperCase();
  const idB = b.id.toUpperCase();
  if (idA < idB) {
    return -1;
  }
  if (idA > idB) {
    return 1;
  }
  return 0;
}
