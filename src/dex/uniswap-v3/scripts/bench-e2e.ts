/* eslint-disable no-console */
import * as dotenv from 'dotenv';
dotenv.config();
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { UniswapV3 } from '../uniswap-v3';
import { performance } from 'perf_hooks';
import { getBigIntPow } from '../../../utils';

(async () => {
  const dh = new DummyDexHelper(Network.MAINNET);
  const bn = await dh.web3Provider.eth.getBlockNumber();
  const dex = new UniswapV3(Network.MAINNET, 'UniswapV3', dh);

  const USDC = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
  };
  const WETH = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    decimals: 18,
  };
  const amounts = [
    0n,
    ...Array.from(
      { length: 53 },
      (_, i) => getBigIntPow(6) * BigInt((i + 1) * 100),
    ),
  ];

  // First call initializes pools
  const result = await dex.getPricesVolume(
    USDC,
    WETH,
    amounts,
    SwapSide.SELL,
    bn,
  );
  if (!result) {
    console.log('No results');
    process.exit(1);
  }

  console.log(`getPricesVolume: ${result.length} pool results`);
  for (const r of result) {
    console.log(
      `  ${(r.poolAddresses || [])[0]?.slice(0, 10)}... useRust=${
        (r.data as any).useRust
      } unit=${r.unit}`,
    );
  }
  console.log(`Registry pools: ${dex.registry?.poolCount() ?? 'N/A'}`);

  // Benchmark
  const measures: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const s = performance.now();
    await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    measures.push(performance.now() - s);
  }
  const sorted = [...measures].sort((a, b) => a - b);
  console.log(`\ngetPricesVolume end-to-end (1000 runs):`);
  console.log(`  p50=${sorted[Math.floor(sorted.length * 0.5)].toFixed(3)}ms`);
  console.log(`  p99=${sorted[Math.floor(sorted.length * 0.99)].toFixed(3)}ms`);
  console.log(`  max=${sorted[sorted.length - 1].toFixed(3)}ms`);
  process.exit(0);
})();
