// npx jest src/dex/balancer-v3/balancer-hooks-events.test.ts
/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();
import _ from 'lodash';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import {
  BalancerEventHook,
  HookStateMap,
} from './hooks/balancer-hook-event-subscriber';

jest.setTimeout(50 * 1000);

async function fetchHookState(
  balancerEventHook: BalancerEventHook,
  blockNumber: number,
  hookAddress: string,
): Promise<HookStateMap> {
  const hookStateMap = await balancerEventHook.generateState(blockNumber);
  // Filter to hook of interest
  return Object.entries(_.cloneDeep(hookStateMap) as HookStateMap)
    .filter(([address]) => {
      return address.toLowerCase() === hookAddress.toLowerCase();
    })
    .reduce((acc, [address, pool]) => {
      acc[address] = pool;
      return acc;
    }, {} as HookStateMap);
}

// eventName -> blockNumbers
type EventMappings = Record<string, EventData>;
type EventData = { blockNumbers: number[]; hookAddress: string[] };

describe('BalancerEventHook', function () {
  const dexKey = 'BalancerV3';

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerEventHook: BalancerEventHook;

    // hook -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      ['StableSurgeHook']: {
        ThresholdSurgePercentageChanged: {
          blockNumbers: [
            21824387, 21825432, 21825615, 21825831, 21830728, 21830728,
          ],
          hookAddress: ['0xb18fA0cb5DE8cecB8899AAE6e38b1B7ed77885dA'],
        },
        MaxSurgeFeePercentageChanged: {
          blockNumbers: [
            21824387, 21825432, 21825615, 21825831, 21830728, 21830728,
          ],
          hookAddress: ['0xb18fA0cb5DE8cecB8899AAE6e38b1B7ed77885dA'],
        },
      },
    };

    beforeEach(async () => {
      balancerEventHook = new BalancerEventHook(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([hookAddress, events]: [string, EventMappings]) => {
        describe(`Events for Hook: ${hookAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Hook: ${eventData.hookAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerEventHook,
                      balancerEventHook.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchHookState(
                          balancerEventHook,
                          _blockNumber,
                          eventData.hookAddress[0],
                        ),
                      blockNumber,
                      `${dexKey}_${hookAddress}`,
                      dexHelper.provider,
                    );
                  });
                });
              });
            },
          );
        });
      },
    );
  });

  describe('SEPOLIA', () => {
    const network = Network.SEPOLIA;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerEventHook: BalancerEventHook;

    // hook -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      ['StableSurgeHook']: {
        // https://sepolia.etherscan.io/tx/0xa8d363d9c78b7b66e6f93c4417de67e636c13691437aecf85a631987b200abd8
        ThresholdSurgePercentageChanged: {
          blockNumbers: [7596856],
          hookAddress: ['0xC0cbcdD6b823A4f22aA6BbDDe44C17e754266AEF'],
        },
        // https://sepolia.etherscan.io/tx/0xd1a9e40ed3c3d32bf8f2264daa4c66879ac5eae1f4029ae9993badd653b26bad
        MaxSurgeFeePercentageChanged: {
          blockNumbers: [7596855],
          hookAddress: ['0xC0cbcdD6b823A4f22aA6BbDDe44C17e754266AEF'],
        },
      },
    };

    beforeEach(async () => {
      balancerEventHook = new BalancerEventHook(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([hookAddress, events]: [string, EventMappings]) => {
        describe(`Events for Hook: ${hookAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Hook: ${eventData.hookAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerEventHook,
                      balancerEventHook.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchHookState(
                          balancerEventHook,
                          _blockNumber,
                          eventData.hookAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${hookAddress}`,
                      dexHelper.provider,
                    );
                  });
                });
              });
            },
          );
        });
      },
    );
  });
});
