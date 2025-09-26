import dotenv from 'dotenv';
dotenv.config();

import { SkyConverterEventPool } from './sky-converter-pool';
import { SkyConverterConfig } from './config';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import type { SkyConverterPoolState } from './types';

async function fetchPoolState(
  pool: SkyConverterEventPool,
  blockNumber: number,
): Promise<SkyConverterPoolState> {
  const state = await pool.generateState(blockNumber);
  return { fee: state.fee };
}

type EventMappings = Record<string, number[]>;

describe('SkyConverter EventPool Mainnet', function () {
  const dexKey = 'MkrSky';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  const config = SkyConverterConfig[dexKey][network];

  let skyConverterPool: SkyConverterEventPool;

  const eventsToTest: Record<Address, EventMappings> = {
    [config.converterAddress]: {
      File: [23419022, 23419023, 23419024],
    },
  };

  beforeEach(async () => {
    skyConverterPool = new SkyConverterEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      config.converterAddress,
      config.converterIface,
    );
  });

  Object.entries(eventsToTest).forEach(
    ([poolAddress, events]: [string, EventMappings]) => {
      describe(`Events for ${poolAddress}`, () => {
        Object.entries(events).forEach(
          ([eventName, blockNumbers]: [string, number[]]) => {
            describe(`${eventName}`, () => {
              blockNumbers.forEach((blockNumber: number) => {
                it(`State after ${blockNumber}`, async function () {
                  await testEventSubscriber(
                    skyConverterPool,
                    skyConverterPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(skyConverterPool, _blockNumber),
                    blockNumber,
                    `${dexKey}_${poolAddress}`,
                    dexHelper.provider,
                    (state, expected) => {
                      expect(state.fee).toEqual(expected.fee);
                    },
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
