import { DexAdapterService } from './index';
import { PricingHelper } from '../pricing-helper';
import {
  FETCH_POOL_RESERVES_TIMEOUT,
  MAX_POOL_RESERVES_BATCH,
  UNLIMITED_RESERVES,
} from '../constants';
import { PoolReserves, PoolsStorageType } from '../types';
import { PoolReservesRequestError } from '../lib/pools-storage/reserves';
import { expectPoolReserves } from '../../tests/utils-pool-reserves';

const ADDR = '0x1111111111111111111111111111111111111111';
const T0 = '0x2222222222222222222222222222222222222222';
const T1 = '0x3333333333333333333333333333333333333333';

const storageDex = {
  getTopPoolsForToken: jest.fn(),
  getPoolsStorage: () => ({
    key: 'dl_1_StorageDex_pools',
    type: PoolsStorageType.RedisHash,
    fieldInValue: true,
  }),
  getPoolReserves: jest.fn(
    async (pools: string[]): Promise<PoolReserves[]> =>
      pools.map(p => ({
        dex: 'StorageDex',
        id: p,
        address: ADDR,
        reserves: { [T0]: '1', [T1]: '2' },
      })),
  ),
};

const enumeratedDex = {
  getTopPoolsForToken: jest.fn(),
  getPoolReserves: jest.fn(
    async (): Promise<PoolReserves[]> => [
      {
        dex: 'EnumDex',
        id: ADDR,
        address: ADDR,
        reserves: { [`${T0}_${T1}`]: UNLIMITED_RESERVES },
      },
    ],
  ),
};

const brokenStorageDex = {
  getTopPoolsForToken: jest.fn(),
  getPoolsStorage: () => {
    throw new Error('boom');
  },
  getPoolReserves: jest.fn(async (): Promise<PoolReserves[]> => []),
};

const nullStorageDex = {
  getTopPoolsForToken: jest.fn(),
  getPoolsStorage: () => null,
  getPoolReserves: jest.fn(async (): Promise<PoolReserves[]> => []),
};

const plainDex = { getTopPoolsForToken: jest.fn() };

// Constructing the real service instantiates every dex; only the lookup
// tables the reserves methods read are needed here.
const mkService = (): DexAdapterService => {
  const service = Object.create(
    DexAdapterService.prototype,
  ) as DexAdapterService;
  service.network = 1;
  service.dexHelper = {
    getLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }),
  } as any;
  service.dexKeys = [
    'StorageDex',
    'EnumDex',
    'NullStorageDex',
    'PlainDex',
    'BrokenStorageDex',
  ];
  service.legacyPoolTrackerDexKeys = [];
  service.dexInstances = {
    storagedex: storageDex as any,
    enumdex: enumeratedDex as any,
    nullstoragedex: nullStorageDex as any,
    plaindex: plainDex as any,
    brokenstoragedex: brokenStorageDex as any,
  };
  return service;
};

describe('DexAdapterService pool reserves', () => {
  let service: DexAdapterService;

  beforeEach(() => {
    service = mkService();
    jest.clearAllMocks();
  });

  it('getPoolsStorages lists only dexes with getPoolReserves and skips failing ones', () => {
    expect(service.getPoolsStorages()).toEqual({
      StorageDex: storageDex.getPoolsStorage(),
      EnumDex: null,
      NullStorageDex: null,
    });
  });

  it('rejects dexes without getPoolReserves', () => {
    expect(() => service.resolvePoolReservesCall('PlainDex')).toThrow(
      PoolReservesRequestError,
    );
    expect(() => service.resolvePoolReservesCall('Unknown')).toThrow(
      PoolReservesRequestError,
    );
  });

  describe('storage mode', () => {
    it('forwards pools', async () => {
      const res = await service.getPoolReservesByKey('storagedex', ['a', 'b']);
      expect(storageDex.getPoolReserves).toHaveBeenCalledWith(['a', 'b']);
      expect(res.map(r => r.id)).toEqual(['a', 'b']);
      expectPoolReserves(res, 'StorageDex');
    });

    it('requires pools', () => {
      expect(() => service.resolvePoolReservesCall('StorageDex')).toThrow(
        PoolReservesRequestError,
      );
      expect(storageDex.getPoolReserves).not.toHaveBeenCalled();
    });

    it('enforces the batch limit', async () => {
      const max = new Array(MAX_POOL_RESERVES_BATCH).fill('p');
      await service.getPoolReservesByKey('StorageDex', max);
      expect(() =>
        service.resolvePoolReservesCall('StorageDex', [...max, 'p']),
      ).toThrow(/batch limit/);
    });

    it('short-circuits an empty batch', async () => {
      expect(await service.getPoolReservesByKey('StorageDex', [])).toEqual([]);
      expect(storageDex.getPoolReserves).not.toHaveBeenCalled();
    });
  });

  describe('enumerated mode', () => {
    it('calls getPoolReserves without arguments', async () => {
      const res = await service.getPoolReservesByKey('EnumDex');
      expect(enumeratedDex.getPoolReserves).toHaveBeenCalledWith();
      expectPoolReserves(res, 'EnumDex');
    });

    it('treats a null storage like an absent one', async () => {
      await service.getPoolReservesByKey('NullStorageDex');
      expect(nullStorageDex.getPoolReserves).toHaveBeenCalledWith();
    });

    it('rejects pools', () => {
      expect(() => service.resolvePoolReservesCall('EnumDex', [])).toThrow(
        PoolReservesRequestError,
      );
      expect(() => service.resolvePoolReservesCall('EnumDex', ['a'])).toThrow(
        PoolReservesRequestError,
      );
    });
  });
});

describe('PricingHelper pool reserves', () => {
  const mkHelper = () => {
    const service = mkService();
    service.routeOptimizers = [];
    const logger = { error: jest.fn(), info: jest.fn() };
    const helper = new PricingHelper(service, () => logger as any);
    return { helper, logger };
  };

  beforeEach(() => jest.clearAllMocks());

  it('propagates request errors', async () => {
    const { helper } = mkHelper();
    await expect(helper.getPoolReserves('EnumDex', ['a'])).rejects.toThrow(
      PoolReservesRequestError,
    );
  });

  it('returns the dex result', async () => {
    const { helper } = mkHelper();
    const res = await helper.getPoolReserves('StorageDex', ['a']);
    expect(res).toHaveLength(1);
    expect(helper.getPoolsStorages().EnumDex).toBeNull();
  });

  it('swallows dex failures and logs them', async () => {
    const { helper, logger } = mkHelper();
    storageDex.getPoolReserves.mockRejectedValueOnce(new Error('rpc'));
    expect(await helper.getPoolReserves('StorageDex', ['a'])).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('swallows a throwing storage getter', async () => {
    const { helper, logger } = mkHelper();
    expect(await helper.getPoolReserves('BrokenStorageDex', ['a'])).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('times out a hanging dex', async () => {
    jest.useFakeTimers();
    try {
      const { helper, logger } = mkHelper();
      storageDex.getPoolReserves.mockImplementationOnce(
        () => new Promise(() => {}),
      );
      const pending = helper.getPoolReserves('StorageDex', ['a']);
      await jest.advanceTimersByTimeAsync(FETCH_POOL_RESERVES_TIMEOUT + 1);
      expect(await pending).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('expectPoolReserves', () => {
  const base = { dex: 'X', id: ADDR, address: ADDR };

  it('rejects mixed plain and directional keys', () => {
    expect(() =>
      expectPoolReserves(
        [{ ...base, reserves: { [T0]: '1', [`${T0}_${T1}`]: '2' } }],
        'X',
      ),
    ).toThrow();
  });

  it('rejects non-string values', () => {
    expect(() =>
      expectPoolReserves(
        [{ ...base, reserves: { [T0]: 1 as any, [T1]: '2' } }],
        'X',
      ),
    ).toThrow();
  });
});
