import dotenv from 'dotenv';

dotenv.config();

import { ERC4626EventPool } from './erc-4626-pool';
import { ERC4626Config } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import ERC4626_ABI from '../../abi/ERC4626.json';
import { DEPOSIT_TOPIC, TRANSFER_TOPIC, WITHDRAW_TOPIC } from './constants';
import { testEventSubscriber } from '../../../tests/utils-events';
import { ERC4626PoolState } from './types';

import { Interface } from '@ethersproject/abi';
import _ from 'lodash';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  pool: ERC4626EventPool,
  blockNumber: number,
): Promise<ERC4626PoolState> {
  const eventState = pool.getState(blockNumber);
  if (eventState) return eventState;
  const onChainState = await pool.generateState(blockNumber);
  pool.setState(onChainState, blockNumber);
  return onChainState;
}

// Block numbers for testing specific to each integration
const testBlockNumbers: {
  [dexKey: string]: {
    [network: number]: { [eventName: string]: number[] };
  };
} = {
  sDAI: {
    [Network.GNOSIS]: {
      deposit: [
        38964215, 38964218, 38964219, 38964222, 38964224, 38964243, 38964244,
        38964245, 38964247, 38964249, 38964253, 38964263, 38964303, 38964309,
        38964311, 38964314,
      ],
      withdraw: [
        38964215, 38964218, 38964219, 38964221, 38964222, 38964224, 38964225,
        38964230, 38964233, 38964236, 38964238, 38964243, 38964244, 38964245,
        38964246, 38964277, 38964278, 38964279, 38964289, 38964294, 38964302,
        38964309, 38964314,
      ],
    },
  },
  wUSDL: {
    [Network.MAINNET]: {
      deposit: [20905821, 20898635, 20895019],
      withdraw: [20905872, 20899123, 20895341],
    },
  },
  sUSDe: {
    [Network.MAINNET]: {
      deposit: [19437256, 19448123, 19452892],
      withdraw: [19437312, 19448298, 19453001],
    },
  },
  yoETH: {
    [Network.BASE]: {
      deposit: [22521934, 22460747, 22436449],
      withdraw: [],
    },
  },
  yoUSD: {
    [Network.BASE]: {
      deposit: [22521934, 22460747, 22436449],
      withdraw: [],
    },
  },
  stcUSD: {
    [Network.MAINNET]: {
      deposit: [21205821, 21198635, 21195019],
      withdraw: [21205872, 21199123, 21195341],
    },
  },
};

describe('ERC4626 Event Tests', function () {
  for (const dexKey of Object.keys(ERC4626Config)) {
    describe(`${dexKey}`, function () {
      for (const net of Object.keys(ERC4626Config[dexKey])) {
        const network = Number(net) as Network;
        const { vault, asset } = ERC4626Config[dexKey][network];

        // Skip if no test block numbers are defined for this integration
        if (!testBlockNumbers[dexKey]?.[network]) {
          it.skip(`No test block numbers defined for ${dexKey} on ${Network[network]}`, () => {});
          continue;
        }

        describe(`${Network[network]}`, function () {
          const vaultAddress = vault;
          const assetAddress = asset;

          const vaultIface: Interface = new Interface(ERC4626_ABI);

          const blockNumbers = Array.from(
            new Set(
              Object.values(testBlockNumbers[dexKey][network])
                .flat()
                .sort((a, b) => a - b),
            ),
          );

          blockNumbers.forEach((blockNumber: number) => {
            it(`Should return the correct state after the ${blockNumber}`, async function () {
              const dexHelper = new DummyDexHelper(network);
              const logger = dexHelper.getLogger(dexKey);

              const pool = new ERC4626EventPool(
                dexKey,
                network,
                `${dexKey}-pool`,
                dexHelper,
                vaultAddress,
                assetAddress,
                vaultIface,
                logger,
                DEPOSIT_TOPIC,
                WITHDRAW_TOPIC,
                TRANSFER_TOPIC,
              );

              await testEventSubscriber(
                pool,
                pool.addressesSubscribed,
                (_blockNumber: number) => fetchPoolState(pool, _blockNumber),
                blockNumber,
                `${dexKey}_${vaultAddress}`,
                dexHelper.provider,
              );
            });
          });
        });
      }
    });
  }
});
