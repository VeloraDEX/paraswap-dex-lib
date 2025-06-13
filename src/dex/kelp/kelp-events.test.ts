/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { KelpEventPool } from './kelp-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { KelpPoolState } from './types';
import { KelpConfig } from './config';
import lrtOracleAbi from '../../abi/kelp/LRTOracle.json';
import { Interface, JsonFragment } from '@ethersproject/abi';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  kelpPools: KelpEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<KelpPoolState> {
  return kelpPools.generateState(blockNumber);
}

type EventMappings = Record<string, number[]>;

describe('KelpEventPool Mainnet', function () {
  const dexKey = 'Kelp';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let kelpPool: KelpEventPool;

  const eventsToTest: Record<Address, EventMappings> = {
    [KelpConfig.Kelp[network].lrtOracle.toLowerCase()]: {
      RsETHPriceUpdate: [
        22166810, 22159610, 22152410, 22145210, 22138010, 22130810, 22123610,
        22051610, 21331610,
      ],
    },
  };

  beforeEach(async () => {
    kelpPool = new KelpEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      KelpConfig.Kelp[network].lrtOracle.toLowerCase(),
      new Interface(lrtOracleAbi as JsonFragment[]),
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
                    kelpPool,
                    kelpPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(kelpPool, _blockNumber, poolAddress),
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
