import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { Config } from './config';
import { UsualPool } from './pool';
import { PoolConfig } from '../curve-v1/types';
import UsualPoolAbi from '../../abi/usual-pp/abi.json';
import { Interface } from '@ethersproject/abi';

jest.setTimeout(50 * 1000);
const dexKey = 'UsualPP';
const network = Network.MAINNET;
const config = Config[dexKey][network];
const dexHelper = new DummyDexHelper(network);
const logger = dexHelper.getLogger(dexKey);

async function fetchPoolState(
  usualPool: UsualPool,
  blockNumber: number,
): Promise<PoolState> {
  return usualPool.generateState(blockNumber);
}

function compareState(state: PoolState, expectedState: PoolState) {
  expect(state).toEqual(expectedState);
}

describe('UsualPP Event', function () {
  const blockNumbers: { [eventName: string]: number[] } = {
    FloorPriceUpdated: [21589702],
  };

  describe('UsualPool', function () {
    let usualPool: UsualPool;
    let blockNumber: number;

    const usualPoolIface = new Interface(UsualPoolAbi);

    beforeAll(async function () {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    });

    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          usualPool = new UsualPool(
            dexKey,
            dexHelper,
            config.USD0PP.address,
            usualPoolIface,
            logger,
          );
          await testEventSubscriber(
            usualPool,
            usualPool.addressesSubscribed,
            (_blockNumber: number) => fetchPoolState(usualPool, _blockNumber),
            blockNumber,
            `${dexKey}_${config.USD0PP.address}`,
            dexHelper.provider,
            compareState,
          );
        });
      });
    });
  });
});
