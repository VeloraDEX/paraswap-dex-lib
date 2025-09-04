import dotenv from 'dotenv';
dotenv.config();

import { YoEventPool } from './yo-pool';
import { YoConfig } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { ERC4626PoolState } from '../erc4626/types';

import _ from 'lodash';

jest.setTimeout(50 * 1000);
const networks = [Network.BASE];

async function fetchPoolState(
  yoPool: YoEventPool,
  blockNumber: number,
): Promise<ERC4626PoolState> {
  const eventState = yoPool.getState(blockNumber);
  if (eventState) return eventState;
  const onChainState = await yoPool.generateState(blockNumber);
  yoPool.setState(onChainState, blockNumber);
  return onChainState;
}

describe('yoETH', function () {
  const dexKey = 'yoETH';
  const multichainBlockNumbers: {
    [network: string]: { [eventName: string]: number[] };
  } = {
    [Network.BASE]: {
      deposit: [34673933, 34642493],
      withdraw: [34682120, 34679823],
    },
  };

  networks.forEach(network => {
    describe(`${network}`, () => {
      const yoETHAddress = YoConfig[dexKey][network].vault;
      const ETHAddress = YoConfig[dexKey][network].asset;

      const blockNumbers = Array.from(
        new Set(
          Object.values(multichainBlockNumbers[network])
            .flat()
            .sort((a, b) => a - b),
        ),
      );

      blockNumbers.forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const yoETHPool = new YoEventPool(
            dexKey,
            network,
            dexHelper,
            logger,
            yoETHAddress,
            ETHAddress,
            false,
          );

          await yoETHPool.initialize(blockNumber);

          const state = await fetchPoolState(yoETHPool, blockNumber);

          expect(state).not.toBeNull();
          expect(state.totalAssets).toBeGreaterThan(0n);
          expect(state.totalShares).toBeGreaterThan(0n);
        });
      });
    });
  });
});

describe('yoUSD', function () {
  const dexKey = 'yoUSD';
  const multichainBlockNumbers: {
    [network: string]: { [eventName: string]: number[] };
  } = {
    [Network.BASE]: {
      deposit: [34682024, 34681642, 34681585],
      withdraw: [34682302, 34681767, 34681431],
    },
  };

  networks.forEach(network => {
    describe(`${network}`, () => {
      const yoUSDAddress = YoConfig[dexKey][network].vault;
      const USDAddress = YoConfig[dexKey][network].asset;

      const blockNumbers = Array.from(
        new Set(
          Object.values(multichainBlockNumbers[network])
            .flat()
            .sort((a, b) => a - b),
        ),
      );

      blockNumbers.forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const yoUSDPool = new YoEventPool(
            dexKey,
            network,
            dexHelper,
            logger,
            yoUSDAddress,
            USDAddress,
            false,
          );

          await yoUSDPool.initialize(blockNumber);

          const state = await fetchPoolState(yoUSDPool, blockNumber);

          expect(state).not.toBeNull();
          expect(state.totalAssets).toBeGreaterThan(0n);
          expect(state.totalShares).toBeGreaterThan(0n);
        });
      });
    });
  });
});
