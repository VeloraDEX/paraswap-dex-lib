import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import { Address, PoolReserves } from '../../types';
import { BytesLike } from 'ethers';
import { MultiResult, MultiWrapper } from '../multi-wrapper';
import { generalDecoder } from '../decoders';
import { multicallBalances, toReserves } from './reserves';

const erc20Iface = new Interface(ERC20ABI);

// Throws on empty or malformed return data (an address without code answers
// `balanceOf` with `0x`), so the guarded multicall drops the pool instead of
// reporting a zero balance.
const strictUint256 = (result: MultiResult<BytesLike> | BytesLike): bigint =>
  generalDecoder(result, ['uint256'], undefined, v => v[0].toBigInt());
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export const isAddressString = (value: unknown): value is Address =>
  typeof value === 'string' && ADDRESS_RE.test(value);

// Storage descriptor of a pool that holds its two tokens at its own address.
// The hash field is the pool address.
export type TokenPoolDescriptor = { a: Address; t0: Address; t1: Address };

export function tokenPoolDescriptor(
  address: Address,
  token0: Address,
  token1: Address,
): TokenPoolDescriptor {
  return {
    a: address.toLowerCase(),
    t0: token0.toLowerCase(),
    t1: token1.toLowerCase(),
  };
}

export function parseTokenPoolDescriptor(
  raw: string,
): TokenPoolDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  const d = parsed as Partial<TokenPoolDescriptor> | null;
  if (
    !isAddressString(d?.a) ||
    !isAddressString(d?.t0) ||
    !isAddressString(d?.t1)
  ) {
    return null;
  }
  const descriptor = tokenPoolDescriptor(d.a, d.t0, d.t1);
  return descriptor.t0 === descriptor.t1 ? null : descriptor;
}

export const describesTokens = (
  descriptor: TokenPoolDescriptor,
  token0: Address,
  token1: Address,
): boolean => {
  const [a, b] = [token0.toLowerCase(), token1.toLowerCase()];
  return (
    (descriptor.t0 === a && descriptor.t1 === b) ||
    (descriptor.t0 === b && descriptor.t1 === a)
  );
};

// In-memory balances of a pool by lowercase token address. `null`: nothing
// usable in memory, fetch over RPC. A record that lacks one of the
// descriptor's tokens means the descriptor contradicts the pool this instance
// knows at that address, and the descriptor is skipped.
export type TokenPoolBalances = Partial<Record<Address, bigint>> | null;

export async function tokenPoolReserves(params: {
  dexKey: string;
  multiWrapper: MultiWrapper;
  descriptors: string[];
  cached: (pool: TokenPoolDescriptor) => TokenPoolBalances;
}): Promise<PoolReserves[]> {
  const pools: TokenPoolDescriptor[] = [];
  const seen = new Set<string>();
  for (const raw of params.descriptors) {
    const pool = parseTokenPoolDescriptor(raw);
    if (!pool || seen.has(pool.a)) continue;
    seen.add(pool.a);
    pools.push(pool);
  }

  const balances = new Map<string, [bigint, bigint]>();
  const misses: TokenPoolDescriptor[] = [];
  for (const pool of pools) {
    const known = params.cached(pool);
    if (known === null) {
      misses.push(pool);
      continue;
    }
    const b0 = known[pool.t0];
    const b1 = known[pool.t1];
    if (b0 !== undefined && b1 !== undefined) balances.set(pool.a, [b0, b1]);
  }

  if (misses.length > 0) {
    const fetched = await multicallBalances(
      params.multiWrapper,
      misses.flatMap(pool =>
        [pool.t0, pool.t1].map(token => ({
          target: token,
          callData: erc20Iface.encodeFunctionData('balanceOf', [pool.a]),
          decodeFunction: strictUint256,
        })),
      ),
    );
    misses.forEach((pool, i) => {
      const b0 = fetched[2 * i];
      const b1 = fetched[2 * i + 1];
      if (b0 !== null && b1 !== null) balances.set(pool.a, [b0, b1]);
    });
  }

  const result: PoolReserves[] = [];
  for (const pool of pools) {
    const value = balances.get(pool.a);
    if (!value) continue;
    result.push({
      dex: params.dexKey,
      id: pool.a,
      address: pool.a,
      reserves: toReserves([pool.t0, pool.t1], value),
    });
  }
  return result;
}
