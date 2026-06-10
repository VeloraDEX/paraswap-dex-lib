/* eslint-disable no-console */
/*
 * End-to-end benchmark: getPricesVolume with batch Rust registry
 * across UniswapV3, PancakeSwapV3, SolidlyV3, and UniswapV4.
 * Compares Rust vs JS (useRust=false) for each DEX.
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { Network, SwapSide } from '../src/constants';
import { DummyDexHelper } from '../src/dex-helper';
import { UniswapV3 } from '../src/dex/uniswap-v3/uniswap-v3';
import { PancakeswapV3 } from '../src/dex/pancakeswap-v3/pancakeswap-v3';
import { SolidlyV3 } from '../src/dex/solidly-v3/solidly-v3';
import { UniswapV4 } from '../src/dex/uniswap-v4/uniswap-v4';
import { performance } from 'perf_hooks';
import { getBigIntPow } from '../src/utils';

const RUNS = 1000;

function stats(m: number[]) {
  const s = [...m].sort((a, b) => a - b);
  return {
    p50: s[Math.floor(s.length * 0.5)].toFixed(3),
    p99: s[Math.floor(s.length * 0.99)].toFixed(3),
    max: s[s.length - 1].toFixed(3),
  };
}

async function bench(fn: () => any): Promise<ReturnType<typeof stats>> {
  const measures: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    await fn();
    measures.push(performance.now() - s);
  }
  return stats(measures);
}

const USDC = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
};
const WETH = {
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  decimals: 18,
};

(async () => {
  const dh = new DummyDexHelper(Network.MAINNET);
  const bn = await dh.web3Provider.eth.getBlockNumber();
  console.log(`Block: ${bn} | Runs: ${RUNS}\n`);

  const amounts = [
    0n,
    ...Array.from(
      { length: 53 },
      (_, i) => getBigIntPow(6) * BigInt((i + 1) * 100),
    ),
  ];

  console.log(
    'DEX'.padEnd(16) +
      'pools' +
      ' | ' +
      'JS p50'.padStart(8) +
      'JS p99'.padStart(8) +
      ' | ' +
      'Rust p50'.padStart(9) +
      'Rust p99'.padStart(9) +
      ' | ' +
      'speedup'.padStart(8),
  );
  console.log('-'.repeat(80));

  // --- UniswapV3 ---
  {
    const dex = new UniswapV3(Network.MAINNET, 'UniswapV3', dh);
    // Init with Rust to populate pools
    await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    const poolCount =
      (await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn))
        ?.length ?? 0;

    // JS benchmark (useRust=false)
    const js = await bench(() =>
      dex.getPricesVolume(
        USDC,
        WETH,
        amounts,
        SwapSide.SELL,
        bn,
        undefined,
        undefined,
        undefined,
        false,
      ),
    );
    // Rust benchmark (useRust=true, default)
    const rs = await bench(() =>
      dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn),
    );
    const speedup = (parseFloat(js.p50) / parseFloat(rs.p50)).toFixed(1);
    console.log(
      'UniswapV3'.padEnd(16) +
        `${poolCount}`.padStart(5) +
        ' | ' +
        js.p50.padStart(8) +
        js.p99.padStart(8) +
        ' | ' +
        rs.p50.padStart(9) +
        rs.p99.padStart(9) +
        ' | ' +
        `${speedup}x`.padStart(8),
    );
  }

  // --- PancakeSwapV3 ---
  {
    const dex = new PancakeswapV3(Network.MAINNET, 'PancakeswapV3', dh);
    await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    const poolCount =
      (await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn))
        ?.length ?? 0;

    const js = await bench(() =>
      dex.getPricesVolume(
        USDC,
        WETH,
        amounts,
        SwapSide.SELL,
        bn,
        undefined,
        undefined,
        undefined,
        false,
      ),
    );
    const rs = await bench(() =>
      dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn),
    );
    const speedup = (parseFloat(js.p50) / parseFloat(rs.p50)).toFixed(1);
    console.log(
      'PancakeSwapV3'.padEnd(16) +
        `${poolCount}`.padStart(5) +
        ' | ' +
        js.p50.padStart(8) +
        js.p99.padStart(8) +
        ' | ' +
        rs.p50.padStart(9) +
        rs.p99.padStart(9) +
        ' | ' +
        `${speedup}x`.padStart(8),
    );
  }

  // --- SolidlyV3 ---
  {
    const dex = new SolidlyV3(Network.MAINNET, 'SolidlyV3', dh);
    await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    const poolCount =
      (await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn))
        ?.length ?? 0;

    const js = await bench(() =>
      dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn),
    );
    const rs = await bench(() =>
      dex.getPricesVolume(
        USDC,
        WETH,
        amounts,
        SwapSide.SELL,
        bn,
        undefined,
        undefined,
        undefined,
        true,
      ),
    );
    const speedup = (parseFloat(js.p50) / parseFloat(rs.p50)).toFixed(1);
    console.log(
      'SolidlyV3'.padEnd(16) +
        `${poolCount}`.padStart(5) +
        ' | ' +
        js.p50.padStart(8) +
        js.p99.padStart(8) +
        ' | ' +
        rs.p50.padStart(9) +
        rs.p99.padStart(9) +
        ' | ' +
        `${speedup}x`.padStart(8),
    );
  }

  // --- UniswapV4 ---
  {
    const dex = new UniswapV4(Network.MAINNET, 'UniswapV4', dh);
    await dex.initializePricing(bn);
    const ETH = {
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
    };
    await dex.getPoolIdentifiers(USDC, WETH, SwapSide.SELL, bn);
    await dex.getPoolIdentifiers(USDC, ETH, SwapSide.SELL, bn);
    await new Promise(resolve => setTimeout(resolve, 3000));

    let r = await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    if (!r || r.length === 0) {
      r = await dex.getPricesVolume(USDC, ETH, amounts, SwapSide.SELL, bn);
    }
    const poolCount = r?.length ?? 0;

    if (poolCount > 0) {
      const js = await bench(() =>
        dex.getPricesVolume(
          USDC,
          WETH,
          amounts,
          SwapSide.SELL,
          bn,
          undefined,
          undefined,
          undefined,
          false,
        ),
      );
      const rs = await bench(() =>
        dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn),
      );
      const speedup = (parseFloat(js.p50) / parseFloat(rs.p50)).toFixed(1);
      console.log(
        'UniswapV4'.padEnd(16) +
          `${poolCount}`.padStart(5) +
          ' | ' +
          js.p50.padStart(8) +
          js.p99.padStart(8) +
          ' | ' +
          rs.p50.padStart(9) +
          rs.p99.padStart(9) +
          ' | ' +
          `${speedup}x`.padStart(8),
      );
    } else {
      console.log(
        'UniswapV4'.padEnd(16) +
          '    0 | V4 pools need subgraph (not available in DummyDexHelper)',
      );
    }
  }

  console.log('-'.repeat(80));
  process.exit(0);
})();
