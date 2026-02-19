import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { Network } from '../../constants';
import {
  EkuboV3PoolManager,
  PoolInitialization,
  SubgraphData,
} from './ekubo-v3-pool-manager';
import { DEX_KEY, EKUBO_V3_CONFIG } from './config';
import { ekuboContracts } from './utils';
import { IDexHelper } from '../../dex-helper';

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
