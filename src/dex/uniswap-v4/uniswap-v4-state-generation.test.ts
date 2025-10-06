/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper';
import { Network } from '../../constants';
import { UniswapV4Pool } from './uniswap-v4-pool';
import { UniswapV4Config } from './config';
import { Logger } from 'log4js';

/*
{
  pools(first: 5, orderBy: volumeUSD, orderDirection: desc) {
    id
    fee: feeTier
    tickSpacing
    hooks
    currency0: token0 {
      id
    }
    currency1:token1 {
      volume
      id
    }
  }
}
*/

// Pool configuration structure
interface PoolConfig {
  id: string;
  currency0: {
    id: string;
  };
  currency1: {
    id: string;
  };
  fee: string;
  hooks: string;
  tickSpacing: string;
}

// Test pools configuration
const testPoolsConfig: Record<number, PoolConfig[]> = {
  [Network.BASE]: [
    {
      id: '0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a',
      currency0: { id: '0x0000000000000000000000000000000000000000' }, // Native ETH
      currency1: { id: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }, // USDC
      fee: '500',
      hooks: '0x0000000000000000000000000000000000000000',
      tickSpacing: '10',
    },
  ],
  [Network.MAINNET]: [
    {
      currency0: {
        id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      },
      currency1: {
        id: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      },
      fee: '10',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x8aa4e11cbdf30eedc92100f4c8a31ff748e201d44712cc8c90d189edaa8e4e47',
      tickSpacing: '1',
    },
    {
      currency0: {
        id: '0x0000000000000000000000000000000000000000',
      },
      currency1: {
        id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      },
      fee: '500',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x21c67e77068de97969ba93d4aab21826d33ca12bb9f565d8496e8fda8a82ca27',
      tickSpacing: '10',
    },
    {
      currency0: {
        id: '0x0000000000000000000000000000000000000000',
      },
      currency1: {
        id: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      },
      fee: '500',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x72331fcb696b0151904c03584b66dc8365bc63f8a144d89a773384e3a579ca73',
      tickSpacing: '10',
    },
    {
      currency0: {
        id: '0x0000000000000000000000000000000000000000',
      },
      currency1: {
        id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      },
      fee: '100',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0x00b9edc1583bf6ef09ff3a09f6c23ecb57fd7d0bb75625717ec81eed181e22d7',
      tickSpacing: '1',
    },
    {
      currency0: {
        id: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
      },
      currency1: {
        id: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      },
      fee: '63',
      hooks: '0x0000000000000000000000000000000000000000',
      id: '0xaae9da4a878406eb1de54efac30e239fd56d54fb8051e59f6fee529bc9609b3b',
      tickSpacing: '1',
    },
  ],
};

describe('UniswapV4Pool State Generation', () => {
  // Helper function to test pools for a given network
  const testNetworkPools = (network: Network, focusTests = false) => {
    const describeFn = focusTests ? describe.only : describe;

    describeFn(`${Network[network]} Network`, () => {
      const config = UniswapV4Config.UniswapV4[network];
      const pools = testPoolsConfig[network] || [];
      // const pools = [testPoolsConfig[network][0]];

      if (!config) {
        it('should skip tests when config is not available', () => {
          console.log(`No UniswapV4 config for ${Network[network]}`);
          expect(true).toBe(true);
        });
        return;
      }

      if (pools.length === 0) {
        it('should skip tests when no pools configured', () => {
          console.log(`No test pools configured for ${Network[network]}`);
          expect(true).toBe(true);
        });
        return;
      }

      pools.forEach((poolConfig, index) => {
        describe(`Pool ${index + 1}: ${poolConfig.id.substring(
          0,
          10,
        )}... (${poolConfig.currency0.id.substring(
          0,
          6,
        )}.../${poolConfig.currency1.id.substring(0, 6)}..., fee: ${
          poolConfig.fee
        })`, () => {
          let dexHelper: DummyDexHelper;
          let pool: UniswapV4Pool;
          let logger: Logger;

          beforeAll(async () => {
            dexHelper = new DummyDexHelper(network);
            logger = dexHelper.getLogger('UniswapV4Pool');

            // Initialize pool with test data
            pool = new UniswapV4Pool(
              dexHelper,
              'UniswapV4',
              network,
              config,
              logger,
              '',
              poolConfig.id,
              poolConfig.currency0.id,
              poolConfig.currency1.id,
              poolConfig.fee,
              poolConfig.hooks,
              0n, // sqrtPriceX96 - will be fetched from state
              '0', // tick - will be fetched from state
              poolConfig.tickSpacing,
            );

            // using Mutlicall to fetch initial state
            await pool.initialize(await dexHelper.provider.getBlockNumber());

            const state = pool.getStaleState();
            if (state && state.isValid) {
              pool.tick = state.slot0.tick.toString();
              pool.sqrtPriceX96 = state.slot0.sqrtPriceX96;
            }
          });

          describe('State Generation Comparison', () => {
            jest.setTimeout(30000);

            it('should generate consistent state between subgraph and multicall methods', async () => {
              const blockNumber = await dexHelper.provider.getBlockNumber();

              console.log('Generating state using stateMulticall method...');
              const multicallState = await pool.generateState(blockNumber);

              console.log(`Testing state generation at block ${blockNumber}`);
              console.log(`Pool ID: ${poolConfig.id}`);
              console.log(
                `Currency0: ${poolConfig.currency0.id}, Currency1: ${poolConfig.currency1.id}`,
              );
              console.log(
                `Fee: ${poolConfig.fee}, TickSpacing: ${poolConfig.tickSpacing}`,
              );

              // Generate state using subgraph method
              console.log('Generating state using subgraph method...');
              const subgraphState = await pool.generateStateWithSubgraph(
                blockNumber,
              );

              // Only run multicall test if stateMulticall is configured
              if (!config.stateMulticall) {
                console.log(
                  'StateMulticall not configured for this network, skipping comparison',
                );
                expect(subgraphState).toBeDefined();
                expect(subgraphState.isValid).toBe(true);
                return;
              }

              // Compare basic pool properties
              expect(multicallState.id).toBe(subgraphState.id);
              expect(multicallState.token0).toBe(subgraphState.token0);
              expect(multicallState.token1).toBe(subgraphState.token1);
              expect(multicallState.fee).toBe(subgraphState.fee);
              expect(multicallState.hooks).toBe(subgraphState.hooks);
              expect(multicallState.tickSpacing).toBe(
                subgraphState.tickSpacing,
              );
              expect(multicallState.isValid).toBe(true);
              expect(subgraphState.isValid).toBe(true);

              // Compare slot0 data
              console.log('Comparing slot0 data...');
              expect(multicallState.slot0.sqrtPriceX96).toBe(
                subgraphState.slot0.sqrtPriceX96,
              );
              expect(multicallState.slot0.tick).toBe(subgraphState.slot0.tick);
              expect(multicallState.slot0.protocolFee).toBe(
                subgraphState.slot0.protocolFee,
              );
              expect(multicallState.slot0.lpFee).toBe(
                subgraphState.slot0.lpFee,
              );

              // Compare liquidity
              expect(multicallState.liquidity).toBe(subgraphState.liquidity);

              // Compare fee growth globals
              expect(multicallState.feeGrowthGlobal0X128).toBe(
                subgraphState.feeGrowthGlobal0X128,
              );
              expect(multicallState.feeGrowthGlobal1X128).toBe(
                subgraphState.feeGrowthGlobal1X128,
              );

              // Compare tick data
              console.log(
                `Comparing tick data - Subgraph: ${
                  Object.keys(subgraphState.ticks).length
                } ticks, Multicall: ${
                  Object.keys(multicallState.ticks).length
                } ticks`,
              );

              // The multicall method might return more or fewer ticks than subgraph
              // We'll check that all non-zero ticks from both methods match when they overlap
              const allTickKeys = new Set([
                ...Object.keys(subgraphState.ticks),
                ...Object.keys(multicallState.ticks),
              ]);

              for (const tickKey of allTickKeys) {
                const subgraphTick = subgraphState.ticks[tickKey];
                const multicallTick = multicallState.ticks[tickKey];

                if (multicallTick) {
                  // Both methods have this tick
                  expect(multicallTick.liquidityGross).toBe(
                    subgraphTick.liquidityGross,
                  );
                  expect(multicallTick.liquidityNet).toBe(
                    subgraphTick.liquidityNet,
                  );
                }
              }

              // Compare tick bitmap data
              console.log(
                `Comparing bitmap data - Subgraph: ${
                  Object.keys(subgraphState.tickBitmap).length
                } entries, Multicall: ${
                  Object.keys(multicallState.tickBitmap).length
                } entries`,
              );

              const allBitmapKeys = new Set([
                ...Object.keys(subgraphState.tickBitmap),
                ...Object.keys(multicallState.tickBitmap),
              ]);

              for (const bitmapKey of allBitmapKeys) {
                const subgraphBitmap =
                  subgraphState.tickBitmap[bitmapKey] ?? 0n;
                const multicallBitmap =
                  multicallState.tickBitmap[bitmapKey] ?? 0n;

                if (multicallBitmap !== 0n) {
                  expect(subgraphBitmap).toEqual(multicallBitmap);
                  console.log(
                    `Bitmap ${bitmapKey} differs: Subgraph=${subgraphBitmap}, Multicall=${multicallBitmap}`,
                  );
                }
              }

              // Log summary
              console.log(
                'State generation comparison completed successfully!',
              );
              console.log(`Pool liquidity: ${subgraphState.liquidity}`);
              console.log(`Current tick: ${subgraphState.slot0.tick}`);
              console.log(`SqrtPriceX96: ${subgraphState.slot0.sqrtPriceX96}`);
            }, 30000);
          });
        });
      });
    });
  };

  // Test Base network
  // testNetworkPools(Network.BASE);

  // Test Mainnet network with focus (only run these tests)
  testNetworkPools(Network.MAINNET);

  // You can add more networks here:
  // testNetworkPools(Network.OPTIMISM);
  // testNetworkPools(Network.ARBITRUM);
  // etc.
});
