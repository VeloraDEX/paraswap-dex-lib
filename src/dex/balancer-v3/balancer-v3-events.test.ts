/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { BalancerV3EventPool } from './balancer-v3-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolStateMap, StableMutableState } from './types';
import { BalancerV3Config } from './config';
import _ from 'lodash';

/*
  README
  ======

  This test script adds unit tests for BalancerV3 event based
  system. This is done by fetching the state on-chain before the
  event block, manually pushing the block logs to the event-subscriber,
  comparing the local state with on-chain state.

  Most of the logic for testing is abstracted by `testEventSubscriber`.
  You need to do two things to make the tests work:

  1. Fetch the block numbers where certain events were released. You
  can modify the `./scripts/fetch-event-blocknumber.ts` to get the
  block numbers for different events. Make sure to get sufficient
  number of blockNumbers to cover all possible cases for the event
  mutations.

  2. Complete the implementation for fetchPoolState function. The
  function should fetch the on-chain state of the event subscriber
  using just the blocknumber.

  The template tests only include the test for a single event
  subscriber. There can be cases where multiple event subscribers
  exist for a single DEX. In such cases additional tests should be
  added.

  You can run this individual test script by running:
  `npx jest src/dex/balancer-v3/balancer-v3-events.test.ts`

  (This comment should be removed from the final implementation)
*/

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  balancerV3Pools: BalancerV3EventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolStateMap> {
  const pools = await balancerV3Pools.generateState(blockNumber);
  // Filter to pool of interest
  return Object.entries(_.cloneDeep(pools) as PoolStateMap)
    .filter(([address]) => {
      return address.toLowerCase() === poolAddress.toLowerCase();
    })
    .reduce((acc, [address, pool]) => {
      acc[address] = pool;
      return acc;
    }, {} as PoolStateMap);
}

function stateCompare(state: PoolStateMap, expectedState: PoolStateMap) {
  if (state['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e']) {
    if (
      (
        expectedState[
          '0xd63db0b88dca565633fb8d70a70b9b8093d34a7e'
        ] as StableMutableState
      ).ampIsUpdating
    ) {
      compareAmpUpdating(state, expectedState);
    } else compareAmpStopped(state, expectedState);
  } else expect(state).toEqual(expectedState);
}

function compareAmpUpdating(state: PoolStateMap, expectedState: PoolStateMap) {
  // tokenRates and balancesLiveScaled18 are gradually increasing between blocks due to tokenRate (and can't be tracked via event) so will be ignored
  const compare = {
    ...state,
    ['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e']: _.omit(
      state['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e'],
      ['balancesLiveScaled18', 'tokenRates'],
    ),
  };
  const expectedCompare = {
    ...expectedState,
    ['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e']: _.omit(
      expectedState['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e'],
      ['balancesLiveScaled18', 'tokenRates'],
    ),
  };
  expect(compare).toEqual(expectedCompare);
}

function compareAmpStopped(state: PoolStateMap, expectedState: PoolStateMap) {
  if (state['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e']) {
    // tokenRates and balancesLiveScaled18 are gradually increasing between blocks due to tokenRate (and can't be tracked via event) so will be ignored
    // In Contract ampStartTime & ampStopTime are updated to timestamp event is called.
    // There doesn't appear to be a way to easily get timestamp non-async so we default to 0n which should have no effect.
    const compare = {
      ...state,
      ['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e']: _.omit(
        state['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e'],
        ['balancesLiveScaled18', 'tokenRates'],
      ),
    };
    const expectedCompare = {
      ...expectedState,
      ['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e']: {
        ..._.omit(expectedState['0xd63db0b88dca565633fb8d70a70b9b8093d34a7e'], [
          'balancesLiveScaled18',
          'tokenRates',
        ]),
        ampStartTime: 0n,
        ampStopTime: 0n,
      },
    };
    expect(compare).toEqual(expectedCompare);
  } else expect(state).toEqual(expectedState);
}

// eventName -> blockNumbers
type EventMappings = Record<string, EventData>;
type EventData = { blockNumbers: number[]; poolAddress: string[] };

describe('BalancerV3 EventPool', function () {
  const dexKey = 'BalancerV3';

  describe.skip('Sepolia', function () {
    const network = Network.SEPOLIA;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // vault -> EventMappings
    // TODO once we have a new test deployment add tests for: AggregateSwapFeePercentageChanged, SwapFeePercentageChanged, PoolPausedStateChanged
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].vaultAddress]: {
        // https://eth-sepolia.blockscout.com/tx/0xc417d38ad6e21250c9ddded37680b40f0991cfd3f8ae2d8b5800507a58d48c44
        LiquidityAdded: {
          blockNumbers: [7170937],
          poolAddress: ['0x2ff3b96e0057a1f25f1d62ab800554ccdb268ab8'],
        },
        // https://sepolia.etherscan.io/tx/0xc1596e26d51104b9236a0debc3e1946b30b82f92b8331639ad6f6aea2ff2decc
        LiquidityRemoved: {
          blockNumbers: [7170957],
          poolAddress: ['0x2ff3b96e0057a1f25f1d62ab800554ccdb268ab8'],
        },
        // https://sepolia.etherscan.io/tx/0x78d18503c2dd4458c94ec916b10c088bb4e8b90059676d00dbcec83f763d8c0e
        Swap: {
          blockNumbers: [7175721],
          poolAddress: ['0x2ff3b96e0057a1f25f1d62ab800554ccdb268ab8'],
        },
        // 7170034, AmpUpdateStarted, https://eth-sepolia.blockscout.com/tx/0xfbe2e53d9cede1dc900100a1d6e809a89d909746ac7b8cc011e93227af8dda8b?tab=logs
        // 7170069, AmpUpdateStopped, https://eth-sepolia.blockscout.com/tx/0x2ee2e1d5980013fdf1cf9c3789e0321fb598c2412db8ee8057fcfaffd1c792ab?tab=logs
        VaultAuxiliary: {
          blockNumbers: [7170034, 7170069],
          poolAddress: [
            '0xD63dB0B88dca565633fB8d70a70b9b8093d34A7E',
            '0xD63dB0B88dca565633fB8d70a70b9b8093d34A7E',
          ],
        },
        // https://sepolia.etherscan.io/tx/0x71f9879485f4e4cf97aa42381988ffe277f05a872d6b507cfa007cec1239a3f8#eventlog
        SwapFeePercentageChanged: {
          blockNumbers: [7206571],
          poolAddress: ['0xe69b70a86A4e1fD33dA95693A1aE12Be1c26C8ea'],
        },
        // https://sepolia.etherscan.io/tx/0xaf232ca2df59ba5fad38d74e9b54ec2ae1ad2e6abca8348f107cf3fd94c787c7#eventlog
        // Should remove pool from state as its paused and no longer supports swaps
        PoolPausedStateChanged: {
          blockNumbers: [7206586],
          poolAddress: ['0xe69b70a86A4e1fD33dA95693A1aE12Be1c26C8ea'],
        },
        // https://sepolia.etherscan.io/tx/0xa23dc10bd0fbed7ffffe867766d9b0d7670ca4a0bc352669f547bc7775644349#eventlog
        AggregateSwapFeePercentageChanged: {
          blockNumbers: [7206701],
          poolAddress: ['0xe69b70a86A4e1fD33dA95693A1aE12Be1c26C8ea'],
        },
      },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([vaultAddress, events]: [string, EventMappings]) => {
        describe(`Events for Vault: ${vaultAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${vaultAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  describe('Mainnet', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // vault -> EventMappings
    // TODO once we have a new test deployment add tests for: AggregateSwapFeePercentageChanged, SwapFeePercentageChanged, PoolPausedStateChanged
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].vaultAddress]: {
        LiquidityAdded: {
          blockNumbers: [21774068],
          poolAddress: ['0x8523bcadcda4bd329435940dcc49a7c4c0a14d94'],
        },
        LiquidityRemoved: {
          blockNumbers: [21788910],
          poolAddress: ['0x8523bcadcda4bd329435940dcc49a7c4c0a14d94'],
        },
        Swap: {
          blockNumbers: [21788638, 21791514, 21791514],
          poolAddress: [
            '0x8523bcadcda4bd329435940dcc49a7c4c0a14d94',
            '0x8523bcadcda4bd329435940dcc49a7c4c0a14d94',
            '0x8523bcadcda4bd329435940dcc49a7c4c0a14d94',
          ],
        },
      },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([vaultAddress, events]: [string, EventMappings]) => {
        describe(`Events for Vault: ${vaultAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${vaultAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  describe('Mainnet:0x6b49054c350b47ca9aa1331ab156a1eedbe94e79', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // vault -> EventMappings
    // TODO once we have a new test deployment add tests for: AggregateSwapFeePercentageChanged, SwapFeePercentageChanged, PoolPausedStateChanged
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].vaultAddress]: {
        LiquidityAdded: {
          blockNumbers: [21774068],
          poolAddress: ['0x6b49054c350b47ca9aa1331ab156a1eedbe94e79'],
        },
        LiquidityRemoved: {
          blockNumbers: [21788910],
          poolAddress: ['0x6b49054c350b47ca9aa1331ab156a1eedbe94e79'],
        },
        Swap: {
          blockNumbers: [21788638, 21791514, 21791514],
          poolAddress: [
            '0x6b49054c350b47ca9aa1331ab156a1eedbe94e79',
            '0x6b49054c350b47ca9aa1331ab156a1eedbe94e79',
            '0x6b49054c350b47ca9aa1331ab156a1eedbe94e79',
          ],
        },
      },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([vaultAddress, events]: [string, EventMappings]) => {
        describe(`Events for Vault: ${vaultAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${vaultAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  describe('Base_selected_blocks', function () {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    const blocksToCheck = [
      27674270, 27674570, 27674574, 27674788, 27674853, 27674886, 27674931,
    ];

    const vaultAddress = BalancerV3Config.BalancerV3[network].vaultAddress;

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    describe(`Events for Vault: ${vaultAddress} ${blocksToCheck.length} blocks`, () => {
      for (const blockNumber of blocksToCheck) {
        it(`Check state for block ${blockNumber}`, async function () {
          await testEventSubscriber(
            balancerV3Pool,
            balancerV3Pool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolState(
                balancerV3Pool,
                _blockNumber,
                '0x0657c3467f3bf465fab59b10f1453d665abe507e',
              ),
            blockNumber,
            `${dexKey}_${vaultAddress}`,
            dexHelper.provider,
            stateCompare,
          );
        });
      }
    });
  });

  // This test uses a pool with no rates which means it should match 100%
  describe.only('Mainnet - Test Aggregate Fee (Pool with no rates)', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // vault -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].vaultAddress]: {
        // https://etherscan.io/tx/0x95f9899688fc8fff88bb12e979cdf0fb525b0d3898ab8ba1926ad0561fe035f3
        LiquidityAdded: {
          blockNumbers: [22230469],
          poolAddress: ['0xecd2978447367ec0c944af58c3b8a7b52acfd7a4'],
        },
        // https://etherscan.io/tx/0xed51ddc25384dd5ea91c4c9d5739dcf7ed52d23cb31aa3788b69f2ddbb769f83
        LiquidityRemoved: {
          blockNumbers: [22230647],
          poolAddress: ['0xecd2978447367ec0c944af58c3b8a7b52acfd7a4'],
        },
        Swap: {
          // https://etherscan.io/tx/0xea581b88747c630b49b1f28c45d1d4056a3f97cafd1cce9ce69ec09cfa897db5#eventlog
          blockNumbers: [22230504],
          poolAddress: ['0xecd2978447367ec0c944af58c3b8a7b52acfd7a4'],
        },
      },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([vaultAddress, events]: [string, EventMappings]) => {
        describe(`Events for Vault: ${vaultAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${vaultAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  describe.only('Base SwapFeePercentageChanged', function () {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // vault -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].vaultAddress]: {
        SwapFeePercentageChanged: {
          blockNumbers: [28785522, 28787443, 28789357],
          poolAddress: [
            '0x81a85b9ec797110f2ee665c119e8f28a2456d6f1',
            '0x81a85b9ec797110f2ee665c119e8f28a2456d6f1',
            '0x81a85b9ec797110f2ee665c119e8f28a2456d6f1',
          ],
        },
      },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([vaultAddress, events]: [string, EventMappings]) => {
        describe(`Events for Vault: ${vaultAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${vaultAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  describe.only('ReClamm - Base', function () {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // vault -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].vaultAddress]: {
        VaultAuxiliary: {
          // 31484163: LastTimestampUpdated, DailyPriceShiftExponentUpdated, https://basescan.org/tx/0x5fe5278427b2df26242347d94e3530b4a87bda39efb7f367cc1416edc3db5021
          // 31484217: LastTimestampUpdated, PriceRatioStateUpdated, https://basescan.org/tx/0xade7cb54cb09e874737c2172ef74927e062cf8a5a6ac3bb6d8ae8efee5faf355
          // 31483951: CenterednessMarginUpdated, VirtualBalancesUpdated, PriceRatioStateUpdated, DailyPriceShiftExponentUpdated, LastTimestampUpdated, https://basescan.org/tx/0x2ad9d79feae679cdf3b104643899501a1c44e56d19b06be59872ed0ae87b992c
          blockNumbers: [31484163, 31484217, 31483951],
          poolAddress: [
            '0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B',
            '0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B',
            '0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B',
          ],
        },
      },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([vaultAddress, events]: [string, EventMappings]) => {
        describe(`Events for Vault: ${vaultAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${vaultAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  describe.only('QuantAMM WeightsUpdated', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const logger = dexHelper.getLogger(dexKey);
    let balancerV3Pool: BalancerV3EventPool;

    // UpdateWeightRunner -> EventMappings
    const eventsToTest: Record<Address, EventMappings> = {
      [BalancerV3Config.BalancerV3[network].quantAmmUpdateWeightRunnerAddress!]:
        {
          WeightsUpdated: {
            blockNumbers: [22371000, 22385295],
            poolAddress: [
              '0xd4ed17bbf48af09b87fd7d8c60970f5da79d4852',
              '0xd4Ed17bBF48Af09B87fD7d8C60970f5Da79D4852',
            ],
          },
        },
    };

    beforeEach(async () => {
      balancerV3Pool = new BalancerV3EventPool(
        dexKey,
        network,
        dexHelper,
        logger,
      );
    });

    Object.entries(eventsToTest).forEach(
      ([weightRunnerAddress, events]: [string, EventMappings]) => {
        describe(`Events for WeightRunner: ${weightRunnerAddress}`, () => {
          Object.entries(events).forEach(
            ([eventName, eventData]: [string, EventData]) => {
              describe(`${eventName}`, () => {
                eventData.blockNumbers.forEach((blockNumber: number, i) => {
                  it(`Pool: ${eventData.poolAddress[i]} State after ${blockNumber}`, async function () {
                    await testEventSubscriber(
                      balancerV3Pool,
                      balancerV3Pool.addressesSubscribed,
                      (_blockNumber: number) =>
                        fetchPoolState(
                          balancerV3Pool,
                          _blockNumber,
                          eventData.poolAddress[i],
                        ),
                      blockNumber,
                      `${dexKey}_${weightRunnerAddress}`,
                      dexHelper.provider,
                      stateCompare,
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

  // If need to run through block interval up to a block number
  // describe.skip('Base', function () {
  //   const network = Network.BASE;
  //   const dexHelper = new DummyDexHelper(network);
  //   const logger = dexHelper.getLogger(dexKey);
  //   let balancerV3Pool: BalancerV3EventPool;

  //   const END_BLOCK = 27675048;
  //   const BLOCKS_TO_CHECK = 1000;
  //   const START_BLOCK = END_BLOCK - BLOCKS_TO_CHECK;

  //   const vaultAddress = BalancerV3Config.BalancerV3[network].vaultAddress;

  //   beforeEach(async () => {
  //     balancerV3Pool = new BalancerV3EventPool(
  //       dexKey,
  //       network,
  //       dexHelper,
  //       logger,
  //     );
  //   });

  //   describe(`Events for Vault: ${vaultAddress} blocks ${START_BLOCK} to ${END_BLOCK}`, () => {
  //     for (
  //       let blockNumber = START_BLOCK;
  //       blockNumber <= END_BLOCK;
  //       blockNumber++
  //     ) {
  //       it(`Check state for block ${blockNumber}`, async function () {
  //         await testEventSubscriber(
  //           balancerV3Pool,
  //           balancerV3Pool.addressesSubscribed,
  //           (_blockNumber: number) =>
  //             fetchPoolState(
  //               balancerV3Pool,
  //               _blockNumber,
  //               '0x0657c3467f3bf465fab59b10f1453d665abe507e',
  //             ),
  //           blockNumber,
  //           `${dexKey}_${vaultAddress}`,
  //           dexHelper.provider,
  //           stateCompare,
  //         );
  //       });
  //     }
  //   });
  // });
});
