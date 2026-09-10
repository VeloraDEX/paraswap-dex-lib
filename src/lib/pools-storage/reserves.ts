import { BytesLike } from 'ethers';
import _ from 'lodash';
import { UNLIMITED_RESERVES } from '../../constants';
import { MultiCallParams, MultiResult, MultiWrapper } from '../multi-wrapper';
import { Address } from '../../types';

export type ReserveCapacity = bigint | typeof UNLIMITED_RESERVES;

export type DirectionalReserve = {
  src: Address;
  dest: Address;
  capacity: ReserveCapacity;
};

// Thrown when a `getPoolReserves` request itself is malformed (wrong mode,
// batch too large), as opposed to a failure inside the dex.
export class PoolReservesRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolReservesRequestError';
  }
}

const formatCapacity = (capacity: ReserveCapacity): string =>
  capacity === UNLIMITED_RESERVES ? UNLIMITED_RESERVES : capacity.toString();

// Plain keys: every listed token can be swapped to every other listed token
// in both directions; `balances[i]` is the payout capacity of `tokens[i]`.
export function toReserves(
  tokens: Address[],
  balances: ReserveCapacity[],
): Record<string, string> {
  if (tokens.length !== balances.length) {
    throw new Error(
      `toReserves: ${tokens.length} tokens but ${balances.length} balances`,
    );
  }
  const reserves: Record<string, string> = {};
  tokens.forEach((token, i) => {
    reserves[token.toLowerCase()] = formatCapacity(balances[i]);
  });
  return reserves;
}

// Directional keys: exactly the listed `src -> dest` swaps are supported and
// each value is the payout capacity of `dest` for that swap.
export function directionalReserves(
  swaps: DirectionalReserve[],
): Record<string, string> {
  const reserves: Record<string, string> = {};
  for (const { src, dest, capacity } of swaps) {
    reserves[`${src.toLowerCase()}_${dest.toLowerCase()}`] =
      formatCapacity(capacity);
  }
  return reserves;
}

// Non-reverting multicall with per-call isolation: a reverted call, a
// decoder that throws on a malformed return, or a failed RPC chunk yields
// `null` for the affected calls only. `MultiWrapper.tryAggregate` isolates
// reverts but runs decoders unguarded and rejects as a whole when any chunk
// fails, so both are handled here.
export async function multicallBalances(
  multiWrapper: MultiWrapper,
  calls: MultiCallParams<bigint>[],
  chunkSize: number = multiWrapper.defaultBatchSize,
): Promise<(bigint | null)[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`multicallBalances: invalid chunk size ${chunkSize}`);
  }
  if (calls.length === 0) return [];

  const guarded: MultiCallParams<bigint | null>[] = calls.map(call => ({
    target: call.target,
    callData: call.callData,
    decodeFunction: (data: MultiResult<BytesLike> | BytesLike) => {
      try {
        return call.decodeFunction(data);
      } catch (e) {
        return null;
      }
    },
  }));

  const chunks = await Promise.all(
    _.chunk(guarded, chunkSize).map(async chunk => {
      try {
        const results = await multiWrapper.tryAggregate(
          false,
          chunk,
          undefined,
          chunk.length,
          false,
        );
        return results.map(r => (r.success ? r.returnData : null));
      } catch (e) {
        return chunk.map(() => null);
      }
    }),
  );

  return chunks.flat();
}

// Plain keys with unlimited payout capacity for every listed token: a
// mint/convert wrapper that swaps every listed token to every other one.
export function unlimitedReserves(tokens: Address[]): Record<string, string> {
  return toReserves(
    tokens,
    tokens.map(() => UNLIMITED_RESERVES),
  );
}
