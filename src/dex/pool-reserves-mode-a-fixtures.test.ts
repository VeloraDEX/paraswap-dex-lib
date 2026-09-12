import { defaultAbiCoder } from '@ethersproject/abi';
import { PoolsStorageType } from '../types';
import { MultiCallParams, MultiWrapper } from '../lib/multi-wrapper';
import { expectPoolReserves } from '../../tests/utils-pool-reserves';
import { UniswapV2 } from './uniswap-v2/uniswap-v2';
import { UniswapV2RpcPoolTracker } from './uniswap-v2/rpc-pool-tracker';
import { Solidly } from './solidly/solidly';

// Deterministic cases for the storage-mode UniswapV2 / Solidly adapters.
// Instances are built from the prototype with only the fields
// `getPoolReserves` reads; the multicall wrapper is faked, so no RPC.

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const POOL = '0x4444444444444444444444444444444444444444';
const POOL2 = '0x5555555555555555555555555555555555555555';
const POOL3 = '0x6666666666666666666666666666666666666666';
const POOL4 = '0x7777777777777777777777777777777777777777';
const D = '0x8888888888888888888888888888888888888888';

const build = <T>(Cls: { prototype: T }, fields: object): T =>
  Object.assign(Object.create(Cls.prototype as object), fields);

const eventPool = (state: unknown, invalid = false) => ({
  isInvalid: () => invalid,
  getStaleState: () => state,
});

const encodeReserves = (r0: bigint, r1: bigint) =>
  defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'], [r0, r1, 1]);

// Replies to every call by pool address; missing → reverted call.
const fakeMultiWrapper = (
  tryAggregate: jest.Mock,
  onChain: Record<string, [bigint, bigint]>,
) => {
  tryAggregate.mockImplementation(
    async (_m: boolean, calls: MultiCallParams<unknown>[]) =>
      calls.map(call => {
        const value = onChain[call.target.toLowerCase()];
        return value
          ? {
              success: true,
              returnData: call.decodeFunction(encodeReserves(...value)),
            }
          : { success: false, returnData: null };
      }),
  );
  return { defaultBatchSize: 500, tryAggregate } as unknown as MultiWrapper;
};

const desc = (fields: object) => JSON.stringify(fields);
const pairDesc = (token0: string, token1: string, exchange?: string) =>
  desc({
    token0: { address: token0, decimals: 18 },
    token1: { address: token1, decimals: 18 },
    exchange,
    checkExistenceAfter: 1,
  });

describe('pool reserves fixtures: UniswapV2 storage mode', () => {
  const tryAggregate = jest.fn();
  const dexKey = 'UniswapV2';
  const key = (t0: string, t1: string) => `${dexKey}_${t0}_${t1}`.toLowerCase();

  const uni = (pairs: object, onChain: Record<string, [bigint, bigint]> = {}) =>
    build(UniswapV2, {
      dexKey,
      pairsHashCacheKey: 'dexlib_1_uniswapv2_pairs',
      pairs,
      dexHelper: { multiWrapper: fakeMultiWrapper(tryAggregate, onChain) },
    });

  beforeEach(() => tryAggregate.mockReset());

  it('publishes the _pairs hash with the field derivable from the value', () => {
    expect(uni({}).getPoolsStorage()).toEqual({
      key: 'dexlib_1_uniswapv2_pairs',
      type: PoolsStorageType.RedisHash,
      fieldInValue: true,
    });
  });

  it('serves a pair with event state without RPC', async () => {
    const dex = uni({
      [key(A, B)]: { pool: eventPool({ reserves0: '10', reserves1: '20' }) },
    });
    const reserves = await dex.getPoolReserves([
      pairDesc(A, B, POOL.toUpperCase().replace('0X', '0x')),
    ]);
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toEqual([
      {
        dex: dexKey,
        id: key(A, B),
        address: POOL,
        reserves: { [A]: '10', [B]: '20' },
      },
    ]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });

  it('falls back to getReserves() for unknown, invalid and stateless pairs and skips failed calls', async () => {
    const dex = uni(
      {
        [key(A, B)]: {
          exchange: POOL,
          pool: eventPool({ reserves0: '1', reserves1: '2' }, true),
        },
        [key(A, C)]: { exchange: POOL2, pool: eventPool(null) },
        // discovered but never priced: no event pool yet
        [key(A, D)]: { exchange: POOL4 },
      },
      { [POOL]: [3n, 4n], [POOL2]: [5n, 6n], [POOL4]: [7n, 8n] },
    );
    const reserves = await dex.getPoolReserves([
      pairDesc(A, B, POOL),
      pairDesc(A, C, POOL2),
      pairDesc(B, C, POOL3),
      pairDesc(A, D, POOL4),
    ]);
    expectPoolReserves(reserves, dexKey);
    expect(reserves.map(r => [r.id, r.reserves])).toEqual([
      [key(A, B), { [A]: '3', [B]: '4' }],
      [key(A, C), { [A]: '5', [C]: '6' }],
      [key(A, D), { [A]: '7', [D]: '8' }],
    ]);
    expect(tryAggregate).toHaveBeenCalledTimes(1);
    expect(tryAggregate.mock.calls[0][1].map((c: any) => c.target)).toEqual([
      POOL,
      POOL2,
      POOL3,
      POOL4,
    ]);
  });

  it('skips missing pairs, malformed descriptors and duplicates', async () => {
    const dex = uni({}, { [POOL]: [1n, 2n] });
    const reserves = await dex.getPoolReserves([
      pairDesc(A, B),
      'not json',
      'null',
      '42',
      desc({
        token0: { address: 'weth' },
        token1: { address: B },
        exchange: POOL,
      }),
      desc({ token0: { address: A }, token1: { address: A }, exchange: POOL }),
      pairDesc(A, B, POOL),
      pairDesc(B, A, POOL),
    ]);
    expect(reserves).toHaveLength(1);
    expect(reserves[0].id).toEqual(key(A, B));
    expect(tryAggregate).toHaveBeenCalledTimes(1);
    expect(tryAggregate.mock.calls[0][1]).toHaveLength(1);
  });

  it('maps reserve0 to the lower token whatever order the descriptor uses', async () => {
    const mixedCase = (a: string) => '0x' + a.slice(2).toUpperCase();
    const dex = uni(
      {
        [key(A, B)]: { pool: eventPool({ reserves0: '10', reserves1: '20' }) },
      },
      { [POOL2]: [30n, 40n] },
    );
    const reserves = await dex.getPoolReserves([
      pairDesc(mixedCase(B), mixedCase(A), POOL),
      pairDesc(C, A, POOL2),
    ]);
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toEqual([
      {
        dex: dexKey,
        id: key(A, B),
        address: POOL,
        reserves: { [A]: '10', [B]: '20' },
      },
      {
        dex: dexKey,
        id: key(A, C),
        address: POOL2,
        reserves: { [A]: '30', [C]: '40' },
      },
    ]);
  });

  it('skips a descriptor whose address contradicts the locally known pair', async () => {
    const dex = uni(
      {
        [key(A, B)]: {
          exchange: POOL,
          pool: eventPool({ reserves0: '1', reserves1: '2' }),
        },
        [key(A, C)]: { exchange: POOL2 },
      },
      { [POOL2]: [5n, 6n], [POOL3]: [7n, 8n] },
    );
    const reserves = await dex.getPoolReserves([
      pairDesc(A, B, POOL3),
      pairDesc(A, C, POOL3),
      pairDesc(A, C, POOL2),
    ]);
    expectPoolReserves(reserves, dexKey);
    expect(reserves.map(r => [r.id, r.address])).toEqual([[key(A, C), POOL2]]);
    expect(tryAggregate.mock.calls[0][1].map((c: any) => c.target)).toEqual([
      POOL2,
    ]);
  });

  it('returns nothing for an empty batch without RPC', async () => {
    expect(await uni({}).getPoolReserves([])).toEqual([]);
    expect(await uni({}).getPoolReserves()).toEqual([]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });
});

describe('pool reserves fixtures: Solidly storage mode', () => {
  const tryAggregate = jest.fn();
  const dexKey = 'Aerodrome';
  // Solidly keeps the dexKey case in its identifiers
  const key = (t0: string, t1: string, stable: boolean) =>
    `${dexKey}_${t0.toLowerCase()}_${t1.toLowerCase()}${stable ? 'S' : 'U'}`;
  const solidlyDesc = (exchange: string, stable?: boolean) =>
    desc({
      token0: { address: A, decimals: 18 },
      token1: { address: B, decimals: 6 },
      exchange,
      stable,
    });

  beforeEach(() => tryAggregate.mockReset());

  it('maps stable and volatile pools of one pair to distinct ids and states', async () => {
    const dex = build(Solidly, {
      dexKey,
      pairsHashCacheKey: 'dexlib_8453_aerodrome_pairs',
      pairs: {
        [key(A, B, false)]: {
          pool: eventPool({ reserves0: '1', reserves1: '2' }),
        },
        [key(A, B, true)]: {
          pool: eventPool({ reserves0: '3', reserves1: '4' }),
        },
      },
      dexHelper: { multiWrapper: fakeMultiWrapper(tryAggregate, {}) },
    });
    const reserves = await dex.getPoolReserves([
      solidlyDesc(POOL, false),
      solidlyDesc(POOL2, true),
      solidlyDesc(POOL3),
    ]);
    expectPoolReserves(reserves, dexKey);
    expect(reserves).toEqual([
      {
        dex: dexKey,
        id: key(A, B, false),
        address: POOL,
        reserves: { [A]: '1', [B]: '2' },
      },
      {
        dex: dexKey,
        id: key(A, B, true),
        address: POOL2,
        reserves: { [A]: '3', [B]: '4' },
      },
    ]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });
  it('decodes uint256 reserves above 2^112 on the RPC path', async () => {
    const wide = 2n ** 120n;
    const dex = build(Solidly, {
      dexKey,
      pairsHashCacheKey: 'dexlib_8453_aerodrome_pairs',
      pairs: {},
      dexHelper: {
        multiWrapper: fakeMultiWrapper(tryAggregate, { [POOL]: [wide, 1n] }),
      },
    });
    const reserves = await dex.getPoolReserves([solidlyDesc(POOL, true)]);
    expect(reserves).toEqual([
      {
        dex: dexKey,
        id: key(A, B, true),
        address: POOL,
        reserves: { [A]: wide.toString(), [B]: '1' },
      },
    ]);
  });

  it('checks the descriptor address against the pool of the same stability', async () => {
    const dex = build(Solidly, {
      dexKey,
      pairsHashCacheKey: 'dexlib_8453_aerodrome_pairs',
      pairs: {
        [key(A, B, false)]: { exchange: POOL },
        [key(A, B, true)]: { exchange: POOL2 },
      },
      dexHelper: {
        multiWrapper: fakeMultiWrapper(tryAggregate, {
          [POOL]: [1n, 2n],
          [POOL2]: [3n, 4n],
        }),
      },
    });
    const reserves = await dex.getPoolReserves([
      solidlyDesc(POOL, true),
      solidlyDesc(POOL2, true),
    ]);
    expect(reserves.map(r => [r.id, r.address])).toEqual([
      [key(A, B, true), POOL2],
    ]);
  });
});

describe('pool reserves fixtures: PancakeSwapV2 (UniswapV2RpcPoolTracker)', () => {
  const tryAggregate = jest.fn();
  const dexKey = 'PancakeSwapV2';
  const key = (t0: string, t1: string) => `${dexKey}_${t0}_${t1}`.toLowerCase();
  const trackerDesc = (
    i: unknown,
    address: string,
    token0: string,
    token1: string,
  ) =>
    desc({
      i,
      address,
      updatedAt: 1,
      token0: { address: token0, decimals: 18 },
      token1: { address: token1, decimals: 18 },
    });
  const trackerPool = (
    address: string,
    token0: string,
    token1: string,
    reserves: [bigint, bigint] | null,
  ) => ({
    address,
    token0Address: token0,
    token1Address: token1,
    reserve0: reserves?.[0] ?? 0n,
    reserve1: reserves?.[1] ?? 0n,
    reservesUpdatedAt: reserves ? 1 : null,
  });

  const tracker = (
    pools: object,
    pairs: object = {},
    onChain: Record<string, [bigint, bigint]> = {},
  ) =>
    build(UniswapV2RpcPoolTracker, {
      dexKey,
      cacheKey: 'dexlib_56_pancakeswapv2_pools',
      pairsHashCacheKey: 'dexlib_56_pancakeswapv2_pairs',
      pools,
      pairs,
      dexHelper: { multiWrapper: fakeMultiWrapper(tryAggregate, onChain) },
    });

  beforeEach(() => tryAggregate.mockReset());

  it('publishes the index-keyed _pools hash', () => {
    expect(tracker({}).getPoolsStorage()).toEqual({
      key: 'dexlib_56_pancakeswapv2_pools',
      type: PoolsStorageType.RedisHash,
      fieldInValue: false,
    });
  });

  it('reports the factory index as id; tracker reserves only when fetched, else RPC; event state wins', async () => {
    const dex = tracker(
      {
        '0': trackerPool(POOL, A, B, [10n, 20n]),
        '1': trackerPool(POOL2, B, C, null),
        '3': trackerPool(POOL3, A, C, [7n, 8n]),
      },
      {
        [key(A, C)]: {
          exchange: POOL3,
          pool: eventPool({ reserves0: '70', reserves1: '80' }),
        },
      },
      { [POOL2]: [30n, 40n], [POOL4]: [50n, 60n] },
    );
    const reserves = await dex.getPoolReserves([
      trackerDesc('0', POOL, A, B),
      trackerDesc(1, POOL2, B, C),
      trackerDesc('2', POOL4, A, D),
      trackerDesc('3', POOL3, A, C),
    ]);
    expectPoolReserves(reserves, dexKey);
    expect(reserves.map(r => [r.id, r.address, r.reserves])).toEqual([
      ['0', POOL, { [A]: '10', [B]: '20' }],
      ['1', POOL2, { [B]: '30', [C]: '40' }],
      ['2', POOL4, { [A]: '50', [D]: '60' }],
      ['3', POOL3, { [A]: '70', [C]: '80' }],
    ]);
    expect(tryAggregate).toHaveBeenCalledTimes(1);
    expect(tryAggregate.mock.calls[0][1].map((c: any) => c.target)).toEqual([
      POOL2,
      POOL4,
    ]);
  });

  it('skips descriptors without a valid index or contradicting the tracker entry', async () => {
    const dex = tracker(
      { '5': trackerPool(POOL, A, B, [1n, 2n]) },
      {},
      { [POOL2]: [3n, 4n] },
    );
    const reserves = await dex.getPoolReserves([
      trackerDesc(undefined, POOL2, A, B),
      trackerDesc('-1', POOL2, A, B),
      trackerDesc('1.5', POOL2, A, B),
      trackerDesc(1.5, POOL2, A, B),
      trackerDesc('5', POOL2, A, B),
      trackerDesc('5', POOL, A, C),
      desc({ i: '6', address: POOL2, token0: { address: A } }),
    ]);
    expect(reserves).toEqual([]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });

  it('collapses duplicate indices to one pool', async () => {
    const dex = tracker({}, {}, { [POOL]: [1n, 2n] });
    const reserves = await dex.getPoolReserves([
      trackerDesc('7', POOL, A, B),
      trackerDesc(7, POOL, B, A),
    ]);
    expect(reserves.map(r => r.id)).toEqual(['7']);
    expect(tryAggregate.mock.calls[0][1]).toHaveLength(1);
  });
});
