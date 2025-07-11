/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { BunniV2EventPool } from './bunni-v2-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState, PoolStateMap } from './types';

async function fetchPoolState(
  bunniV2EventPool: BunniV2EventPool,
  blockNumber: number,
): Promise<PoolStateMap> {
  return (await bunniV2EventPool.generateState(blockNumber)) as PoolStateMap;
}

function compareState(poolState: PoolState, expectedPoolState: PoolState) {
  expect(poolState.id).toEqual(expectedPoolState.id);
  expect(poolState.key.currency0).toEqual(expectedPoolState.key.currency0);
  expect(poolState.key.currency1).toEqual(expectedPoolState.key.currency1);
  expect(poolState.key.fee).toEqual(expectedPoolState.key.fee);
  expect(poolState.key.tickSpacing).toEqual(expectedPoolState.key.tickSpacing);
  expect(poolState.key.hooks).toEqual(expectedPoolState.key.hooks);
}

describe('BunniV2 EventPool', function () {
  const dexKey = 'BunniV2';

  describe('MAINNET', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('ETH-BUNNI: 0x9148f00424c4b40a9ec4b03912f091138e9e91a60980550ed97ed7f9dc998cb5', function () {
      const poolId =
        '0x9148f00424c4b40a9ec4b03912f091138e9e91a60980550ed97ed7f9dc998cb5';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [21747679],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('USR-USDC: 0x77f73405a72f844e46d26a0bfd6f145c1a45ffcf6e4af5c86811405f29d2e615', function () {
      const poolId =
        '0x77f73405a72f844e46d26a0bfd6f145c1a45ffcf6e4af5c86811405f29d2e615';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [22409866],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('USD0-USD0++: 0x54ff1fd1d62f3bc6224082ecfdb3190a34e8428611b058ade19ce6c083cb608b', function () {
      const poolId =
        '0x54ff1fd1d62f3bc6224082ecfdb3190a34e8428611b058ade19ce6c083cb608b';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [22798113],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('BASE', function () {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('ETH-BUNNI: 0xc3011ab27d607decdc04ab317585dececaa91de749be8b46accb36e066d8f420', function () {
      const poolId =
        '0xc3011ab27d607decdc04ab317585dececaa91de749be8b46accb36e066d8f420';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [25955724],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });

    describe('ETH-USDC: 0x471931205b39f65dcf1c063761c098f7b29237af4059533e246a3545929156ed', function () {
      const poolId =
        '0x471931205b39f65dcf1c063761c098f7b29237af4059533e246a3545929156ed';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [31789456],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('ARBITRUM', function () {
    const network = Network.ARBITRUM;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('ETH-BUNNI: 0xc3011ab27d607decdc04ab317585dececaa91de749be8b46accb36e066d8f420', function () {
      const poolId =
        '0xc3011ab27d607decdc04ab317585dececaa91de749be8b46accb36e066d8f420';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [302660040],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('BSC', function () {
    const network = Network.BSC;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('WETH-DOT: 0x48323603dde908bfbd512c4c723e28ea9c7ee7f5558f7bcc9cafa798c039b9bd', function () {
      const poolId =
        '0x48323603dde908bfbd512c4c723e28ea9c7ee7f5558f7bcc9cafa798c039b9bd';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [51793861],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });

  describe('UNICHAIN', function () {
    const network = Network.UNICHAIN;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let bunniV2Pool: BunniV2EventPool;

    beforeEach(async () => {
      bunniV2Pool = new BunniV2EventPool(dexKey, network, dexHelper, logger);
    });

    describe('USDC-USD₮0: 0xeec51c6b1a9e7c4bb4fc4fa9a02fc4fff3fe94efd044f895d98b5bfbd2ff9433', function () {
      const poolId =
        '0xeec51c6b1a9e7c4bb4fc4fa9a02fc4fff3fe94efd044f895d98b5bfbd2ff9433';

      const eventsToTest: { [eventName: string]: number[] } = {
        ['Initialize']: [18417146],
      };

      const stateCompare = (
        state: PoolStateMap,
        expectedState: PoolStateMap,
      ) => {
        const poolState = state[poolId];
        const expectedPoolState = expectedState[poolId];
        poolState
          ? compareState(poolState, expectedPoolState)
          : expect(poolState).toEqual(expectedPoolState);
      };

      Object.keys(eventsToTest).forEach((event: string) => {
        eventsToTest[event].forEach(blockNumber => {
          it(`${event}:${blockNumber} - should return correct state`, async function () {
            await testEventSubscriber(
              bunniV2Pool,
              bunniV2Pool.addressesSubscribed,
              (_blockNumber: number) =>
                fetchPoolState(bunniV2Pool, _blockNumber),
              blockNumber,
              `${dexKey}_${poolId}`,
              dexHelper.provider,
              stateCompare,
            );
          });
        });
      });
    });
  });
});
