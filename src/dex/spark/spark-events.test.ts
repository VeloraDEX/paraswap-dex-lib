import dotenv from 'dotenv';
dotenv.config();

import { SparkSDaiEventPool } from './spark-sdai-pool';
import { SDaiConfig } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { SparkSDaiPoolState } from './types';

import PotAbi from '../../abi/maker-psm/pot.json';
import { Interface } from '@ethersproject/abi';
import _ from 'lodash';
import { sUSDSPsmConfig } from './spark-psm';

jest.setTimeout(50 * 1000);
const network = Network.MAINNET;

async function fetchPoolState(
  sdaiPool: SparkSDaiEventPool,
  blockNumber: number,
): Promise<SparkSDaiPoolState> {
  return sdaiPool.generateState(blockNumber);
}

describe('SDai', function () {
  const dexKey = 'Spark';
  const blockNumbers: { [eventName: string]: number[] } = {
    drip: [19827559, 19827524, 19827163, 19827124, 19827000, 19826892],
    // TODO: no matching logs, you have to manually call "file"
    // from "0xbe8e3e3618f7474f8cb1d074a26affef007e98fb" address
    // https://etherscan.io/advanced-filter?fadd=0x197e90f9fad81970ba7976f33cbd77088e5d7cf7&tadd=0x197e90f9fad81970ba7976f33cbd77088e5d7cf7&mtd=0x29ae8114%7eFile
    // file: [19831086]
  };

  const addresses: { [contract: string]: string } = {
    potAddress: SDaiConfig[dexKey][network].potAddress,
  };

  const potIface = SDaiConfig[dexKey][network].poolInterface;

  Object.keys(blockNumbers).forEach((event: string) => {
    blockNumbers[event].forEach((blockNumber: number) => {
      it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
        const dexHelper = new DummyDexHelper(network);
        const logger = dexHelper.getLogger(dexKey);

        const sdaiPool = new SparkSDaiEventPool(
          dexKey,
          network,
          `dai-sdai-pool`,
          dexHelper,
          addresses.potAddress,
          potIface,
          logger,
          '0x6473720000000000000000000000000000000000000000000000000000000000',
          'dsr',
        );

        await sdaiPool.initialize(blockNumber);

        await testEventSubscriber(
          sdaiPool,
          sdaiPool.addressesSubscribed,
          (_blockNumber: number) => fetchPoolState(sdaiPool, _blockNumber),
          blockNumber,
          `${dexKey}_${sdaiPool}`,
          dexHelper.provider,
        );
      });
    });
  });
});

describe('sUSDS', function () {
  const dexKey = 'sUSDS';
  const blockNumbers: { [eventName: string]: number[] } = {
    drip: [20812786, 20812797, 20813343, 20813668, 20814065, 20814418],
  };

  const addresses: { [contract: string]: string } = {
    potAddress: SDaiConfig[dexKey][network].potAddress,
  };

  const potIface = SDaiConfig[dexKey][network].poolInterface;

  Object.keys(blockNumbers).forEach((event: string) => {
    blockNumbers[event].forEach((blockNumber: number) => {
      it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
        const dexHelper = new DummyDexHelper(network);
        const logger = dexHelper.getLogger(dexKey);

        const sUSDSPool = new SparkSDaiEventPool(
          dexKey,
          network,
          `usds-susds-pool`,
          dexHelper,
          addresses.potAddress,
          potIface,
          logger,
          '0x7373720000000000000000000000000000000000000000000000000000000000',
          'ssr',
        );

        await sUSDSPool.initialize(blockNumber);

        await testEventSubscriber(
          sUSDSPool,
          sUSDSPool.addressesSubscribed,
          (_blockNumber: number) => fetchPoolState(sUSDSPool, _blockNumber),
          blockNumber,
          `${dexKey}_${sUSDSPool}`,
          dexHelper.provider,
        );
      });
    });
  });
});

describe('SparkPsm', () => {
  const dexKey = 'SparkPsm';

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const blockNumbers: { [eventName: string]: number[] } = {
      drip: [304722012, 307345024, 309450889, 312209827, 314627816],
    };

    const addresses: { [contract: string]: string } = {
      potAddress: sUSDSPsmConfig[dexKey][network].potAddress,
    };

    const potIface = sUSDSPsmConfig[dexKey][network].poolInterface;

    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const sUSDSPool = new SparkSDaiEventPool(
            dexKey,
            network,
            `usds-susds-pool`,
            dexHelper,
            addresses.potAddress,
            potIface,
            logger,
            '0xc234856e2a0c5b406365714ced016892e7d98f7b1d49982cdd8db416a586d811',
            'ssrOracle',
          );

          await sUSDSPool.initialize(blockNumber);

          await testEventSubscriber(
            sUSDSPool,
            sUSDSPool.addressesSubscribed,
            (_blockNumber: number) => fetchPoolState(sUSDSPool, _blockNumber),
            blockNumber,
            `${dexKey}_${sUSDSPool}`,
            dexHelper.provider,
          );
        });
      });
    });
  });

  describe('Base', () => {
    const network = Network.BASE;

    const blockNumbers: { [eventName: string]: number[] } = {
      drip: [26505853, 26808109, 26808254, 27110658],
    };

    const addresses: { [contract: string]: string } = {
      potAddress: sUSDSPsmConfig[dexKey][network].potAddress,
    };

    const potIface = sUSDSPsmConfig[dexKey][network].poolInterface;

    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const sUSDSPool = new SparkSDaiEventPool(
            dexKey,
            network,
            `usds-susds-pool`,
            dexHelper,
            addresses.potAddress,
            potIface,
            logger,
            '0xc234856e2a0c5b406365714ced016892e7d98f7b1d49982cdd8db416a586d811',
            'ssrOracle',
          );

          await sUSDSPool.initialize(blockNumber);

          await testEventSubscriber(
            sUSDSPool,
            sUSDSPool.addressesSubscribed,
            (_blockNumber: number) => fetchPoolState(sUSDSPool, _blockNumber),
            blockNumber,
            `${dexKey}_${sUSDSPool}`,
            dexHelper.provider,
          );
        });
      });
    });
  });
});
