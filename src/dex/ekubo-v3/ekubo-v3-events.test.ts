/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testEventSubscriber } from '../../../tests/utils-events';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { DEX_KEY, TWAMM_ADDRESS } from './config';
import {
  BasePool,
  BasePoolState,
  findNearestInitializedTickIndex,
} from './pools/base';
import { EkuboPool } from './pools/pool';
import { TwammPool } from './pools/twamm';
import {
  ConcentratedPoolTypeConfig,
  PoolConfig,
  PoolKey,
  PoolTypeConfig,
  StableswapPoolTypeConfig,
} from './pools/utils';
import { ekuboContracts } from './utils';
import { Tokens } from '../../../tests/constants-e2e';

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

describe('Mainnet', function () {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const dexHelper = new DummyDexHelper(network);
  const contracts = ekuboContracts(dexHelper.provider);
  const logger = dexHelper.getLogger(DEX_KEY);

  const eth = 0n;
  const usdc = BigInt(tokens['USDC'].address);

  const clEthUsdcPoolKey = new PoolKey(
    eth,
    usdc,
    new PoolConfig(0n, 9223372036854775n, new ConcentratedPoolTypeConfig(1000)),
  );

  const twammEthUsdcPoolKey = new PoolKey(
    eth,
    usdc,
    new PoolConfig(
      BigInt(TWAMM_ADDRESS),
      55340232221128654n,
      StableswapPoolTypeConfig.fullRangeConfig(),
    ),
  );

  const commonArgs = [DEX_KEY, dexHelper, logger, contracts] as const;

  function newPool<C extends PoolTypeConfig, S>(
    constructor: {
      new (...args: [...typeof commonArgs, PoolKey<C>]): EkuboPool<C, S>;
    },
    poolKey: PoolKey<C>,
  ): AnyEkuboPool {
    return new constructor(...commonArgs, poolKey) as unknown as AnyEkuboPool;
  }

  const eventsToTest: EventMappings = {
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
  };

  Object.entries(eventsToTest).forEach(([eventName, eventDetails]) => {
    describe(eventName, () => {
      for (const [pool, blockNumber] of eventDetails) {
        test(`State of ${pool.key.stringId} at block ${blockNumber}`, async function () {
          await testEventSubscriber(
            pool,
            pool.addressesSubscribed,
            async (blockNumber: number) => pool.generateState(blockNumber),
            blockNumber,
            `${DEX_KEY}_${pool.key.stringId}`,
            dexHelper.provider,
            stateCompare,
          );
        });
      }
    });
  });
});
