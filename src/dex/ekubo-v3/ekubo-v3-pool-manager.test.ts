import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { BigNumber } from 'ethers';
import { Network } from '../../constants';
import {
  EkuboV3PoolManager,
  PoolInitialization,
  SubgraphData,
} from './ekubo-v3-pool-manager';
import { DEX_KEY, EKUBO_V3_CONFIG, VE33_ADDRESS } from './config';
import { ekuboContracts } from './utils';
import { IDexHelper } from '../../dex-helper';
import { PoolConfig, PoolKey, StableswapPoolTypeConfig } from './pools/utils';
import { VE33_MIN_BITMAPS_SEARCHED } from './pools/ve33';

const hex16 = (n: number) => `0x${n.toString(16).padStart(32, '0')}`;

const makePoolInitialization = (
  n: number,
  blockHash = '0xabc',
): PoolInitialization => ({
  id: hex16(n),
  blockNumber: '100',
  blockHash,
  tickSpacing: 100,
  stableswapCenterTick: null,
  stableswapAmplification: null,
  extension: '0x0',
  fee: '1',
  poolId: `0x${n.toString(16)}`,
  token0: '0x1',
  token1: '0x2',
});

const makePage = (start: number, count: number, blockHash?: string) =>
  Array.from({ length: count }, (_, i) =>
    makePoolInitialization(start + i, blockHash),
  );

const makeTestCtx = () => {
  const provider = new StaticJsonRpcProvider('http://127.0.0.1:8545', 1);
  const querySubgraph = jest.fn<Promise<SubgraphData>, any[]>();
  const subscribeToLogs = jest.fn();

  const dexHelper = {
    provider,
    config: { isSlave: true },
    httpRequest: { querySubgraph },
    blockManager: { subscribeToLogs },
  } as unknown as IDexHelper;

  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any;

  return {
    dexHelper,
    contracts: ekuboContracts(provider),
    logger,
    querySubgraph,
  };
};

describe('EkuboV3PoolManager subgraph pagination', () => {
  const network = Network.MAINNET;
  const subgraphId = EKUBO_V3_CONFIG[DEX_KEY][network].subgraphId;

  test('fetches multiple pages with id cursor continuity', async () => {
    const { dexHelper, contracts, logger, querySubgraph } = makeTestCtx();
    const manager = new EkuboV3PoolManager(
      DEX_KEY,
      logger,
      dexHelper,
      contracts,
      subgraphId,
    );

    const firstPage = makePage(1, 1000, '0xaaa');
    const secondPage = [firstPage[999], ...makePage(1001, 2, '0xbbb')];

    querySubgraph
      .mockResolvedValueOnce({
        data: {
          _meta: { block: { number: 200, hash: '0xmeta' } },
          poolInitializations: firstPage,
        },
      })
      .mockResolvedValueOnce({
        data: {
          _meta: { block: { number: 200, hash: '0xmeta' } },
          poolInitializations: secondPage,
        },
      });

    const blockSpy = jest
      .spyOn(dexHelper.provider, 'getBlock')
      .mockResolvedValue({} as any);

    const res = await (manager as any).fetchCanonicalSubgraphPoolKeys(
      300,
      false,
    );

    expect(res.poolKeysRes).not.toBeInstanceOf(Error);
    expect((res.poolKeysRes as unknown[]).length).toBe(1002);
    expect(querySubgraph).toHaveBeenCalledTimes(2);
    expect(blockSpy).toHaveBeenCalledWith('0xmeta');
  });

  test('returns Error when page cursor continuity breaks', async () => {
    const { dexHelper, contracts, logger, querySubgraph } = makeTestCtx();
    const manager = new EkuboV3PoolManager(
      DEX_KEY,
      logger,
      dexHelper,
      contracts,
      subgraphId,
    );

    const firstPage = makePage(1, 1000, '0xaaa');
    const secondPage = [makePoolInitialization(999, '0xDIFF')];

    querySubgraph
      .mockResolvedValueOnce({
        data: {
          _meta: { block: { number: 200, hash: '0xmeta' } },
          poolInitializations: firstPage,
        },
      })
      .mockResolvedValueOnce({
        data: {
          _meta: { block: { number: 200, hash: '0xmeta' } },
          poolInitializations: secondPage,
        },
      });

    const blockSpy = jest.spyOn(dexHelper.provider, 'getBlock');

    const res = await (manager as any).fetchCanonicalSubgraphPoolKeys(
      300,
      false,
    );

    expect(res.poolKeysRes).toBeInstanceOf(Error);
    expect((res.poolKeysRes as Error).message).toContain(
      'cursor continuity check failed',
    );
    expect(blockSpy).not.toHaveBeenCalled();
  });

  test('returns Error when subgraph request throws', async () => {
    const { dexHelper, contracts, logger, querySubgraph } = makeTestCtx();
    const manager = new EkuboV3PoolManager(
      DEX_KEY,
      logger,
      dexHelper,
      contracts,
      subgraphId,
    );

    querySubgraph.mockRejectedValue(new Error('boom'));

    const res = await (manager as any).fetchCanonicalSubgraphPoolKeys(
      300,
      false,
    );

    expect(res.poolKeysRes).toBeInstanceOf(Error);
    expect((res.poolKeysRes as Error).message).toBe(
      'Subgraph pool key retrieval failed',
    );
  });
});

describe('EkuboV3PoolManager Ve33 initialization', () => {
  test('fetches the dynamic fee and uses consistent bitmap depth on regeneration', async () => {
    const { dexHelper, contracts, logger } = makeTestCtx();
    const manager = new EkuboV3PoolManager(
      DEX_KEY,
      logger,
      dexHelper,
      contracts,
      EKUBO_V3_CONFIG[DEX_KEY][Network.ROBINHOOD].subgraphId,
    );
    const getVe33QuoteData = jest.fn().mockResolvedValue([
      {
        quoteData: {
          tick: 0,
          sqrtRatio: BigNumber.from(0),
          liquidity: BigNumber.from(1_000_000),
          minTick: 0,
          maxTick: 0,
          ticks: [],
        },
        swapFee: BigNumber.from(123),
      },
    ]);
    contracts.ve33.quoteDataFetcher = {
      getVe33QuoteData,
    } as any;

    const poolKeys = [
      new PoolKey(
        1n,
        2n,
        new PoolConfig(
          BigInt(VE33_ADDRESS),
          0n,
          StableswapPoolTypeConfig.fullRangeConfig(),
        ),
      ),
      new PoolKey(
        1n,
        3n,
        new PoolConfig(
          BigInt(VE33_ADDRESS),
          0n,
          new StableswapPoolTypeConfig(0, 1),
        ),
      ),
    ];

    for (const poolKey of poolKeys) {
      await (manager as any).handlePoolInitialized(
        { poolKey: poolKey.toAbi(), sqrtRatio: 0n, tick: 0 },
        { number: 123 },
      );

      const pool = manager.poolsByBI.get(poolKey.numId);
      expect(pool).toBeDefined();
      expect((pool as any).getState(123).swapFee).toBe(123n);
      await pool!.updateState(124);
    }

    expect(getVe33QuoteData).toHaveBeenCalledTimes(4);
    for (const call of getVe33QuoteData.mock.calls) {
      expect(call[1]).toBe(VE33_MIN_BITMAPS_SEARCHED);
    }
    expect(getVe33QuoteData.mock.calls.map(call => call[2])).toEqual([
      { blockTag: 123 },
      { blockTag: 124 },
      { blockTag: 123 },
      { blockTag: 124 },
    ]);
  });
});
