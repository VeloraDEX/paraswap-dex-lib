import dotenv from 'dotenv';

dotenv.config();

import { DeepReadonly } from 'ts-essentials';
import { WombatPool } from './wombat-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper';
import { BmwState, PoolState } from './types';
import { WombatConfig } from './config';
import { Wombat } from './wombat';
import { WombatBmw } from './wombat-bmw';
import { testEventSubscriber } from '../../../tests/utils-events';

jest.setTimeout(100 * 1000);

async function fetchPoolState(
  wombatPool: WombatPool,
  blockNumber: number,
): Promise<DeepReadonly<PoolState>> {
  return await wombatPool.generateState(blockNumber);
}

async function fetchBmwState(
  wombatBmw: WombatBmw,
  blockNumber: number,
): Promise<DeepReadonly<BmwState>> {
  return await wombatBmw.generateState(blockNumber);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Wombat EventPool BSC', function () {
  const dexKey = 'Wombat';
  const network = Network.BSC;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  const v2Pool = '0x9498563e47D7CFdFa22B818bb8112781036c201C'; // stable guild pool
  const v3Pool = '0x1ee15673e07105Bcf360139fa8CafeBDd7754BeF'; // cross chain pool
  const eventsToTest: Record<Address, EventMappings> = {
    [v2Pool]: {
      // topic0: 0xf5dd9317b9e63ac316ce44acc85f670b54b339cfa3e9076e1dd55065b922314b
      ['Deposit']: [34556359, 34556365, 34558365],
      // topic0: 0xfb80d861da582b723be2d19507ce3e03851820c464abea89156ec77e089b1ad9
      ['Withdraw']: [34208250, 34262795, 34549292],
      // topic0: 0x54787c404bb33c88e86f4baf88183a3b0141d0a848e6a9f7a13b66ae3a9b73d1
      ['Swap']: [34588909, 34590323, 34593343, 34600568, 34602207],
      ['SetAmpFactor']: [],
      ['SetHaircutRate']: [],
      // topic0: 0x0bb5715f0f217c2fe9a0c877ea87d474380c641102f3440ee2a4c8b9d9790918
      ['AssetAdded']: [28050075],
      // topic0: 0x0fa1e4606af435f32f05b3804033d2933e691fab32ee74d2db6fa82d2741f1ea
      ['AssetRemoved']: [34463362],
      // topic0: 0x4941e18a2bcbb0f9fa0081238f26793a8ad8c202b913ae8bf5f7e523f68ff137
      ['FillPool']: [],
      ['Paused']: [34342956],
      // topic0: 0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa
      ['Unpaused']: [34463362],
      // topic0: 0xdcb65c0553aaa433aadd180404ff195259c48f78aa50f877ebcb4bb215129a4e
      ['PausedAsset']: [34463362],
      ['UnpausedAsset']: [],
    },
    [v3Pool]: {
      // topic0: 0xf5dd9317b9e63ac316ce44acc85f670b54b339cfa3e9076e1dd55065b922314b
      ['Deposit']: [34558302, 34564573, 34597601],
      // topic0: 0xfb80d861da582b723be2d19507ce3e03851820c464abea89156ec77e089b1ad9
      ['Withdraw']: [34567962, 34569797, 34596990],
      // topic0: 0x7fa01e8d24e5a6ec56e00b4ff8ee7ed97e7650a7846ec494bbaa5d65f1be9ea4
      ['SwapV2']: [
        64528172, 64528566, 64528172, 64530364, 64530424, 64531361, 64531362,
        64538137, 64569313, 64573375,
      ],
      // topic0: 0x0fa1e4606af435f32f05b3804033d2933e691fab32ee74d2db6fa82d2741f1ea
      ['AssetRemoved']: [34463362],
      // topic0: 0x5f22a22ebe30686f71d42a70ccacf870a335e22ee2ac6d257af1b2551582eda6
      ['TransferTipBucket']: [44227406],
    },
  };

  for (const [poolAddress, events] of Object.entries(eventsToTest)) {
    describe(`Events for ${poolAddress}`, () => {
      for (const [eventName, blockNumbers] of Object.entries(events)) {
        describe(`${eventName}`, () => {
          for (const blockNumber of blockNumbers) {
            it(`State after ${blockNumber}`, async function () {
              const wombatPool = new WombatPool(
                dexKey,
                poolAddress,
                network,
                dexHelper,
                logger,
                poolAddress.toLowerCase(),
              );
              await wombatPool.initialize(blockNumber - 1);

              await testEventSubscriber(
                wombatPool,
                wombatPool.addressesSubscribed,
                (_blockNumber: number) =>
                  fetchPoolState(wombatPool, _blockNumber),
                blockNumber,
                `${dexKey}_${poolAddress}`,
                dexHelper.provider,
              );
            });
          }
        });
      }
    });
  }
});
describe('Wombat BMW ARB', function () {
  const dexKey = 'Wombat';
  const network = Network.ARBITRUM;
  const dexHelper = new DummyDexHelper(network);
  const bmwAddress = WombatConfig.Wombat[network].bmwAddress;
  const eventsToTest: Record<Address, EventMappings> = {
    [bmwAddress]: {
      // topic0: 0xec85b1d1f037ff3a8722aaf5d4d8e7d93c7ff10c056430c18d76a9ec23aa397e
      ['Add']: [158157042, 162173973],
    },
  };

  const wombat = new Wombat(network, dexKey, dexHelper);

  for (const [poolAddress, events] of Object.entries(eventsToTest)) {
    describe(`Events for ${poolAddress}`, () => {
      for (const [eventName, blockNumbers] of Object.entries(events)) {
        describe(`${eventName}`, () => {
          for (const blockNumber of blockNumbers) {
            it(`State after ${blockNumber}`, async function () {
              if (wombat.initializePricing) {
                await wombat.initializePricing(blockNumber);
              }
              await testEventSubscriber(
                wombat.bmw,
                wombat.bmw.addressesSubscribed,
                (_blockNumber: number) =>
                  fetchBmwState(wombat.bmw, _blockNumber),
                blockNumber,
                `${dexKey}_${bmwAddress}`,
                dexHelper.provider,
              );
            });
          }
        });
      }
    });
  }
});
