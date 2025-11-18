/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { MiroMigratorEventPool } from './miro-migrator-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { MiroMigratorConfig } from './config';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  miroMigratorPool: MiroMigratorEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const onChainState = await miroMigratorPool.generateState(blockNumber);
  return onChainState;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('MiroMigrator EventPool', function () {
  const dexKey = 'MiroMigrator';

  describe('Mainnet', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let miroMigratorPool: MiroMigratorEventPool;

    const eventsToTest: Record<Address, EventMappings> = {
      [MiroMigratorConfig[dexKey][network].vlrTokenAddress]: {
        Transfer: [23381115, 23381111, 23381108, 23381106, 23381099],
      },
    };

    beforeEach(async () => {
      miroMigratorPool = new MiroMigratorEventPool(
        dexKey,
        network,
        dexHelper,
        logger,
        MiroMigratorConfig[dexKey][network].migratorAddress,
        MiroMigratorConfig[dexKey][network].vlrTokenAddress,
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
                      miroMigratorPool,
                      miroMigratorPool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          miroMigratorPool,
                          _blockNumber,
                          poolAddress,
                        ),
                      blockNumber,
                      `${dexKey}_${poolAddress}`,
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

  describe('Optimism', function () {
    const network = Network.OPTIMISM;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let miroMigratorPool: MiroMigratorEventPool;

    const eventsToTest: Record<Address, EventMappings> = {
      [MiroMigratorConfig[dexKey][network].vlrTokenAddress]: {
        Transfer: [141246004, 141245961, 141245678, 141245519, 141245451],
      },
    };

    beforeEach(async () => {
      miroMigratorPool = new MiroMigratorEventPool(
        dexKey,
        network,
        dexHelper,
        logger,
        MiroMigratorConfig[dexKey][network].migratorAddress,
        MiroMigratorConfig[dexKey][network].vlrTokenAddress,
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
                      miroMigratorPool,
                      miroMigratorPool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          miroMigratorPool,
                          _blockNumber,
                          poolAddress,
                        ),
                      blockNumber,
                      `${dexKey}_${poolAddress}`,
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
