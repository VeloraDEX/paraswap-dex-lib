/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import {
  getOrFetchBlockInfo,
  getOrFetchState,
} from '../../../tests/utils-events';
import { Network } from '../../constants';
import { generateConfig } from '../../config';
import { DummyDexHelper, IDexHelper } from '../../dex-helper/index';
import {
  DEX_KEY,
  EKUBO_V3_CONFIG,
  EkuboSupportedNetwork,
  TWAMM_ADDRESS,
} from './config';
import {
  BasePool,
  BasePoolState,
  findNearestInitializedTickIndex,
} from './pools/base';
import { EkuboPool } from './pools/pool';
import { TwammPool } from './pools/twamm';
import {
  ConcentratedPoolTypeConfig,
  EkuboPoolKey,
  PoolConfig,
  PoolKey,
  PoolTypeConfig,
  StableswapPoolTypeConfig,
} from './pools/utils';
import { ekuboContracts } from './utils';
import { Tokens } from '../../../tests/constants-e2e';
import { EkuboV3PoolManager } from './ekubo-v3-pool-manager';
import { EkuboContracts } from './types';
import { Logger, Token } from '../../types';

jest.setTimeout(50 * 1000);

type AnyEkuboPool = EkuboPool<PoolTypeConfig, unknown>;
type EventMappings = Record<string, [AnyEkuboPool, number][]>;

// Rather incomplete but only used for tests
function isBasePoolState(value: unknown): value is BasePoolState.Object {
  return typeof value === 'object' && value !== null && 'sortedTicks' in value;
}

function stateCompare(actual: unknown, expected: unknown) {
  if (!isBasePoolState(actual) || !isBasePoolState(expected)) {
    expect(actual).toEqual(expected);
    return;
  }

  const [lowCheckedTickActual, highCheckedTickActual] =
    actual.checkedTicksBounds;
  const [lowCheckedTickExpected, highCheckedTickExpected] =
    expected.checkedTicksBounds;

  const [sameLowCheckedTicks, sameHighCheckedTicks] = [
    lowCheckedTickActual === lowCheckedTickExpected,
    highCheckedTickActual === highCheckedTickExpected,
  ];

  if (sameLowCheckedTicks && sameHighCheckedTicks) {
    expect(actual).toEqual(expected);
    return;
  }

  expect(actual.sqrtRatio).toBe(expected.sqrtRatio);
  expect(actual.activeTick).toBe(expected.activeTick);
  expect(actual.liquidity).toBe(expected.liquidity);

  /**
   * The checked tick ranges differ between the two states at this point.
   * In order to still compare the tick arrays, we thus have to exclude the liquidity cutoff ticks
   * from the comparison (if they differ), as well as any other ticks that could've only
   * been discovered in one of the two checked tick ranges.
   */

  let lowTickIndexActual: number, lowTickIndexExpected: number;

  if (sameLowCheckedTicks) {
    [lowTickIndexActual, lowTickIndexExpected] = [0, 0];
  } else if (lowCheckedTickActual > lowCheckedTickExpected) {
    lowTickIndexActual = 1;
    lowTickIndexExpected =
      findNearestInitializedTickIndex(
        expected.sortedTicks,
        lowCheckedTickActual,
      )! + 1;
  } else {
    lowTickIndexExpected = 1;
    lowTickIndexActual =
      findNearestInitializedTickIndex(
        actual.sortedTicks,
        lowCheckedTickExpected,
      )! + 1;
  }

  let highTickIndexActual: number, highTickIndexExpected: number;

  if (sameHighCheckedTicks) {
    [highTickIndexActual, highTickIndexExpected] = [
      actual.sortedTicks.length,
      expected.sortedTicks.length,
    ];
  } else if (highCheckedTickActual > highCheckedTickExpected) {
    highTickIndexExpected = expected.sortedTicks.length - 1;

    let tickIndex = findNearestInitializedTickIndex(
      actual.sortedTicks,
      highCheckedTickExpected,
    )!;
    highTickIndexActual =
      actual.sortedTicks[tickIndex].number === highCheckedTickExpected
        ? tickIndex
        : tickIndex + 1;
  } else {
    highTickIndexActual = actual.sortedTicks.length - 1;

    let tickIndex = findNearestInitializedTickIndex(
      expected.sortedTicks,
      highCheckedTickActual,
    )!;
    highTickIndexExpected =
      expected.sortedTicks[tickIndex].number === highCheckedTickActual
        ? tickIndex
        : tickIndex + 1;
  }

  expect(
    actual.sortedTicks.slice(lowTickIndexActual, highTickIndexActual),
  ).toEqual(
    expected.sortedTicks.slice(lowTickIndexExpected, highTickIndexExpected),
  );
}

let commonArgs: [string, IDexHelper, Logger, EkuboContracts, number];

function newPool<C extends PoolTypeConfig, S>(
  constructor: {
    new (
      dexKey: string,
      dexHelper: IDexHelper,
      logger: Logger,
      contracts: EkuboContracts,
      initBlockNumber: number,
      poolKey: PoolKey<C>,
    ): EkuboPool<C, S>;
  },
  poolKey: PoolKey<C>,
): AnyEkuboPool {
  return new constructor(...commonArgs, poolKey) as AnyEkuboPool;
}

const NATIVE_TOKEN_ADDRESS = 0n;

const eventFixtures: Record<
  EkuboSupportedNetwork,
  (tokens: { [symbol: string]: Token }) => {
    poolStateEvents: EventMappings;
    poolInitializationEvent: {
      poolKey: EkuboPoolKey;
      initBlockNumber: number;
    };
  }
> = {
  [Network.MAINNET]: tokens => {
    const USDC = BigInt(tokens['USDC'].address);

    const clEthUsdcPoolKey = new PoolKey(
      NATIVE_TOKEN_ADDRESS,
      USDC,
      new PoolConfig(
        0n,
        9223372036854775n,
        new ConcentratedPoolTypeConfig(1000),
      ),
    );

    const twammEthUsdcPoolKey = new PoolKey(
      NATIVE_TOKEN_ADDRESS,
      USDC,
      new PoolConfig(
        BigInt(TWAMM_ADDRESS),
        55340232221128654n,
        StableswapPoolTypeConfig.fullRangeConfig(),
      ),
    );

    return {
      poolStateEvents: {
        Swapped: [
          [newPool(BasePool, clEthUsdcPoolKey), 24175246], // https://etherscan.io/tx/0xee56e1f3bad803bd857fb118e55d7eabb5368a94ae8f11e83724278f474294ca
          [newPool(TwammPool, twammEthUsdcPoolKey), 24175264], // https://etherscan.io/tx/0x01c02e32ac563e3a761382cb8ef278cfed9ed9dc758b5a95f38dd44978e87b2e
        ],
        PositionUpdated: [
          [newPool(BasePool, clEthUsdcPoolKey), 24169215], // Add liquidity https://etherscan.io/tx/0x52f469327de230f3da91eb7b77069852757d383450943307f5da63016476c0fb
          [newPool(BasePool, clEthUsdcPoolKey), 24169222], // Withdraw liquidity https://etherscan.io/tx/0x00cfe35092d58aab347abc58345878092f87d37c7f0f0126fb1c890c791cdc02
          [newPool(TwammPool, twammEthUsdcPoolKey), 24169228], // Add liquidity https://etherscan.io/tx/0x5fceec2c8fce56c7a73b8e3efca77f9ef8561b40a08b05785e9084cba684b5f8
          [newPool(TwammPool, twammEthUsdcPoolKey), 24169235], // Withdraw liquidity https://etherscan.io/tx/0x920f865071397a145e2e9558dfaedb7e138456d8fe43c1899187778a16b00c8b
        ],
        OrderUpdated: [
          [newPool(TwammPool, twammEthUsdcPoolKey), 24169245], // Create order https://etherscan.io/tx/0x67bb5ba44397d8b9d9ffe753e9c7f1b478eadfac22464a39521bdd3541f6a68f
          [newPool(TwammPool, twammEthUsdcPoolKey), 24169249], // Stop order https://etherscan.io/tx/0xde6812e959a49e245f15714d1b50571f43ca7711c91d2df1087178a38bc554b7
        ],
        VirtualOrdersExecuted: [
          [newPool(TwammPool, twammEthUsdcPoolKey), 24169245], // Create order https://etherscan.io/tx/0x67bb5ba44397d8b9d9ffe753e9c7f1b478eadfac22464a39521bdd3541f6a68f
          [newPool(TwammPool, twammEthUsdcPoolKey), 24169249], // Stop order https://etherscan.io/tx/0xde6812e959a49e245f15714d1b50571f43ca7711c91d2df1087178a38bc554b7
        ],
      },
      poolInitializationEvent: {
        poolKey: clEthUsdcPoolKey,
        initBlockNumber: 24134507, // https://etherscan.io/tx/0x2757427086944621c7fb8eca63a01809be4c76bb5b7b32596ced53d7fd17a691#eventlog#114
      },
    };
  },
  [Network.ARBITRUM]: tokens => {
    const USDC = BigInt(tokens['USDC'].address);

    const clEthUsdcPoolKey = new PoolKey(
      NATIVE_TOKEN_ADDRESS,
      USDC,
      new PoolConfig(
        0n,
        9223372036854775n,
        new ConcentratedPoolTypeConfig(1000),
      ),
    );

    return {
      poolStateEvents: {},
      poolInitializationEvent: {
        poolKey: clEthUsdcPoolKey,
        initBlockNumber: 418181209, // https://arbiscan.io/tx/0x08e71cc1efb9c6587d4eea02d1a340e266f263d3be83730be27a41a4aa696f99#eventlog#1
      },
    };
  },
};

Object.entries(eventFixtures).forEach(([networkStr, fixturesFactory]) => {
  const network = Number(networkStr);

  describe(generateConfig(network).networkName, function () {
    const tokens = Tokens[network];
    const dexHelper = new DummyDexHelper(network);
    const contracts = ekuboContracts(dexHelper.provider);
    const logger = dexHelper.getLogger(DEX_KEY);

    commonArgs = [DEX_KEY, dexHelper, logger, contracts, 0] as const;

    async function testLogStateUpdate(pool: AnyEkuboPool, blockNumber: number) {
      const cacheKey = `${DEX_KEY}_${networkStr}_${pool.key.stringId}`;
      const poolManager = new EkuboV3PoolManager(
        DEX_KEY,
        logger,
        dexHelper,
        contracts,
        EKUBO_V3_CONFIG[DEX_KEY][network].subgraphId,
      );

      // Seed pool state before the event so the update has a baseline.
      const priorState = await getOrFetchState(
        blockNumber - 1,
        cacheKey,
        async (blockNumber: number) => pool.generateState(blockNumber),
      );
      pool.setState(priorState, blockNumber - 1);
      pool.isTracking = () => true;

      poolManager.setPool(pool);

      const blockInfo = await getOrFetchBlockInfo(
        blockNumber,
        cacheKey,
        [contracts.core.contract.address, contracts.twamm.contract.address],
        dexHelper.provider,
      );

      await poolManager.update(blockInfo.logs, blockInfo.blockHeaders);

      const expectedState = await getOrFetchState(
        blockNumber,
        cacheKey,
        async (blockNumber: number) => pool.generateState(blockNumber),
      );
      const newState = pool.getState(blockNumber);

      stateCompare(newState, expectedState);
      expect(() => stateCompare(priorState, newState)).toThrow();
    }

    const fixtures = fixturesFactory(tokens);

    Object.entries(fixtures.poolStateEvents).forEach(
      ([eventName, eventDetails]) => {
        describe(eventName, () => {
          for (const [pool, blockNumber] of eventDetails) {
            test(`registers event at block ${blockNumber} for pool ${pool.key.stringId}`, async function () {
              await testLogStateUpdate(pool, blockNumber);
            });
          }
        });
      },
    );

    describe('PoolInitialized', () => {
      let poolManager: EkuboV3PoolManager;

      beforeEach(() => {
        poolManager = new EkuboV3PoolManager(
          DEX_KEY,
          logger,
          dexHelper,
          contracts,
          EKUBO_V3_CONFIG[DEX_KEY][network].subgraphId,
        );
      });

      const { initBlockNumber, poolKey } = fixtures.poolInitializationEvent;
      const cacheKey = `${DEX_KEY}_${networkStr}_${poolKey.stringId}`;

      test('adds a pool', async () => {
        const blockInfo = await getOrFetchBlockInfo(
          initBlockNumber,
          cacheKey,
          [contracts.core.contract.address],
          dexHelper.provider,
        );

        expect(poolManager.poolsByBI.size).toBe(0);

        await poolManager.update(blockInfo.logs, blockInfo.blockHeaders);

        expect(poolManager.poolsByBI.get(poolKey.numId)).toBeDefined();
        expect(poolManager.poolsByString.get(poolKey.stringId)).toBeDefined();
      });

      test('removes a pool on rollback past initialization', async () => {
        const blockInfo = await getOrFetchBlockInfo(
          initBlockNumber,
          cacheKey,
          [contracts.core.contract.address],
          dexHelper.provider,
        );

        await poolManager.update(blockInfo.logs, blockInfo.blockHeaders);

        expect(poolManager.poolsByBI.get(poolKey.numId)).toBeDefined();

        poolManager.rollback(initBlockNumber - 1);

        expect(poolManager.poolsByBI.get(poolKey.numId)).toBeUndefined();
        expect(poolManager.poolsByString.get(poolKey.stringId)).toBeUndefined();
      });
    });
  });
});
