/*
 * Benchmark: Solidly V3 queryOutputs — JS vs Rust native addon.
 * Verifies correctness and measures per-pool performance.
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { getLogger } from '../../../lib/log4js';
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { uniswapV3Math } from '../contract-math/uniswap-v3-math';
import { SolidlyV3 } from '../solidly-v3';
import { performance } from 'perf_hooks';
import {
  createSolidlyRustHandle,
  nativeAddonAvailable,
} from '../contract-math/native-bridge';
import { getBigIntPow } from '../../../utils';

const logger = getLogger('SolidlyV3Benchmark');
const runsNumber = 1000;
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const dex = new SolidlyV3(network, 'SolidlyV3', dexHelper);
const side = SwapSide.SELL;

const pairs = [
  {
    name: 'USDC/WETH',
    src: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
    },
    dest: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
    },
  },
  {
    name: 'USDC/USDT',
    src: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
    },
    dest: {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
    },
  },
  {
    name: 'WBTC/WETH',
    src: {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      decimals: 8,
    },
    dest: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
    },
  },
];

function generateAmounts(decimals: number): bigint[] {
  const unit = getBigIntPow(decimals);
  const amounts: bigint[] = [0n];
  for (let i = 1; i <= 50; i++) amounts.push(unit * BigInt(i * 100));
  amounts.push(unit * 100000n, unit * 1000000n, unit * 10000000n);
  return amounts;
}

const sortTokens = (a: string, b: string) =>
  [a, b].sort((x, y) => (x < y ? -1 : 1));

function printStats(measures: number[], label: string) {
  const sorted = [...measures].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b) / sorted.length;
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
}

async function benchmarkPair(pair: (typeof pairs)[0], blockNumber: number) {
  const { name, src, dest } = pair;
  const amounts = generateAmounts(src.decimals);
  const [token0] = sortTokens(
    src.address.toLowerCase(),
    dest.address.toLowerCase(),
  );
  const zeroForOne = token0 === src.address.toLowerCase();

  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`PAIR: ${name} (${amounts.length} amounts, ${runsNumber} runs)`);
  logger.info(`${'='.repeat(60)}\n`);

  await dex.getPricesVolume(src, dest, amounts, side, blockNumber);

  const poolEntries = Object.entries(dex.eventPools)
    .filter(([key]) => {
      const [s0, s1] = sortTokens(
        src.address.toLowerCase(),
        dest.address.toLowerCase(),
      );
      return key.includes(s0) && key.includes(s1);
    })
    .filter(([, ep]) => ep != null)
    .map(([key, ep]) => ({
      key: key.split('_').pop()!,
      pool: ep!,
      state: ep!.getState(blockNumber)!,
    }))
    .filter(p => p.state !== null);

  if (!poolEntries.length) {
    logger.warn(`  No pools found for ${name}`);
    return;
  }

  logger.info(
    `  Pools: ${poolEntries.map(p => `tickSpacing=${p.key}`).join(', ')}\n`,
  );
  for (const p of poolEntries) {
    const ticks = Object.keys(p.state.ticks).length;
    logger.info(
      `  tickSpacing=${p.key}: ${ticks} ticks, fee=${p.state.slot0.fee}, liquidity=${p.state.liquidity}`,
    );
  }
  logger.info('');

  logger.info('  --- JS ---');
  for (const pool of poolEntries) {
    const measures: number[] = [];
    for (let i = 0; i < runsNumber; i++) {
      const start = performance.now();
      uniswapV3Math.queryOutputs(pool.state, amounts, zeroForOne, side);
      measures.push(performance.now() - start);
    }
    printStats(measures, `JS ts=${pool.key}`);
  }

  if (nativeAddonAvailable) {
    logger.info('  --- Rust ---');
    for (const pool of poolEntries) {
      const handle = createSolidlyRustHandle(pool.state);
      if (!handle) {
        logger.warn(`  Failed to create Rust handle for ts=${pool.key}`);
        continue;
      }

      const measures: number[] = [];
      for (let i = 0; i < runsNumber; i++) {
        const start = performance.now();
        handle.queryOutputs(amounts, zeroForOne, 0);
        measures.push(performance.now() - start);
      }
      printStats(measures, `Rust ts=${pool.key}`);

      // Correctness
      const jsResult = uniswapV3Math.queryOutputs(
        pool.state,
        amounts,
        zeroForOne,
        side,
      );
      const rustResult = handle.queryOutputs(amounts, zeroForOne, 0);
      let mismatches = 0;
      for (let k = 0; k < amounts.length; k++) {
        if (jsResult.outputs[k] !== rustResult.outputs[k]) {
          mismatches++;
          if (mismatches <= 3) {
            logger.error(
              `  MISMATCH ts=${pool.key} amount[${k}]=${amounts[k]} ` +
                `js=${jsResult.outputs[k]} rust=${rustResult.outputs[k]}`,
            );
          }
        }
      }
      logger.info(
        mismatches === 0
          ? `  ts=${pool.key}: all ${amounts.length} outputs match ✓`
          : `  ts=${pool.key}: ${mismatches}/${amounts.length} MISMATCHES`,
      );
    }
  } else {
    logger.info('  Rust addon not available');
  }
}

(async function main() {
  logger.info(`Solidly V3 benchmark (${runsNumber} runs)\n`);
  const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
  logger.info(`Block: ${blockNumber}`);

  for (const pair of pairs) {
    try {
      await benchmarkPair(pair, blockNumber);
    } catch (e) {
      logger.error(`Failed ${pair.name}:`, e);
    }
  }

  logger.info('\nDone.');
  process.exit(0);
})();
