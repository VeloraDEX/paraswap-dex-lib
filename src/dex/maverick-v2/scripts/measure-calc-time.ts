/*

Measures real calculation time for MaverickV2 swap math.
Uses performance.now() for sub-millisecond precision.

*/
import * as dotenv from 'dotenv';
import { getLogger } from '../../../lib/log4js';
dotenv.config();
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { MaverickV2 } from '../maverick-v2';
import { performance } from 'perf_hooks';
import { getBigIntPow } from '../../../utils';
import { Token } from '../../../types';

const logger = getLogger('MaverickV2MeasureScript');

const runsNumber = 1000;
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const mavV2 = new MaverickV2(network, 'MaverickV2', dexHelper);
const side = SwapSide.SELL;

const USDT: Token = {
  address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  decimals: 6,
};
const USDC: Token = {
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
};

const pairs = [
  {
    name: 'USDT/USDC',
    src: USDT,
    dest: USDC,
  },
];

function generateAmounts(decimals: number): bigint[] {
  const unit = getBigIntPow(decimals);
  const amounts: bigint[] = [0n];

  // Small amounts (dust to modest)
  // for (let i = 1; i <= 10; i++) {
  //   amounts.push(unit * BigInt(i));
  // }
  // // Medium amounts (10–10k stepping by 50)
  for (let i = 50; i <= 1_000; i += 50) {
    amounts.push(unit * BigInt(i));
  }
  // // Large amounts to stress tick crossings
  // for (const m of [
  //   50_000n,
  //   100_000n,
  //   500_000n,
  //   1_000_000n,
  //   5_000_000n,
  //   10_000_000n,
  //   50_000_000n,
  // ]) {
  //   amounts.push(unit * m);
  // }

  return amounts;
}

const aggregateAndPrintMeasures = (measures: number[], label: string) => {
  const sorted = [...measures].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b);
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const max = sorted[sorted.length - 1];

  logger.info(
    `  [${label}] avg=${avg.toFixed(3)}ms | p50=${p50.toFixed(3)}ms | ` +
      `p95=${p95.toFixed(3)}ms | p99=${p99.toFixed(3)}ms | max=${max.toFixed(
        3,
      )}ms`,
  );
};

let totalMs = 0;

async function benchmarkPair(
  pairConfig: (typeof pairs)[0],
  blockNumber: number,
) {
  const { name, src, dest } = pairConfig;
  const amounts = generateAmounts(src.decimals);

  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`PAIR: ${name} (${amounts.length} amounts, ${runsNumber} runs)`);
  logger.info(`${'='.repeat(60)}\n`);

  // Initialize pools via getPricesVolume
  await mavV2.getPricesVolume(src, dest, amounts, side, blockNumber);

  // Collect pools for this pair
  const poolEntries = Object.values(mavV2.pools)
    .filter(pool => {
      const a = src.address.toLowerCase();
      const b = dest.address.toLowerCase();
      const pA = pool.tokenA.address.toLowerCase();
      const pB = pool.tokenB.address.toLowerCase();
      return (pA === a && pB === b) || (pA === b && pB === a);
    })
    .map(pool => ({
      pool,
      state: pool.getState(blockNumber),
    }))
    .filter(p => p.state !== null);

  if (poolEntries.length === 0) {
    logger.warn(`  No pools found for ${name}`);
    return;
  }

  logger.info(`  Pools: ${poolEntries.length} total\n`);

  // Log pool complexity
  for (const p of poolEntries) {
    const tickCount = Object.keys(p.state!.ticks).length;
    const binCount = Object.keys(p.state!.bins).length;
    logger.info(
      `  ${p.pool.address}: ${tickCount} ticks, ${binCount} bins, activeTick=${
        p.state!.activeTick
      }`,
    );
  }
  logger.info('');

  // Benchmark: call pool.swap() for each amount (matches production flow)
  for (const entry of poolEntries) {
    const { pool } = entry;
    const measures: number[] = [];

    for (let i = 0; i < runsNumber; i++) {
      const start = performance.now();
      for (const amount of amounts) {
        if (amount === 0n) continue;
        pool.swap(amount, src, dest, false);
      }
      const elapsed = performance.now() - start;
      measures.push(elapsed);
      totalMs += elapsed;
    }
    aggregateAndPrintMeasures(measures, `JS ${pool.address.slice(0, 10)}`);
  }
}

(async function main() {
  logger.info(`Started MaverickV2 benchmark (${runsNumber} runs each)\n`);

  const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
  logger.info(`Block: ${blockNumber}\n`);

  await mavV2.initializePricing(blockNumber);
  for (const pair of pairs) {
    try {
      await benchmarkPair(pair, blockNumber);
    } catch (e) {
      logger.error(`Failed to benchmark ${pair.name}:`, e);
    }
  }

  logger.info(`\n${'='.repeat(60)}`);
  logger.info('TOTALS');
  logger.info(`${'='.repeat(60)}`);
  logger.info(`  JS total: ${totalMs.toFixed(3)}ms`);

  logger.info(`\nBenchmark complete.`);
  process.exit(0);
})();
