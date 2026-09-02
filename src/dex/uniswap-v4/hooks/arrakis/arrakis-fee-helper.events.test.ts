/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../../../constants';
import { Address } from '../../../../types';
import { DummyDexHelper } from '../../../../dex-helper';
import { testEventSubscriber } from '../../../../../tests/utils-events';
import { ArrakisFeeHelper, ArrakisFeeHelperState } from './arrakis-fee-helper';

jest.setTimeout(500 * 1000);

const dexKey = 'ArrakisFeeHelper';

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

async function fetchFeeHelperState(
  feeHelper: ArrakisFeeHelper,
  blockNumber: number,
): Promise<ArrakisFeeHelperState> {
  const state = await feeHelper.generateState(blockNumber);

  return {
    poolIdToFeesData: { ...state.poolIdToFeesData },
  };
}

describe('MAINNET', () => {
  const network = Network.MAINNET;
  const hookAddress = '0xa4e6f5500e88691fdcb289aa0e99067481434880';
  const poolIds = [
    '0xde31d7cdc7f4db844e87bb67a139ff78afbb8d32e38cce429dbc3a66f1f76dc9',
    '0x18575b0e8704eab2c94b8ba5ad367fb52b2293705179236d2f45f0454a6f67da',
    '0x553f5e94603f1fcdaa08eb22499d59e4a39e2f8d071c3c6946c27e5e38754ffc',
  ];

  describe('ArrakisFeeHelper events', () => {
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let feeHelper: ArrakisFeeHelper;

    // hookAddress -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [hookAddress]: {
        SetFees: [
          25803459, 25883462, 25884917, 25888324, 25888346, 25888439, 25888520,
        ],
      },
    };

    beforeEach(async () => {
      feeHelper = new ArrakisFeeHelper(dexKey, network, dexHelper, logger);
      poolIds.forEach(id => feeHelper.addPoolId(id));
    });

    Object.entries(eventsToTest).forEach(
      ([hookContract, events]: [string, EventMappings]) => {
        describe(`Events for ${hookContract}`, () => {
          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      feeHelper,
                      feeHelper.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchFeeHelperState(feeHelper, _blockNumber),
                      blockNumber,
                      `${dexKey}_${hookContract}`,
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
