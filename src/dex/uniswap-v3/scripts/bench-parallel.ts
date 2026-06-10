/* eslint-disable no-console */
import * as dotenv from 'dotenv';
dotenv.config();
import { Network, SwapSide } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper';
import { uniswapV3Math } from '../contract-math/uniswap-v3-math';
import { UniswapV3 } from '../uniswap-v3';
import { createRustHandle } from '../contract-math/native-bridge';
import { performance } from 'perf_hooks';
import { getBigIntPow } from '../../../utils';
import {
  TICK_BITMAP_TO_USE_BY_CHAIN,
  TICK_BITMAP_BUFFER_BY_CHAIN,
  TICK_BITMAP_TO_USE,
  TICK_BITMAP_BUFFER,
} from '../constants';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const native = require('../../../../native/index.js');

const RUNS = 2000;

function stats(m: number[]) {
  const s = [...m].sort((a, b) => a - b);
  return {
    avg: (s.reduce((a, b) => a + b) / s.length).toFixed(3),
    p50: s[Math.floor(s.length * 0.5)].toFixed(3),
    p99: s[Math.floor(s.length * 0.99)].toFixed(3),
    max: s[s.length - 1].toFixed(3),
  };
}

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
  const WBTC = {
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    decimals: 8,
  };
  const amounts = [
    0n,
    ...Array.from(
      { length: 53 },
      (_, i) => getBigIntPow(6) * BigInt((i + 1) * 100),
    ),
  ];

  await dex.getPricesVolume(USDC, WETH, amounts, SwapSide.SELL, bn);
  await dex.getPricesVolume(
    WBTC,
    WETH,
    [
      0n,
      ...Array.from({ length: 53 }, (_, i) => getBigIntPow(8) * BigInt(i + 1)),
    ],
    SwapSide.SELL,
    bn,
  );

  const zfo =
    [USDC.address.toLowerCase(), WETH.address.toLowerCase()].sort()[0] ===
    USDC.address.toLowerCase();

  const pools: { key: string; state: any }[] = [];
  for (const [k, ep] of Object.entries(dex.eventPools)) {
    if (!ep) continue;
    const st = ep.getState(bn);
    if (!st || st.liquidity <= 0n) continue;
    pools.push({ key: k, state: st });
  }

  console.log(
    `\nPools: ${pools.length} | Amounts: ${amounts.length} | Runs: ${RUNS}\n`,
  );

  // JS sequential
  const jsM: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    for (const p of pools)
      uniswapV3Math.queryOutputs(p.state, amounts, zfo, SwapSide.SELL);
    jsM.push(performance.now() - s);
  }
  const js = stats(jsM);
  console.log(
    `JS sequential:   avg=${js.avg}ms  p50=${js.p50}ms  p99=${js.p99}ms  max=${js.max}ms`,
  );

  // Rust sequential
  const handles = pools.map(p => ({
    key: p.key,
    h: createRustHandle(p.state)!,
  }));
  const rsM: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    for (const h of handles) h.h.queryOutputs(amounts, zfo, 0);
    rsM.push(performance.now() - s);
  }
  const rs = stats(rsM);
  console.log(
    `Rust sequential: avg=${rs.avg}ms  p50=${rs.p50}ms  p99=${rs.p99}ms  max=${rs.max}ms`,
  );

  // Rust parallel (registry)
  const reg = new native.RustPoolRegistry();
  const keys: string[] = [];
  for (const p of pools) {
    const s = p.state;
    const bu = Number(
      TICK_BITMAP_TO_USE_BY_CHAIN[s.networkId] ?? TICK_BITMAP_TO_USE,
    );
    const bb = Number(
      TICK_BITMAP_BUFFER_BY_CHAIN[s.networkId] ?? TICK_BITMAP_BUFFER,
    );
    reg.setPool(p.key, {
      variant: 'uniswap_v3',
      bitmapRange: bu + bb,
      blockTimestamp: s.blockTimestamp,
      tickSpacing: s.tickSpacing,
      fee: s.fee,
      sqrtPriceX96: s.slot0.sqrtPriceX96,
      tick: s.slot0.tick,
      observationIndex: s.slot0.observationIndex,
      observationCardinality: s.slot0.observationCardinality,
      observationCardinalityNext: s.slot0.observationCardinalityNext,
      feeProtocol: s.slot0.feeProtocol,
      liquidity: s.liquidity,
      maxLiquidityPerTick: s.maxLiquidityPerTick,
      startTickBitmap: s.startTickBitmap,
      lowestKnownTick: s.lowestKnownTick,
      highestKnownTick: s.highestKnownTick,
      tickBitmap: Object.entries(s.tickBitmap).map(([k, v]) => ({
        key: Number(k),
        value: v,
      })),
      ticks: Object.entries(s.ticks).map(([k, v]: any) => ({
        key: Number(k),
        liquidityGross: v.liquidityGross,
        liquidityNet: v.liquidityNet,
      })),
      observations: Object.entries(s.observations).map(([k, v]: any) => ({
        key: Number(k),
        blockTimestamp: v.blockTimestamp,
        tickCumulative: v.tickCumulative,
        secondsPerLiquidityCumulativeX128: v.secondsPerLiquidityCumulativeX128,
        initialized: v.initialized,
      })),
    });
    keys.push(p.key);
  }

  const parM: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    reg.queryMany(keys, amounts, zfo, 0);
    parM.push(performance.now() - s);
  }
  const par = stats(parM);
  const threads = process.env.RAYON_NUM_THREADS || 'all';
  console.log(
    `Rust PARALLEL:   avg=${par.avg}ms  p50=${par.p50}ms  p99=${par.p99}ms  max=${par.max}ms  (threads=${threads})`,
  );

  // Correctness
  const pr = reg.queryMany(keys, amounts, zfo, 0);
  let ok = true;
  for (const r of pr) {
    const p = pools.find(p => p.key === r.key)!;
    const jr = uniswapV3Math.queryOutputs(p.state, amounts, zfo, SwapSide.SELL);
    for (let i = 0; i < amounts.length; i++) {
      if (jr.outputs[i] !== r.outputs[i]) {
        ok = false;
        break;
      }
    }
  }
  console.log(`\nCorrectness: ${ok ? 'ALL MATCH' : 'MISMATCH'}`);

  console.log(`\n=== ${pools.length} pools, ${amounts.length} amounts ===`);
  console.log(`JS sequential:   ${js.p50}ms`);
  console.log(
    `Rust sequential: ${rs.p50}ms  (${(
      parseFloat(js.p50) / parseFloat(rs.p50)
    ).toFixed(1)}x)`,
  );
  console.log(
    `Rust parallel:   ${par.p50}ms  (${(
      parseFloat(js.p50) / parseFloat(par.p50)
    ).toFixed(1)}x)  [${threads} threads]`,
  );
  process.exit(0);
})();
