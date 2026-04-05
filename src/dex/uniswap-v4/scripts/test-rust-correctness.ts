/* eslint-disable no-console */
/*
 * V4 Rust correctness test: compares JS vs Rust queryOutputs on real pool states.
 * Directly instantiates pools and generates state, bypassing getPricesVolume.
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { UniswapV4 } from '../uniswap-v4';
import { uniswapV4PoolMath } from '../contract-math/uniswap-v4-pool-math';
import {
  createV4Registry,
  v4RegistrySetPool,
} from '../contract-math/native-bridge';
import { performance } from 'perf_hooks';
import { getBigIntPow } from '../../../utils';
import { Pool } from '../types';

const RUNS = 1000;

(async () => {
  const dh = new DummyDexHelper(Network.MAINNET);
  const bn = await dh.web3Provider.eth.getBlockNumber();
  const dex = new UniswapV4(Network.MAINNET, 'UniswapV4', dh);

  const USDC = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
  };
  const WETH = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
  };

  console.log(`Block: ${bn}\n`);

  // Initialize and discover pools
  await dex.initializePricing(bn);
  const ids = await dex.getPoolIdentifiers(USDC, WETH, SwapSide.SELL, bn);
  console.log(`Pool identifiers: ${ids.length}`);
  ids.forEach(id => console.log(`  ${id}`));

  // Wait for async state generation
  console.log('\nWaiting for pool state generation...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Access pool manager internals to get pool states directly
  const poolManager = (dex as any).poolManager;
  const amounts = [
    0n,
    ...Array.from(
      { length: 20 },
      (_, i) => getBigIntPow(6) * BigInt((i + 1) * 500),
    ),
  ];

  const registry = createV4Registry();
  if (!registry) {
    console.log('Rust addon not available');
    process.exit(1);
  }

  let testedPools = 0;

  for (const poolId of ids) {
    const eventPool = await poolManager.getEventPool(poolId, bn);
    if (!eventPool) {
      console.log(`\n${poolId.slice(0, 16)}... no event pool`);
      continue;
    }

    const state = eventPool.getState(bn);
    if (!state) {
      console.log(`\n${poolId.slice(0, 16)}... no state`);
      continue;
    }

    // Find the Pool object for this id
    const pools: Pool[] = await poolManager.getAvailablePoolsForPair(
      USDC.address.toLowerCase(),
      WETH.address.toLowerCase(),
      bn,
    );
    const pool = pools.find((p: Pool) => p.id === poolId);
    if (!pool) {
      console.log(`\n${poolId.slice(0, 16)}... pool object not found`);
      continue;
    }

    const tickSpacing = pool.key.tickSpacing;
    const fromAddress = USDC.address.toLowerCase();
    const currency0 = pool.key.currency0;
    const zeroForOne =
      fromAddress === currency0 ||
      (fromAddress === WETH.address.toLowerCase() &&
        currency0 === '0x0000000000000000000000000000000000000000');

    console.log(
      `\n${poolId.slice(0, 16)}... tickSpacing=${tickSpacing} ticks=${
        Object.keys(state.ticks).length
      } liquidity=${state.liquidity}`,
    );
    console.log(
      `  sqrtPrice=${state.slot0.sqrtPriceX96} tick=${state.slot0.tick} zeroForOne=${zeroForOne}`,
    );
    console.log(
      `  protocolFee=${state.slot0.protocolFee} lpFee=${state.slot0.lpFee}`,
    );

    // Check if pool has hooks
    const hasHooks =
      pool.key.hooks !== '0x0000000000000000000000000000000000000000';
    if (hasHooks) {
      console.log(`  HOOKS: ${pool.key.hooks} — skipping Rust (hooks need JS)`);
      continue;
    }

    // JS queryOutputs
    const jsOutputs = uniswapV4PoolMath.queryOutputs(
      pool,
      state,
      amounts,
      zeroForOne,
      SwapSide.SELL,
    );

    // Rust queryOutputs via registry
    v4RegistrySetPool(registry, poolId, state, pool);
    const rustResults = registry.queryMany(
      [poolId],
      amounts,
      zeroForOne,
      0, // SELL
    );
    const rustOutputs = rustResults.find((r: any) => r.key === poolId)?.outputs;

    if (!rustOutputs) {
      console.log('  Rust: no results returned');
      continue;
    }

    // Compare
    let mismatches = 0;
    for (let i = 0; i < amounts.length; i++) {
      if (jsOutputs[i] !== rustOutputs[i]) {
        mismatches++;
        if (mismatches <= 5) {
          console.log(
            `  MISMATCH[${i}] amount=${amounts[i]} js=${jsOutputs[i]} rust=${rustOutputs[i]}`,
          );
        }
      }
    }

    if (mismatches === 0) {
      console.log(`  CORRECT: all ${amounts.length} outputs match`);

      // Benchmark
      const jsM: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const s = performance.now();
        uniswapV4PoolMath.queryOutputs(
          pool,
          state,
          amounts,
          zeroForOne,
          SwapSide.SELL,
        );
        jsM.push(performance.now() - s);
      }

      const rustM: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const s = performance.now();
        registry.queryMany([poolId], amounts, zeroForOne, 0);
        rustM.push(performance.now() - s);
      }

      const jsP50 = [...jsM]
        .sort((a, b) => a - b)
        [Math.floor(jsM.length * 0.5)].toFixed(3);
      const rustP50 = [...rustM]
        .sort((a, b) => a - b)
        [Math.floor(rustM.length * 0.5)].toFixed(3);
      const speedup = (parseFloat(jsP50) / parseFloat(rustP50)).toFixed(1);

      console.log(
        `  JS p50=${jsP50}ms  Rust p50=${rustP50}ms  speedup=${speedup}x`,
      );
    } else {
      console.log(`  ${mismatches}/${amounts.length} MISMATCHES`);
    }

    testedPools++;
  }

  console.log(`\nTested ${testedPools} pools`);
  process.exit(0);
})();
