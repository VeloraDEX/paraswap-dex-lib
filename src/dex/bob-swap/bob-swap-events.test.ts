/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import {
  AbstractBobSwapEventPool,
  BobSwapEventPool,
  BobSwapEventPoolPolygon,
} from './bob-swap-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { BobSwapConfig } from './config';
import { erc20Iface } from '../../lib/tokens/utils';
import { exit } from 'yargs';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  bobSwapPools: AbstractBobSwapEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  const message = `BobVault: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  const state = bobSwapPools.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('BobSwap EventPool', function () {
  const dexKey = 'BobSwap';
  // const network = Network.POLYGON;

  const networkBlockNumbers: {
    [network: number]: { [eventName: string]: number[] };
  } = {
    [Network.POLYGON]: {
      // 0x72ef4b402b9a2c78796038c5ccfe4a0a6dda91238fdcdbf1dc7263b07ab5512c
      AddCollateral: [36750276, 37176588],
      // 0xbacc19961151cbf3edcf4cf8653aa6017430dbe14fdc333f4e2a78229c47448a
      UpdateFees: [36750276, 37176588, 37953381],
      // 0x8d94e2e2db9f446124d343c4e5a8e3d4612b16bc4f8db4c047c0b8b7d57822c5
      UpdateMaxBalance: [],
      // 0x89f5adc174562e07c9c9b1cae7109bbecb21cf9d1b2847e550042b8653c54a0e
      Buy: [37858143, 37955491, 38047726, 40300563],
      // 0xa082022e93cfcd9f1da5f9236718053910f7e840da080c789c7845698dc032ff
      Sell: [37447862, 40651108, 40651179],
      // 0xcd3829a3813dc3cdd188fd3d01dcf3268c16be2fdd2dd21d0665418816e46062
      Swap: [37417853, 37179124, 37179082],
      // 0xa287a305d884484886886da5686f3b9d8d30c3f3ebedd3b5fa6103ae30bcc011
      Give: [],
    },
    [Network.ARBITRUM]: {
      // 0x72ef4b402b9a2c78796038c5ccfe4a0a6dda91238fdcdbf1dc7263b07ab5512c
      AddCollateral: [67246527, 67246561],
      // 0xbacc19961151cbf3edcf4cf8653aa6017430dbe14fdc333f4e2a78229c47448a
      UpdateFees: [67246527, 67246561],
      // 0x8d94e2e2db9f446124d343c4e5a8e3d4612b16bc4f8db4c047c0b8b7d57822c5
      UpdateMaxBalance: [67246527, 67246561],
      // 0x89f5adc174562e07c9c9b1cae7109bbecb21cf9d1b2847e550042b8653c54a0e
      Buy: [68522066, 68522127],
      // 0xa082022e93cfcd9f1da5f9236718053910f7e840da080c789c7845698dc032ff
      Sell: [],
      // 0xcd3829a3813dc3cdd188fd3d01dcf3268c16be2fdd2dd21d0665418816e46062
      Swap: [],
      // 0xa287a305d884484886886da5686f3b9d8d30c3f3ebedd3b5fa6103ae30bcc011
      Give: [],
    },
    [Network.OPTIMISM]: {
      // 0x72ef4b402b9a2c78796038c5ccfe4a0a6dda91238fdcdbf1dc7263b07ab5512c
      AddCollateral: [78856415, 78856458],
      // 0xbacc19961151cbf3edcf4cf8653aa6017430dbe14fdc333f4e2a78229c47448a
      UpdateFees: [78856415, 78856458],
      // 0x8d94e2e2db9f446124d343c4e5a8e3d4612b16bc4f8db4c047c0b8b7d57822c5
      UpdateMaxBalance: [78856415, 78856458],
      // 0x89f5adc174562e07c9c9b1cae7109bbecb21cf9d1b2847e550042b8653c54a0e
      Buy: [79789598, 79789623],
      // 0xa082022e93cfcd9f1da5f9236718053910f7e840da080c789c7845698dc032ff
      Sell: [],
      // 0xcd3829a3813dc3cdd188fd3d01dcf3268c16be2fdd2dd21d0665418816e46062
      Swap: [],
      // 0xa287a305d884484886886da5686f3b9d8d30c3f3ebedd3b5fa6103ae30bcc011
      Give: [],
    },
    [Network.BSC]: {
      // 0x72ef4b402b9a2c78796038c5ccfe4a0a6dda91238fdcdbf1dc7263b07ab5512c
      AddCollateral: [26230002],
      // 0xbacc19961151cbf3edcf4cf8653aa6017430dbe14fdc333f4e2a78229c47448a
      UpdateFees: [26230002],
      // 0x8d94e2e2db9f446124d343c4e5a8e3d4612b16bc4f8db4c047c0b8b7d57822c5
      UpdateMaxBalance: [26230002],
      // 0x89f5adc174562e07c9c9b1cae7109bbecb21cf9d1b2847e550042b8653c54a0e
      Buy: [26342301, 26342304],
      // 0xa082022e93cfcd9f1da5f9236718053910f7e840da080c789c7845698dc032ff
      Sell: [],
      // 0xcd3829a3813dc3cdd188fd3d01dcf3268c16be2fdd2dd21d0665418816e46062
      Swap: [],
      // 0xa287a305d884484886886da5686f3b9d8d30c3f3ebedd3b5fa6103ae30bcc011
      Give: [],
    },
    [Network.MAINNET]: {
      // 0x72ef4b402b9a2c78796038c5ccfe4a0a6dda91238fdcdbf1dc7263b07ab5512c
      AddCollateral: [16670785],
      // 0xbacc19961151cbf3edcf4cf8653aa6017430dbe14fdc333f4e2a78229c47448a
      UpdateFees: [16670785],
      // 0x8d94e2e2db9f446124d343c4e5a8e3d4612b16bc4f8db4c047c0b8b7d57822c5
      UpdateMaxBalance: [16670785],
      // 0x89f5adc174562e07c9c9b1cae7109bbecb21cf9d1b2847e550042b8653c54a0e
      Buy: [16784597],
      // 0xa082022e93cfcd9f1da5f9236718053910f7e840da080c789c7845698dc032ff
      Sell: [],
      // 0xcd3829a3813dc3cdd188fd3d01dcf3268c16be2fdd2dd21d0665418816e46062
      Swap: [],
      // 0xa287a305d884484886886da5686f3b9d8d30c3f3ebedd3b5fa6103ae30bcc011
      Give: [],
    },
  };

  Object.keys(networkBlockNumbers).forEach((networkStr: string) => {
    const network: number = Number(networkStr);
    Object.keys(networkBlockNumbers[network]).forEach((event: string) => {
      networkBlockNumbers[network][event].forEach((blockNumber: number) => {
        it(`Should return the correct state at network ${network} after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);
          const config = BobSwapConfig[dexKey][network];

          let bobSwapPool: AbstractBobSwapEventPool;

          if (network == Network.POLYGON) {
            bobSwapPool = new BobSwapEventPoolPolygon(
              dexKey,
              network,
              dexHelper,
              logger,
              config.bobSwapAddress,
              config.bobTokenAddress,
              config.tokens,
              erc20Iface,
            );
          } else {
            bobSwapPool = new BobSwapEventPool(
              dexKey,
              network,
              dexHelper,
              logger,
              config.bobSwapAddress,
              config.bobTokenAddress,
              config.tokens,
              erc20Iface,
            );
          }

          await testEventSubscriber(
            bobSwapPool,
            bobSwapPool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolState(bobSwapPool, _blockNumber, config.bobSwapAddress),
            blockNumber,
            `${dexKey}_${config.bobSwapAddress}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});
