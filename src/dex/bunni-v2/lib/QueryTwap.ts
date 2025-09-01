import { observe } from '../logic/BunniHookLogic';
import { PoolState } from '../types';

export function queryTwap(
  state: PoolState,
  twapSecondsAgo: bigint,
  blockTimestamp: bigint,
): bigint {
  const secondsAgos: bigint[] = [];
  secondsAgos[0] = twapSecondsAgo;
  secondsAgos[1] = 0n;

  const tickCumulatives: bigint[] = observe(state, secondsAgos, blockTimestamp);
  const tickCumulativesDelta: bigint = tickCumulatives[1] - tickCumulatives[0];
  return tickCumulativesDelta / twapSecondsAgo;
}
