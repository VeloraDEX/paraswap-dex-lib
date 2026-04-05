/* eslint-disable no-console */
/*
 * End-to-end benchmark: getPricesVolume with batch Rust registry
 * across UniswapV3, PancakeSwapV3, and SolidlyV3.
 */
import * as dotenv from 'dotenv';
dotenv.config();
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { UniswapV3 } from '../uniswap-v3';
import { PancakeswapV3 } from '../../pancakeswap-v3/pancakeswap-v3';
import { SolidlyV3 } from '../../solidly-v3/solidly-v3';
import { UniswapV4 } from '../../uniswap-v4/uniswap-v4';
import { performance } from 'perf_hooks';
import { getBigIntPow } from '../../../utils';

const RUNS = 1000;

function stats(m: number[]) {
  const s = [...m].sort((a, b) => a - b);
  return {
    p50: s[Math.floor(s.length * 0.5)].toFixed(3),
    p99: s[Math.floor(s.length * 0.99)].toFixed(3),
    max: s[s.length - 1].toFixed(3),
  };
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

  // --- UniswapV3 ---
  {
    const dex = new UniswapV3(Network.MAINNET, 'UniswapV3', dh);
    const r = await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    const poolCount = r?.length ?? 0;
    const regCount = dex.registry?.poolCount() ?? 0;
    const rustCount = r?.filter(p => (p.data as any).useRust).length ?? 0;

    const measures: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const s = performance.now();
      await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
      measures.push(performance.now() - s);
    }
    const st = stats(measures);
    console.log(
      `UniswapV3     | ${poolCount} pools (${rustCount} rust, ${regCount} registry) | p50=${st.p50}ms  p99=${st.p99}ms  max=${st.max}ms`,
    );
  }

  // --- PancakeSwapV3 ---
  {
    const dex = new PancakeswapV3(Network.MAINNET, 'PancakeswapV3', dh);
    const r = await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    const poolCount = r?.length ?? 0;
    const regCount = (dex as any).registry?.poolCount() ?? 0;
    const rustCount = r?.filter(p => (p.data as any).useRust).length ?? 0;

    const measures: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const s = performance.now();
      await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
      measures.push(performance.now() - s);
    }
    const st = stats(measures);
    console.log(
      `PancakeSwapV3 | ${poolCount} pools (${rustCount} rust, ${regCount} registry) | p50=${st.p50}ms  p99=${st.p99}ms  max=${st.max}ms`,
    );
  }

  // --- SolidlyV3 ---
  {
    const dex = new SolidlyV3(Network.MAINNET, 'SolidlyV3', dh);
    const r = await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    const poolCount = r?.length ?? 0;
    const regCount = (dex as any).registry?.poolCount() ?? 0;
    const rustCount = r?.filter(p => (p.data as any).useRust).length ?? 0;

    const measures: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const s = performance.now();
      await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
      measures.push(performance.now() - s);
    }
    const st = stats(measures);
    console.log(
      `SolidlyV3     | ${poolCount} pools (${rustCount} rust, ${regCount} registry) | p50=${st.p50}ms  p99=${st.p99}ms  max=${st.max}ms`,
    );
  }

  // --- UniswapV4 ---
  {
    const dex = new UniswapV4(Network.MAINNET, 'UniswapV4', dh);
    await dex.initializePricing(bn);
    // V4 pools may use WETH or native ETH
    const ETH = {
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
    };
    await dex.getPoolIdentifiers(USDC, WETH, SwapSide.SELL, bn);
    await dex.getPoolIdentifiers(USDC, ETH, SwapSide.SELL, bn);
    // Wait for async pool state generation
    await new Promise(resolve => setTimeout(resolve, 3000));
    let r = await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
    if (!r || r.length === 0) {
      r = await dex.getPricesVolume(USDC, ETH, amounts, SwapSide.SELL, bn);
    }
    const poolCount = r?.length ?? 0;
    const regCount = (dex as any).v4Registry?.poolCount() ?? 0;
    const rustCount = r?.filter(p => (p.data as any).useRust).length ?? 0;

    if (poolCount > 0) {
      const measures: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const s = performance.now();
        await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
        measures.push(performance.now() - s);
      }
      const st = stats(measures);
      console.log(
        `UniswapV4     | ${poolCount} pools (${rustCount} rust, ${regCount} registry) | p50=${st.p50}ms  p99=${st.p99}ms  max=${st.max}ms`,
      );
    } else {
      console.log(`UniswapV4     | 0 pools (no USDC/WETH pools found)`);
    }
  }

  process.exit(0);
})();
