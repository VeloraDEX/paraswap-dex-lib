/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../../../constants';
import { Address } from '../../../../types';
import { DummyDexHelper } from '../../../../dex-helper';
import { testEventSubscriber } from '../../../../../tests/utils-events';
import { ArenaFeeHelper, ArenaFeeHelperState } from './arena-fee-helper';

jest.setTimeout(500 * 1000);

const dexKey = 'ArenaFeeHelper';

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

async function fetchFeeHelperState(
  feeHelper: ArenaFeeHelper,
  blockNumber: number,
): Promise<ArenaFeeHelperState> {
  const state = await feeHelper.generateState(blockNumber);

  return {
    protocolFeePpm: Number(state.protocolFeePpm),
    poolIdToTotalFeePpm: { ...state.poolIdToTotalFeePpm },
  };
}

describe('AVALANCHE', () => {
  const network = Network.AVALANCHE;
  const feeHelperAddress = '0x537505da49b4249b576fc8d00028bfddf6189077';
  const poolIds = [
    '0x7679eef910258308b1182520112fb0fe07f23558c1a26bfc6ed7dcb20baa66ce',
    '0x58cb4c604d89ced6dcdf688d14eedcedbbbb5d2ba8f321e18859d7fc9b0f31ac',
    '0xfd340421571d762e16ba28303689207a09737f49fe4b098cfe40bb25c2d557a3',
    '0x8ebe9092a02de2aac0308de2bddb98655d783748b9d6abbfdb56b2eba317faf0',
    '0xd4c6ebeeff8bda96e1457e62b05a4b84b8e1d94bc30dd159b9a743ec2150fd28',
    '0x2f77b16630ff4f25a8b53e1c66f0cba959ed686d99ea7cc39af3ca830f3e0888',
  ];

  describe('ArenaFeeHelper events', () => {
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let feeHelper: ArenaFeeHelper;

    // poolAddress -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [feeHelperAddress]: {
        FeeArraySet: [
          73462130, 73467456, 73468103, 73468556, 73469628, 73471660,
        ],
        ProtocolFeeSettingsSet: [72302062],
      },
    };

    beforeEach(async () => {
      feeHelper = new ArenaFeeHelper(
        dexKey,
        network,
        dexHelper,
        logger,
        undefined,
      );
      poolIds.forEach(id => feeHelper.addPoolId(id));
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
                      feeHelper,
                      feeHelper.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchFeeHelperState(feeHelper, _blockNumber),
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
