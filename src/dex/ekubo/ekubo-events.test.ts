/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import {
  findNearestInitializedTickIndex,
  PoolConfig,
  PoolKey,
  PoolState,
} from './pools/pool-utils';
import { EkuboConfig } from './config';
import { Contract } from 'ethers';
import CoreABI from '../../abi/ekubo/core.json';
import DataFetcherABI from '../../abi/ekubo/data-fetcher.json';
import { Interface } from '@ethersproject/abi';
import { BasePool } from './pools/base-pool';
import { OraclePool } from './pools/oracle-pool';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  pool: BasePool,
  blockNumber: number,
): Promise<PoolState.Object> {
  return pool.generateState(blockNumber) as Promise<PoolState.Object>;
}

type EventMappings = Record<
  string,
  [
    {
      pool: typeof BasePool;
      key: PoolKey;
    }[],
    number,
  ][]
>;

function stateCompare(actual: PoolState.Object, expected: PoolState.Object) {
  const [lowCheckedTickActual, highCheckedTickActual] =
    actual.checkedTicksBounds;
  const [lowCheckedTickExpected, highCheckedTickExpected] =
    expected.checkedTicksBounds;

  const [sameLowCheckedTicks, sameHighCheckedTicks] = [
    lowCheckedTickActual === lowCheckedTickExpected,
    highCheckedTickActual === highCheckedTickExpected,
  ];

  if (sameLowCheckedTicks && sameHighCheckedTicks) {
    expect(actual).toStrictEqual(expected);
    return;
  }

  expect(actual.sqrtRatio).toStrictEqual(expected.sqrtRatio);
  expect(actual.activeTick).toStrictEqual(expected.activeTick);
  expect(actual.liquidity).toStrictEqual(expected.liquidity);

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
  ).toStrictEqual(
    expected.sortedTicks.slice(lowTickIndexExpected, highTickIndexExpected),
  );
}

const dexKey = 'Ekubo';

describe('Ekubo Mainnet', function () {
  const network = Network.MAINNET;
  const config = EkuboConfig[dexKey][network];
  const dexHelper = new DummyDexHelper(network);
  const core = new Contract(config.core, CoreABI, dexHelper.provider);
  const coreIface = new Interface(CoreABI);
  const dataFetcher = new Contract(
    config.dataFetcher,
    DataFetcherABI,
    dexHelper.provider,
  );
  const logger = dexHelper.getLogger(dexKey);

  const baseEthUsdcPoolKey = new PoolKey(
    0n,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(5982, 55340232221128654n, 0n),
  );

  const oracleUsdcPoolKey = new PoolKey(
    0n,
    0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
    new PoolConfig(0, 0n, BigInt(config.oracle)),
  );

  const eventsToTest: EventMappings = {
    Swapped: [
      [
        [
          {
            pool: BasePool,
            key: baseEthUsdcPoolKey,
          },
        ],
        22048500, // https://etherscan.io/tx/0xc401cc3007a2c0efd705c4c0dee5690ce8592858476b32cda8a4b000ceda0f24
      ],
      [
        [
          {
            pool: OraclePool,
            key: oracleUsdcPoolKey,
          },
        ],
        22063200, // https://etherscan.io/tx/0xe689fb49b9627504d014a9b4663a6f0ec38ebfdc5642e261bb4bcd229d58206d
      ],
    ],
  };

  Object.entries(eventsToTest).forEach(([eventName, eventDetails]) => {
    describe(eventName, () => {
      for (const [pools, blockNumber] of eventDetails) {
        describe(blockNumber, () => {
          for (const { pool: constructor, key } of pools) {
            it(`State of ${key.string_id}`, async function () {
              const pool = new constructor(
                dexKey,
                network,
                dexHelper,
                logger,
                coreIface,
                dataFetcher,
                key,
                core,
              );

              await testEventSubscriber(
                pool,
                pool.addressesSubscribed,
                (blockNumber: number) => fetchPoolState(pool, blockNumber),
                blockNumber,
                `${dexKey}_${pool.key.string_id}`,
                dexHelper.provider,
                stateCompare,
              );
            });
          }
        });
      }
    });
  });
});
