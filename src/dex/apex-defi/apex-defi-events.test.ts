/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { ApexDefiEventPool } from './apex-defi-pool';
import { ApexDefiConfig } from './config';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { ApexDefiPoolState } from './types';
import { Tokens } from '../../../tests/constants-e2e';

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  apexDefiPools: ApexDefiEventPool,
  blockNumber: number,
  tokenAddress: Address,
): Promise<ApexDefiPoolState> {
  const message = `ApexDefi: ${tokenAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);

  const state = await apexDefiPools.generateState(blockNumber);

  console.log(`Done ${message}`);
  return state;
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

// Token configuration for testing
interface TokenTestConfig {
  tokenAddress: Address;
  events: EventMappings;
}

describe('ApexDefi EventPool', function () {
  const dexKey = 'ApexDefi';
  const network = Network.AVALANCHE;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  const config = ApexDefiConfig[dexKey][network];

  // Define all tokens to test
  const tokensToTest: TokenTestConfig[] = [
    {
      tokenAddress: Tokens[network].APEX.address,
      events: {
        Swap: [65514084],
      },
    },
    {
      tokenAddress: Tokens[network].aUSDC.address,
      events: {
        Swap: [65529928],
      },
    },
    {
      tokenAddress: Tokens[network].aBTCb.address,
      events: {
        Swap: [65555724],
      },
    },
    // Add more tokens here as needed:
    // {
    //   token0: Tokens[network].WAVAX.address,
    //   token1: Tokens[network].USDC.address,
    //   poolAddress: Tokens[network].USDC.address,
    //   events: {
    //     Swap: [65530000],
    //   },
    // },
  ];

  // Test each token configuration
  tokensToTest.forEach((tokenConfig: TokenTestConfig) => {
    describe(`Token: ${tokenConfig.tokenAddress}`, () => {
      let apexDefiPool: ApexDefiEventPool;

      beforeEach(async () => {
        apexDefiPool = new ApexDefiEventPool(
          dexKey,
          network,
          dexHelper,
          Tokens[network].WAVAX.address,
          tokenConfig.tokenAddress,
          tokenConfig.tokenAddress,
          logger,
          config.factoryAddress,
        );
      });

      Object.entries(tokenConfig.events).forEach(
        ([eventName, blockNumbers]: [string, number[]]) => {
          describe(`${eventName}`, () => {
            blockNumbers.forEach((blockNumber: number) => {
              it(`State after ${blockNumber}`, async function () {
                await testEventSubscriber(
                  apexDefiPool,
                  apexDefiPool.addressesSubscribed,
                  (_blockNumber: number) =>
                    fetchPoolState(
                      apexDefiPool,
                      _blockNumber,
                      tokenConfig.tokenAddress,
                    ),
                  blockNumber,
                  `${dexKey}_${tokenConfig.tokenAddress}`,
                  dexHelper.provider,
                );
              });
            });
          });
        },
      );
    });
  });
});
