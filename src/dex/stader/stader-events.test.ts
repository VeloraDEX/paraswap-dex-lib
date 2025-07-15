/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { ETHxEventPool } from './stader-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { ETHxPoolState } from './types';
import { Interface, JsonFragment } from '@ethersproject/abi';
import { StaderConfig } from './config';
import StadeOracleAbi from '../../abi/StaderOracle.json';

jest.setTimeout(50 * 1000);

async function fetchETHxPoolState(
  staderPools: ETHxEventPool,
  blockNumber: number,
): Promise<ETHxPoolState> {
  return staderPools.generateState(blockNumber);
}

describe('Stader EventPool Mainnet', function () {
  const dexKey = 'Stader';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let staderPool: ETHxEventPool;

  const blockNumbers: { [eventName: string]: number[] } = {
    ExchangeRateUpdated: [
      21341230, 21334070, 21326910, 21319802, 21312600, 21305433, 21291465,
      21276861,
    ],
  };

  beforeEach(async () => {
    staderPool = new ETHxEventPool(
      dexKey,
      dexHelper,
      StaderConfig[dexKey][network].StaderOracle.toLowerCase(),
      new Interface(StadeOracleAbi as JsonFragment[]),
      logger,
    );
  });

  Object.keys(blockNumbers).forEach((event: string) => {
    blockNumbers[event].forEach((blockNumber: number) => {
      it(`State after ${blockNumber}`, async function () {
        await testEventSubscriber(
          staderPool,
          staderPool.addressesSubscribed,
          (_blockNumber: number) =>
            fetchETHxPoolState(staderPool, _blockNumber),
          blockNumber,
          `${dexKey}_${StaderConfig[dexKey][
            network
          ].StaderOracle.toLowerCase()}`,
          dexHelper.provider,
        );
      });
    });
  });
});
