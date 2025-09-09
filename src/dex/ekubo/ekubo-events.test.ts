/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testEventSubscriber } from '../../../tests/utils-events';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { DEX_KEY, EKUBO_CONFIG } from './config';
import {
  BasePool,
  BasePoolState,
  findNearestInitializedTickIndex,
} from './pools/base';
import { EkuboPool } from './pools/pool';
import { OraclePool } from './pools/oracle';
import { TwammPool } from './pools/twamm';
import { PoolConfig, PoolKey } from './pools/utils';
import { contractsFromDexParams } from './utils';
import { MevResistPool } from './pools/mev-resist';
import { FullRangePool } from './pools/full-range';

jest.setTimeout(50 * 1000);

type EventMappings = Record<string, [EkuboPool<unknown>, number][]>;

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
  const dexHelper = new DummyDexHelper(network);
  const config = EKUBO_CONFIG[DEX_KEY][network];
  const contracts = contractsFromDexParams(config, dexHelper.provider);
  const logger = dexHelper.getLogger(DEX_KEY);

  const baseEthUsdcPoolKey = new PoolKey(
    0n,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(0n, 55340232221128654n, 5982),
  );

  const baseUsdeUsdcPoolKey = new PoolKey(
    0x4c9edd5852cd905f086c759e8383e09bff1e68b3n,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(0n, 922337203685478n, 100),
  );

  const fullRangeUsdcPepePoolKey = new PoolKey(
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    0xd663ce0c9f55968b42837954348eafeb5b9e5d82n,
    new PoolConfig(0n, 55340232221128654n, 0),
  );

  const fullRangeEthSuccinctPoolKey = new PoolKey(
    0n,
    0x6bef15d938d4e72056ac92ea4bdd0d76b1c4ad29n,
    new PoolConfig(0n, 55340232221128655n, 0),
  );

  const oracleUsdcPoolKey = new PoolKey(
    0n,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(BigInt(config.oracle), 0n, 0),
  );

  const oracleEkuboPoolKey = new PoolKey(
    0n,
    0x04c46e830bb56ce22735d5d8fc9cb90309317d0fn,
    new PoolConfig(BigInt(config.oracle), 0n, 0),
  );

  const twammEthUsdcPoolKey = new PoolKey(
    0n,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(BigInt(config.twamm), 9223372036854775n, 0),
  );

  const twammEkuboUsdcPoolKey = new PoolKey(
    0x04c46e830bb56ce22735d5d8fc9cb90309317d0fn,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(BigInt(config.twamm), 18446744073709551n, 0),
  );

  const mevResistEkuboEbUsdPoolKey = new PoolKey(
    0x04c46e830bb56ce22735d5d8fc9cb90309317d0fn,
    0x09fd37d9aa613789c517e76df1c53aece2b60df4n,
    new PoolConfig(BigInt(config.mevResist), 1844674407370955n, 500),
  );

  const mevResistEkuboBoldPoolKey = new PoolKey(
    0x04c46e830bb56ce22735d5d8fc9cb90309317d0fn,
    0x6440f144b7e50d6a8439336510312d2f54beb01dn,
    new PoolConfig(BigInt(config.mevResist), 18446744073709552n, 1998),
  );

  const commonArgs = [DEX_KEY, dexHelper, logger, contracts] as const;

  function newPool<S>(
    constructor: {
      new (...args: [...typeof commonArgs, PoolKey]): EkuboPool<S>;
    },
    poolKey: PoolKey,
  ): EkuboPool<unknown> {
    return new constructor(...commonArgs, poolKey) as EkuboPool<unknown>;
  }

  const eventsToTest: EventMappings = {
    Swapped: [
      [
        newPool(BasePool, baseEthUsdcPoolKey),
        22048500, // https://etherscan.io/tx/0xc401cc3007a2c0efd705c4c0dee5690ce8592858476b32cda8a4b000ceda0f24
      ],
      [
        newPool(FullRangePool, fullRangeUsdcPepePoolKey),
        23120679, // https://etherscan.io/tx/0xfd4e81b1db971e6a2d80e395df816ea7f164a1ef71daae64a0bb528c1ccb2038
      ],
      [
        newPool(OraclePool, oracleUsdcPoolKey),
        22063200, // https://etherscan.io/tx/0xe689fb49b9627504d014a9b4663a6f0ec38ebfdc5642e261bb4bcd229d58206d
      ],
      [
        newPool(TwammPool, twammEthUsdcPoolKey),
        22281995, // https://etherscan.io/tx/0xc3ad7616eb5c9aeef51a49e2ce9c945778387f3110f9f66916f38db4d551ac05
      ],
      [
        newPool(MevResistPool, mevResistEkuboEbUsdPoolKey),
        23121533, // https://etherscan.io/tx/0xeab6fdc4a5ced72796e515f340fa0399746f882dffdfac8c3c8a8a12f1292e76
      ],
    ],
    PositionUpdated: [
      [
        newPool(BasePool, baseUsdeUsdcPoolKey),
        23121814, // https://etherscan.io/tx/0xc571546f092abcd1b6d7415baaa1502d43c97a8206f7c098f82f7c74cd72f15a
      ],
      [
        newPool(FullRangePool, fullRangeEthSuccinctPoolKey),
        23080659, // https://etherscan.io/tx/0x4e264a2a4a1fd258679f04fe7c62a6eb9ce67e8fd75e9b7f4bf98e22e165d276
      ],
      [
        newPool(OraclePool, oracleEkuboPoolKey),
        22066527, // https://etherscan.io/tx/0x25ba71bfc4d5ee6b72ed03b28cdf99d540bed49d65b12ed2cb781528d58ef3d5
      ],
      [
        newPool(TwammPool, twammEkuboUsdcPoolKey),
        22961786, // https://etherscan.io/tx/0x20c941fb356d787fce4998588d753ae311a8fed8d48ad55e2b940cf302f4ff6d
      ],
      [
        newPool(MevResistPool, mevResistEkuboBoldPoolKey),
        23120060, // https://etherscan.io/tx/0x9d40d6bea754800683783caf42dca60acfcc8e0e5abecd9f3658ba71f7e08935
      ],
    ],
    OrderUpdated: [
      [
        newPool(TwammPool, twammEthUsdcPoolKey),
        22232621, // https://etherscan.io/tx/0x99479c8426fb328ec3245c625fb7edfbb4bb4dd2a2fbfcd027fc513962cca193
      ],
    ],
    VirtualOrdersExecuted: [
      [
        newPool(TwammPool, twammEthUsdcPoolKey),
        22995949, // https://etherscan.io/tx/0xbc9390f6712296bceed6efa909e61f943fbf897412d3cd8d491120706fadcde1
      ],
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
