/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { CapPools } from './cap-pools';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { VaultsStates } from './types';
import { CapConfig } from './config';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  capPools: CapPools,
  blockNumber: number,
  poolAddress: Address,
): Promise<VaultsStates> {
  return capPools.generateState(blockNumber, poolAddress);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('Cap Vault Mainnet', function () {
  const dexKey = 'Cap';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let capPool: CapPools;

  // poolAddress -> EventMappings
  const eventsToTest: Record<Address, EventMappings> = {
    '0xcccc62962d17b8914c62d74ffb843d73b2a3cccc': {
      // there is no SetFeeData event after 23348622
      // the block at which "getFeeData" becomes available
      // https://etherscan.io/tx/0xaa25bab1db09ce63b734016cf36fc89322dcc9c2b00f43659851564c0b8423fb
      // SetFeeData: [22880873, 23140818],
      Mint: [23348816, 23348762],
      Burn: [23348769, 23349973],
    },
  };

  beforeEach(async () => {
    capPool = new CapPools(
      dexKey,
      network,
      dexHelper,
      logger,
      CapConfig[dexKey][network],
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
                    capPool,
                    capPool.addressesSubscribed,
                    (_blockNumber: number) =>
                      fetchPoolState(capPool, _blockNumber, poolAddress),
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
