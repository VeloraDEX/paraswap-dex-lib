/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { LunarBaseEventPool } from './lunar-base-pool';
import { LunarBasePoolState } from './types';

jest.setTimeout(120 * 1000);

// Blocks per pool and event. Swaps emit PunishmentApplied + Sync (+
// SwapExecuted); operators push StateUpdated almost every block.
type EventMappings = Record<string, number[]>;

const eventsToTest: Record<number, Record<string, EventMappings>> = {
  [Network.BASE]: {
    // ETH/USDC
    '0x0000efc4ec03a7c47d3a38a9be7ff1d52dd01b99': {
      StateUpdated: [52850005, 52850007, 52850009],
      'Swap (PunishmentApplied, Sync)': [52849863, 52849956],
      'StateUpdated + Swap': [52849785, 52849882, 52849938],
    },
  },
  [Network.BSC]: {
    // BNB/USDT
    '0x00007904d186680c709519e71f4dc3e2df8f1b99': {
      StateUpdated: [128724447, 128724455, 128724464],
      'Swap (PunishmentApplied, Sync)': [128724366, 128724415, 128724468],
      'StateUpdated + Swap': [128724071, 128724109, 128724153],
    },
  },
};

describe('LunarBase EventPool', () => {
  Object.entries(eventsToTest).forEach(([networkStr, pools]) => {
    const network = Number(networkStr) as Network;

    describe(`${network}`, () => {
      const dexKey = 'LunarBase';
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);
      const executors = [
        dexHelper.config.data.executorsAddresses!.Executor01,
        dexHelper.config.data.executorsAddresses!.Executor02,
      ].map(e => e.toLowerCase());

      Object.entries(pools).forEach(([poolAddress, events]) => {
        Object.entries(events).forEach(([eventName, blockNumbers]) => {
          describe(`${poolAddress} ${eventName}`, () => {
            blockNumbers.forEach(blockNumber => {
              it(`State after ${blockNumber}`, async () => {
                const eventPool = new LunarBaseEventPool(
                  dexKey,
                  dexHelper,
                  poolAddress,
                  executors,
                  logger,
                );
                await testEventSubscriber(
                  eventPool,
                  eventPool.addressesSubscribed,
                  (_blockNumber: number) =>
                    eventPool.generateState(
                      _blockNumber,
                    ) as Promise<LunarBasePoolState>,
                  blockNumber,
                  `${dexKey}_${poolAddress}`,
                  dexHelper.provider,
                );
              });
            });
          });
        });
      });
    });
  });
});
