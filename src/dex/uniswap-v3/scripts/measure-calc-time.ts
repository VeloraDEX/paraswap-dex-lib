/*

Measures real calculation time for queryOutputs across multiple token pairs.
Compares JS BigInt vs Rust native addon.

Uses performance.now() for sub-millisecond precision.

*/
import * as dotenv from 'dotenv';
import { getLogger } from '../../../lib/log4js';
import { DeepReadonly } from 'ts-essentials';
dotenv.config();
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { uniswapV3Math } from '../contract-math/uniswap-v3-math';
import { PoolState } from '../types';
import { UniswapV3 } from '../uniswap-v3';
import { performance } from 'perf_hooks';
import {
  createRustHandle,
  nativeAddonAvailable,
  RustPoolHandleType,
} from '../contract-math/native-bridge';
import { getBigIntPow } from '../../../utils';

const logger = getLogger('UniswapV3MeasureScript');

const runsNumber = 1000;
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const uniV3 = new UniswapV3(network, 'UniswapV3', dexHelper);
const side = SwapSide.SELL;

// --- Token addresses ---
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const PEPE = '0x6982508145454Ce325dDbE47a25d4ec3d2311933';
const LINK = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const UNI = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const MKR = '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2';
const SHIB = '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE';

// --- Token pairs to benchmark ---
const pairs = [
  // Stablecoin pairs (tight liquidity, many ticks)
  {
    name: 'USDC/WETH (stable, concentrated)',
    src: { address: USDC, decimals: 6 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'USDT/WETH (stable)',
    src: { address: USDT, decimals: 6 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'DAI/WETH (stable 18-dec)',
    src: { address: DAI, decimals: 18 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'USDC/USDT (stablecoin pair)',
    src: { address: USDC, decimals: 6 },
    dest: { address: USDT, decimals: 6 },
  },
  // Major volatile pairs
  {
    name: 'WBTC/WETH (volatile, wider spread)',
    src: { address: WBTC, decimals: 8 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'LINK/WETH (mid-cap)',
    src: { address: LINK, decimals: 18 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'UNI/WETH (mid-cap)',
    src: { address: UNI, decimals: 18 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'MKR/WETH (low liquidity, few ticks)',
    src: { address: MKR, decimals: 18 },
    dest: { address: WETH, decimals: 18 },
  },
  // Meme / high-volatility (many tick crossings)
  {
    name: 'PEPE/WETH (meme, very volatile)',
    src: { address: PEPE, decimals: 18 },
    dest: { address: WETH, decimals: 18 },
  },
  {
    name: 'SHIB/WETH (meme, high tick density)',
    src: { address: SHIB, decimals: 18 },
    dest: { address: WETH, decimals: 18 },
  },
];

function generateAmounts(decimals: number): bigint[] {
  const unit = getBigIntPow(decimals);
  const amounts: bigint[] = [0n];

  // Small amounts (dust to modest)
  for (let i = 1; i <= 10; i++) {
    amounts.push(unit * BigInt(i));
  }
  // Medium amounts (10–10k stepping by 50)
  for (let i = 50; i <= 10_000; i += 50) {
    amounts.push(unit * BigInt(i));
  }
  // Large amounts to stress tick crossings
  for (const m of [
    50_000n,
    100_000n,
    500_000n,
    1_000_000n,
    5_000_000n,
    10_000_000n,
    50_000_000n,
  ]) {
    amounts.push(unit * m);
  }

  return amounts;
}

const sortTokens = (a: string, b: string) =>
  [a, b].sort((x, y) => (x < y ? -1 : 1));

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

let totalJsMs = 0;
let totalRustMs = 0;

async function benchmarkPair(
  pairConfig: (typeof pairs)[0],
  blockNumber: number,
) {
  const { name, src, dest } = pairConfig;
  const amounts = generateAmounts(src.decimals);

  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`PAIR: ${name} (${amounts.length} amounts, ${runsNumber} runs)`);
  logger.info(`${'='.repeat(60)}\n`);

  // Initialize pools
  await uniV3.getPricesVolume(src, dest, amounts, side, blockNumber);

  const [token0] = sortTokens(
    src.address.toLowerCase(),
    dest.address.toLowerCase(),
  );
  const zeroForOne = token0 === src.address.toLowerCase();

  // Collect pool states
  const poolEntries = Object.entries(uniV3.eventPools)
    .filter(([key]) => {
      const lower0 = src.address.toLowerCase();
      const lower1 = dest.address.toLowerCase();
      const [sorted0, sorted1] = sortTokens(lower0, lower1);
      return key.includes(sorted0) && key.includes(sorted1);
    })
    .filter(([, ep]) => ep != null)
    .map(([key, ep]) => ({
      key: key.split('_').pop()!, // just the fee tier
      state: ep!.getState(blockNumber)!,
    }))
    .filter(p => p.state !== null);

  if (poolEntries.length === 0) {
    logger.warn(`  No pools found for ${name}`);
    return;
  }

  logger.info(
    `  Pools: ${poolEntries.map(p => `fee=${p.key}`).join(', ')} (${
      poolEntries.length
    } total)\n`,
  );

  // Count ticks per pool to understand complexity
  for (const p of poolEntries) {
    const tickCount = Object.keys(p.state.ticks).length;
    const bitmapCount = Object.keys(p.state.tickBitmap).length;
    logger.info(
      `  fee=${p.key}: ${tickCount} ticks, ${bitmapCount} bitmap words, liquidity=${p.state.liquidity}`,
    );
  }
  logger.info('');

  // --- JS benchmark per pool ---
  logger.info('  --- JS (per pool) ---');
  for (const pool of poolEntries) {
    const measures: number[] = [];
    for (let i = 0; i < runsNumber; i++) {
      const start = performance.now();
      uniswapV3Math.queryOutputs(pool.state, amounts, zeroForOne, side);
      const elapsed = performance.now() - start;
      measures.push(elapsed);
      totalJsMs += elapsed;
    }
    aggregateAndPrintMeasures(measures, `JS fee=${pool.key}`);
  }

  // --- Rust benchmark per pool ---
  if (nativeAddonAvailable) {
    logger.info('  --- Rust (per pool) ---');
    for (const pool of poolEntries) {
      const handle = createRustHandle(pool.state);
      if (!handle) {
        logger.warn(`  Failed to create Rust handle for fee=${pool.key}`);
        continue;
      }

      const measures: number[] = [];
      for (let i = 0; i < runsNumber; i++) {
        const start = performance.now();
        handle.queryOutputs(amounts, zeroForOne, 0);
        const elapsed = performance.now() - start;
        measures.push(elapsed);
        totalRustMs += elapsed;
      }
      aggregateAndPrintMeasures(measures, `Rust fee=${pool.key}`);

      // Correctness check
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
              `  MISMATCH fee=${pool.key} amount[${k}]=${amounts[k]} ` +
                `js=${jsResult.outputs[k]} rust=${rustResult.outputs[k]}`,
            );
          }
        }
      }
      if (mismatches === 0) {
        logger.info(`  fee=${pool.key}: all ${amounts.length} outputs match ✓`);
      } else {
        logger.error(
          `  fee=${pool.key}: ${mismatches}/${amounts.length} MISMATCHES`,
        );
      }
    }
  }
}

(async function main() {
  logger.info(`Started multi-pair benchmark (${runsNumber} runs each)\n`);

  const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
  logger.info(`Block: ${blockNumber}\n`);

  for (const pair of pairs) {
    try {
      await benchmarkPair(pair, blockNumber);
    } catch (e) {
      logger.error(`Failed to benchmark ${pair.name}:`, e);
    }
  }

  if (!nativeAddonAvailable) {
    logger.info(
      '\nRust addon not available. Build with: cd native && npm run build',
    );
  }

  logger.info(`\n${'='.repeat(60)}`);
  logger.info('TOTALS');
  logger.info(`${'='.repeat(60)}`);
  logger.info(`  JS total:   ${totalJsMs.toFixed(3)}ms`);
  if (nativeAddonAvailable) {
    logger.info(`  Rust total: ${totalRustMs.toFixed(3)}ms`);
    logger.info(`  Speedup:    ${(totalJsMs / totalRustMs).toFixed(2)}x`);
  }

  logger.info(`\nBenchmark complete.`);
  process.exit(0);
})();
