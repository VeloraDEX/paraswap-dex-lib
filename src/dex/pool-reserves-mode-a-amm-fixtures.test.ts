import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../dex-helper/index';
import { ETHER_ADDRESS, Network } from '../constants';
import { PoolsStorageType } from '../types';
import { MultiCallParams } from '../lib/multi-wrapper';
import { expectPoolReserves } from '../../tests/utils-pool-reserves';
import { EkuboV3 } from './ekubo-v3/ekubo-v3';
import { CORE_ADDRESS } from './ekubo-v3/config';
import { MaverickV2 } from './maverick-v2/maverick-v2';
import { MaverickV2EventPool } from './maverick-v2/maverick-v2-pool';
import { Algebra } from './algebra/algebra';
import { AlgebraIntegral } from './algebra-integral/algebra-integral';

// Storage-mode AMMs built with their real constructors (no network calls are
// made until pricing); pool maps are replaced with fakes that expose only what
// `getPoolReserves` and the pools writer read. The multicall is faked.

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const C = '0xcccccccccccccccccccccccccccccccccccccccc';
const POOL = '0xdddddddddddddddddddddddddddddddddddddddd';
const POOL2 = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const POOL3 = '0xffffffffffffffffffffffffffffffffffffffff';

const desc = (fields: object) => JSON.stringify(fields);
const upper = (a: string) => '0x' + a.slice(2).toUpperCase();

const statePool = (
  address: string,
  token0: string,
  token1: string,
  state: object | null,
  invalid = false,
) => ({
  poolAddress: address,
  address,
  token0,
  token1,
  tokenA: { address: token0 },
  tokenB: { address: token1 },
  isInvalid: () => invalid,
  getStaleState: () => state,
});

// balanceOf replies keyed by `${token}:${pool}`
const fakeMulticall = (
  dexHelper: DummyDexHelper,
  balances: Record<string, bigint>,
) => {
  const tryAggregate = jest.fn(
    async (_m: boolean, calls: MultiCallParams<unknown>[]) =>
      calls.map(call => {
        const owner = '0x' + call.callData.slice(-40);
        const value = balances[`${call.target}:${owner}`];
        return value === undefined
          ? { success: false, returnData: null }
          : { success: true, returnData: value };
      }),
  );
  (dexHelper.multiWrapper as any).tryAggregate = tryAggregate;
  return tryAggregate;
};

const storedDescriptors = async (dexHelper: DummyDexHelper, key: string) => {
  const raw = await dexHelper.cache.hgetAll(key);
  return Object.fromEntries(
    Object.entries(raw).map(([field, value]) => {
      const { u, ...rest } = JSON.parse(value);
      expect(typeof u).toEqual('number');
      return [field, rest];
    }),
  );
};

describe('pool reserves fixtures: EkuboV3', () => {
  const dexHelper = new DummyDexHelper(Network.MAINNET);
  const dex = new EkuboV3(Network.MAINNET, 'EkuboV3', dexHelper);
  const pools: Map<string, any> = (dex as any).poolManager.poolsByString;
  const K1 = 'ekubov3_k1';
  const K2 = 'ekubov3_k2';
  const K3 = 'ekubov3_k3';

  beforeEach(() => {
    pools.clear();
    pools.set(K1, {
      key: { token0: 0n, token1: BigInt(A) },
      isInvalid: () => false,
      computeTvl: () => [10n, 20n],
    });
    pools.set(K2, {
      key: { token0: BigInt(A), token1: BigInt(B) },
      isInvalid: () => true,
      computeTvl: () => [1n, 2n],
    });
    pools.set(K3, {
      key: { token0: BigInt(A), token1: BigInt(B) },
      isInvalid: () => false,
      computeTvl: () => {
        throw new Error('pool has no state');
      },
    });
  });

  it('publishes a _pools hash keyed by the pool string id', async () => {
    const storage = dex.getPoolsStorage();
    expect(storage).toEqual({
      key: 'dl_1_ekubov3_pools',
      type: PoolsStorageType.RedisHash,
      fieldInValue: true,
    });
    await (dex as any).poolsWriter.flush();
    expect(await storedDescriptors(dexHelper, storage.key)).toEqual({
      [K1]: { k: K1, t0: ETHER_ADDRESS.toLowerCase(), t1: A },
      [K2]: { k: K2, t0: A, t1: B },
      [K3]: { k: K3, t0: A, t1: B },
    });
  });

  it('serves TVL from state, maps native to ETHER_ADDRESS, skips invalid and stateless pools', () => {
    const reserves = dex.getPoolReserves([
      desc({ k: K1, t0: ETHER_ADDRESS, t1: A }),
      desc({ k: K2, t0: A, t1: B }),
      desc({ k: K3, t0: A, t1: B }),
      desc({ k: 'ekubov3_unknown' }),
      desc({ k: 5 }),
      'garbage',
      desc({ k: K1 }),
    ]);
    expectPoolReserves(reserves, 'EkuboV3');
    expect(reserves).toEqual([
      {
        dex: 'EkuboV3',
        id: K1,
        address: CORE_ADDRESS.toLowerCase(),
        reserves: { [ETHER_ADDRESS.toLowerCase()]: '10', [A]: '20' },
      },
    ]);
  });
});

describe('pool reserves fixtures: MaverickV2', () => {
  const dexHelper = new DummyDexHelper(Network.BASE);
  const dex = new MaverickV2(Network.BASE, 'MaverickV2', dexHelper);

  beforeEach(() => {
    dex.pools = {
      [upper(POOL)]: statePool(upper(POOL), upper(A), B, {
        reserveA: 10n,
        reserveB: 20n,
      }),
      [POOL2]: statePool(POOL2, A, C, null),
    } as any;
  });

  it('publishes the API inventory through initializePricing and keeps it across a failed refresh', async () => {
    const apiPool = (id: string, tokenA: string, tokenB: string) => ({
      id,
      fee: 0.001,
      feeB: 0.001,
      tickSpacing: 1,
      lookback: 1,
      lowerTick: 0,
      tokenA: { address: tokenA, symbol: 'A', decimals: 18 },
      tokenB: { address: tokenB, symbol: 'B', decimals: 18 },
    });
    const queryPools = jest
      .fn()
      .mockResolvedValueOnce([apiPool(POOL, A, B), apiPool(POOL3, B, C)])
      .mockResolvedValueOnce([]); // API down → `_queryPoolsAPI` yields []
    (dex as any)._queryPoolsAPI = queryPools;
    // the first pool subscribes, the second one fails
    const initialize = jest
      .spyOn(MaverickV2EventPool.prototype, 'initialize')
      .mockImplementation(async function (this: MaverickV2EventPool) {
        if (this.address === POOL3) throw new Error('rpc down');
      });
    dex.pools = {};
    try {
      await dex.initializePricing(1);
      await (dex as any).poolsWriter.flush();
      const key = dex.getPoolsStorage().key;
      expect(await storedDescriptors(dexHelper, key)).toEqual({
        [POOL]: { a: POOL, t0: A, t1: B },
        [POOL3]: { a: POOL3, t0: B, t1: C },
      });
      expect(Object.keys(dex.pools)).toEqual([POOL]);

      await dexHelper.cache.hdel(key, [POOL, POOL3]);
      await dex.initializePricing(2);
      await (dex as any).poolsWriter.flush();
      expect(
        Object.keys(await storedDescriptors(dexHelper, key)).sort(),
      ).toEqual([POOL, POOL3].sort());
    } finally {
      dex.releaseResources();
      initialize.mockRestore();
    }
  });

  it('skips a descriptor whose tokens contradict a known pool even when that pool is invalid', async () => {
    dex.pools = {
      [POOL]: statePool(POOL, A, B, null, true),
    } as any;
    const tryAggregate = fakeMulticall(dexHelper, {
      [`${A}:${POOL}`]: 1n,
      [`${C}:${POOL}`]: 2n,
    });
    expect(
      await dex.getPoolReserves([desc({ a: POOL, t0: A, t1: C })]),
    ).toEqual([]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });

  it('serves reserveA/reserveB from state and balanceOf otherwise', async () => {
    const tryAggregate = fakeMulticall(dexHelper, {
      [`${A}:${POOL2}`]: 3n,
      [`${C}:${POOL2}`]: 4n,
      [`${A}:${POOL3}`]: 5n,
      [`${B}:${POOL3}`]: 6n,
    });
    const reserves = await dex.getPoolReserves([
      desc({ a: POOL, t0: B, t1: A }),
      desc({ a: POOL2, t0: A, t1: C }),
      desc({ a: POOL3, t0: A, t1: B }),
      desc({ a: POOL, t0: A, t1: C }),
    ]);
    expectPoolReserves(reserves, 'MaverickV2');
    expect(reserves.map(r => [r.id, r.reserves])).toEqual([
      [POOL, { [A]: '10', [B]: '20' }],
      [POOL2, { [A]: '3', [C]: '4' }],
      [POOL3, { [A]: '5', [B]: '6' }],
    ]);
    expect(tryAggregate).toHaveBeenCalledTimes(1);
    expect(tryAggregate.mock.calls[0][1]).toHaveLength(4);
  });
});

describe('pool reserves fixtures: Algebra', () => {
  const dexHelper = new DummyDexHelper(Network.POLYGON);
  const dex = new Algebra(Network.POLYGON, 'QuickSwapV3', dexHelper);

  beforeEach(() => {
    (dex as any).eventPools = {
      QuickSwapV3_a_b: statePool(POOL, A, B, { balance0: 1n, balance1: 2n }),
      QuickSwapV3_a_c: statePool(POOL2, A, C, null), // init failed
      QuickSwapV3_b_c: null, // known non-existent pair
      QuickSwapV3_x_y: statePool(
        POOL3,
        B,
        C,
        { balance0: 7n, balance1: 8n },
        true,
      ),
    };
  });

  it('publishes only pools that have state', async () => {
    expect(dex.getPoolsStorage().key).toEqual('dl_137_quickswapv3_pools');
    await (dex as any).poolsWriter.flush();
    expect(
      await storedDescriptors(dexHelper, dex.getPoolsStorage().key),
    ).toEqual({
      [POOL]: { a: POOL, t0: A, t1: B },
      [POOL3]: { a: POOL3, t0: B, t1: C },
    });
  });

  it('matches a pool whose lazy address is still checksummed', async () => {
    const checksummed = '0xDdDDddDdDdddDDddDDddDDDDdDdDDdDDdDDDDDDd';
    (dex as any).eventPools = {
      QuickSwapV3_a_b: statePool(checksummed, A, B, null),
    };
    const tryAggregate = fakeMulticall(dexHelper, {
      [`${A}:${POOL}`]: 1n,
      [`${C}:${POOL}`]: 2n,
    });
    expect(
      await dex.getPoolReserves([desc({ a: POOL, t0: A, t1: C })]),
    ).toEqual([]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });

  it('serves balances from state, RPC for stateless or invalid pools, skips contradictions', async () => {
    const tryAggregate = fakeMulticall(dexHelper, {
      [`${A}:${POOL2}`]: 3n,
      [`${C}:${POOL2}`]: 4n,
      [`${B}:${POOL3}`]: 70n,
      [`${C}:${POOL3}`]: 80n,
    });
    const reserves = await dex.getPoolReserves([
      desc({ a: POOL, t0: A, t1: B }),
      desc({ a: POOL2, t0: A, t1: C }),
      desc({ a: POOL3, t0: B, t1: C }),
      desc({ a: POOL, t0: A, t1: C }),
    ]);
    expectPoolReserves(reserves, 'QuickSwapV3');
    expect(reserves.map(r => [r.id, r.reserves])).toEqual([
      [POOL, { [A]: '1', [B]: '2' }],
      [POOL2, { [A]: '3', [C]: '4' }],
      [POOL3, { [B]: '70', [C]: '80' }],
    ]);
    expect(tryAggregate.mock.calls[0][1]).toHaveLength(4);
  });
});

describe('pool reserves fixtures: AlgebraIntegral', () => {
  const dexHelper = new DummyDexHelper(Network.BASE);
  const dex = new AlgebraIntegral(Network.BASE, 'QuickSwapV4', dexHelper);

  beforeEach(() => {
    (dex as any).factory = {
      getAllPools: () => [
        { poolAddress: POOL, token0: A, token1: B, tvlUSD: 1_000_000 },
        { poolAddress: POOL2, token0: A, token1: C, tvlUSD: 100_000 },
        { poolAddress: POOL3, token0: B, token1: C, tvlUSD: 10 },
      ],
    };
    (dex as any).eventPools = {
      QuickSwapV4_a_b_d: statePool(POOL, A, B, { balance0: 1n, balance1: 2n }),
      QuickSwapV4_a_c_d: null,
    };
  });

  it('publishes routable factory pools regardless of pricing state', async () => {
    expect(dex.getPoolsStorage().key).toEqual('dl_8453_quickswapv4_pools');
    await (dex as any).poolsWriter.flush();
    expect(
      await storedDescriptors(dexHelper, dex.getPoolsStorage().key),
    ).toEqual({
      [POOL]: { a: POOL, t0: A, t1: B },
      [POOL2]: { a: POOL2, t0: A, t1: C },
    });
  });

  it('serves balances from state and balanceOf for unpriced pools', async () => {
    const tryAggregate = fakeMulticall(dexHelper, {
      [`${A}:${POOL2}`]: 3n,
      [`${C}:${POOL2}`]: 4n,
    });
    const reserves = await dex.getPoolReserves([
      desc({ a: POOL, t0: A, t1: B }),
      desc({ a: POOL2, t0: A, t1: C }),
    ]);
    expectPoolReserves(reserves, 'QuickSwapV4');
    expect(reserves.map(r => [r.id, r.reserves])).toEqual([
      [POOL, { [A]: '1', [B]: '2' }],
      [POOL2, { [A]: '3', [C]: '4' }],
    ]);
    expect(tryAggregate.mock.calls[0][1]).toHaveLength(2);
  });
});

// The storages are owned by the instances that price and serve reserves:
// the writer starts on slaves only, the master keeps its other duties.
describe('pool reserves fixtures: writer runs on slaves only', () => {
  type Case = {
    name: string;
    build: (dexHelper: DummyDexHelper) => any;
    stub: (dex: any, calls: string[]) => void;
  };
  const cases: Case[] = [
    {
      name: 'EkuboV3',
      build: h => new EkuboV3(Network.MAINNET, 'EkuboV3', h),
      stub: dex => {
        dex.poolManager.updatePools = async () => {};
      },
    },
    {
      name: 'MaverickV2',
      build: h => new MaverickV2(Network.BASE, 'MaverickV2', h),
      stub: dex => {
        dex._queryPoolsAPI = async () => [];
      },
    },
    {
      name: 'Algebra',
      build: h => new Algebra(Network.POLYGON, 'QuickSwapV3', h),
      stub: dex => {
        dex.factory.initialize = async () => {};
      },
    },
    {
      name: 'AlgebraIntegral',
      build: h => new AlgebraIntegral(Network.BASE, 'QuickSwapV4', h),
      stub: (dex, calls) => {
        dex.factory = {
          initialize: async () => {},
          getAllPools: () => [],
          updatePoolsTvl: async () => {
            calls.push('updatePoolsTvl');
          },
        };
        dex.updateAllPoolFees = async () => {};
      },
    },
  ];

  for (const { name, build, stub } of cases) {
    for (const isSlave of [false, true]) {
      it(`${name}: ${
        isSlave ? 'slave starts' : 'master does not start'
      } the writer`, async () => {
        const dexHelper = new DummyDexHelper(Network.MAINNET);
        dexHelper.config.isSlave = isSlave;
        const dex = build(dexHelper);
        const calls: string[] = [];
        stub(dex, calls);
        const start = jest
          .spyOn(dex.poolsWriter, 'start')
          .mockImplementation(() => calls.push('start'));
        try {
          await dex.initializePricing(1);
          expect(start).toHaveBeenCalledTimes(isSlave ? 1 : 0);
          if (isSlave && name === 'AlgebraIntegral') {
            // the first publication must see the refreshed TVL cut
            expect(calls).toEqual(['updatePoolsTvl', 'start']);
          }
        } finally {
          dex.releaseResources();
        }
      });
    }
  }

  it('Algebra publishes lazily discovered pools every minute', () => {
    const dex = new Algebra(
      Network.POLYGON,
      'QuickSwapV3',
      new DummyDexHelper(Network.POLYGON),
    ) as any;
    expect(dex.poolsWriter.flushIntervalMs).toEqual(60 * 1000);
  });
});
