/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { FluidDexLiquidityProxyState } from './types';
import { FluidDexConfig } from './config';
import { FluidDexLiquidityProxy } from './fluid-dex-liquidity-proxy';
import { FluidDexFactory } from './fluid-dex-factory';
import { FluidDexEventPool } from './fluid-dex-pool';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';

jest.setTimeout(50 * 1000);

async function fetchState(
  statefulEventSubscriber: StatefulEventSubscriber<any>,
  blockNumber: number,
): Promise<any> {
  return statefulEventSubscriber.generateState(blockNumber);
}

// eventName -> blockNumbers
type EventMappings = Record<string, number[]>;

describe('FluidDex EventPool Mainnet', function () {
  const dexKey = 'FluidDex';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  const commonAddresses = FluidDexConfig.FluidDex[network].commonAddresses;

  describe('LiquidityProxy Events', () => {
    let liquidityProxy: FluidDexLiquidityProxy;

    // poolAddress -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      '0x52aa899454998be5b000ad077a46bbe360f4e497': {
        LogOperate: [
          21190399, 21190405, 21190420, 21190452, 21190454, 21190465, 21190506,
        ],
      },
    };

    Object.entries(eventsToTest).forEach(
      ([poolAddress, events]: [string, EventMappings]) => {
        describe(`Events for ${poolAddress}`, () => {
          beforeEach(() => {
            liquidityProxy = new FluidDexLiquidityProxy(
              dexKey,
              commonAddresses,
              network,
              dexHelper,
              logger,
            );
          });
          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      liquidityProxy,
                      liquidityProxy.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchState(liquidityProxy, _blockNumber),
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

  describe('Factory events', () => {
    let dexFactory: FluidDexFactory;

    const eventsToTest: Record<Address, EventMappings> = {
      '0x91716C4EDA1Fb55e84Bf8b4c7085f84285c19085': {
        LogDexDeployed: [21199929],
      },
    };

    Object.entries(eventsToTest).forEach(
      ([poolAddress, events]: [string, EventMappings]) => {
        describe(`Events for ${poolAddress}`, () => {
          beforeEach(() => {
            dexFactory = new FluidDexFactory(
              dexKey,
              commonAddresses,
              network,
              dexHelper,
              logger,
              pools => {
                console.log('POOLS: ', pools);
              },
            );
          });
          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      dexFactory,
                      dexFactory.addressesSubscribed,
                      (_blockNumber: number) =>
                        dexFactory.generateState(blockNumber),
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

  describe('Pool events', () => {
    let dexPool: FluidDexEventPool;

    const eventsToTest: Record<Address, EventMappings> = {
      '0x8710039D5de6840EdE452A85672B32270a709aE2': {
        LogPauseSwapAndArbitrage: [21337128],
      },
      '0x2886a01a0645390872a9eb99dae1283664b0c524': {
        LogPauseSwapAndArbitrage: [21374547],
      },
    };

    Object.entries(eventsToTest).forEach(
      ([poolAddress, events]: [string, EventMappings]) => {
        describe(`Events for ${poolAddress}`, () => {
          beforeEach(() => {
            dexPool = new FluidDexEventPool(
              dexKey,
              poolAddress,
              network,
              dexHelper,
              logger,
            );
          });
          Object.entries(events).forEach(
            ([eventName, blockNumbers]: [string, number[]]) => {
              describe(`${eventName}`, () => {
                blockNumbers.forEach((blockNumber: number) => {
                  it(`State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      dexPool,
                      dexPool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchState(dexPool, _blockNumber),
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
