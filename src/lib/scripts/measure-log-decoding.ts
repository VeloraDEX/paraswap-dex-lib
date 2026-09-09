/*

Measures the per log cost of decoding event logs with `Interface.parseLog`
against `TopicLogDecoder`, over real logs fetched from the configured RPCs.

  npx ts-node src/lib/scripts/measure-log-decoding.ts

*/
import * as dotenv from 'dotenv';
dotenv.config();

import { performance } from 'perf_hooks';
import { Interface } from '@ethersproject/abi';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { getLogger } from '../log4js';
import { TopicLogDecoder } from '../topic-log-decoder';

import StableSwap3Pool from '../../abi/curve-v1/StableSwap3Pool.json';
import ERC4626ABI from '../../abi/ERC4626.json';
import erc20ABI from '../../abi/erc20.json';
import uniswapV2ABI from '../../abi/uniswap-v2/uniswap-v2-pool.json';

const logger = getLogger('MeasureLogDecoding');

const BLOCKS_RANGE = 300;
const MIN_LOGS = 200;
const MAX_LOGS = 500;
const ITERATIONS = 50;

type Scenario = {
  name: string;
  network: Network;
  abi: any;
  address: string;
};

const scenarios: Scenario[] = [
  {
    name: 'curve-v1 3pool',
    network: Network.MAINNET,
    abi: StableSwap3Pool,
    address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
  },
  {
    name: 'erc4626 sDAI',
    network: Network.MAINNET,
    abi: ERC4626ABI,
    address: '0x83F20F44975D03b1b09e64809B757c47f942BEeA',
  },
  {
    name: 'erc20 USDC',
    network: Network.MAINNET,
    abi: erc20ABI,
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  {
    name: 'uniswap-v2 USDC/WETH',
    network: Network.MAINNET,
    abi: uniswapV2ABI,
    address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
  },
];

async function fetchLogs(scenario: Scenario) {
  const dexHelper = new DummyDexHelper(scenario.network);
  const toBlock = await dexHelper.provider.getBlockNumber();

  const logs = [];
  for (let i = 0; logs.length < MIN_LOGS && i < 20; i++) {
    const chunk = await dexHelper.provider.getLogs({
      address: scenario.address,
      fromBlock: toBlock - BLOCKS_RANGE * (i + 1),
      toBlock: toBlock - BLOCKS_RANGE * i,
    });
    logs.push(...chunk);
  }
  return logs.slice(0, MAX_LOGS);
}

function measure(name: string, logs: any[], decode: (log: any) => unknown) {
  // warm up so both variants are measured on optimised code
  for (const log of logs) decode(log);

  const start = performance.now();
  let decoded = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    for (const log of logs) {
      decode(log);
      decoded++;
    }
  }
  const elapsed = performance.now() - start;
  logger.info(
    `${name}: ${((elapsed * 1e6) / decoded).toFixed(
      0,
    )} ns/log (${decoded} logs in ${elapsed.toFixed(0)} ms)`,
  );
  return elapsed;
}

async function main() {
  for (const scenario of scenarios) {
    const iface = new Interface(scenario.abi);
    const decoder = new TopicLogDecoder(iface);

    const allLogs = await fetchLogs(scenario);
    // only logs the ABI can decode, so both variants do the same work
    const logs = allLogs.filter(log => {
      try {
        iface.parseLog(log);
        return true;
      } catch (e) {
        return false;
      }
    });

    logger.info(
      `--- ${scenario.name}: ${logs.length} logs, ${
        Object.keys(iface.events).length
      } events in the ABI`,
    );
    if (logs.length === 0) continue;

    const before = measure('  parseLog       ', logs, log =>
      iface.parseLog(log),
    );
    const after = measure('  TopicLogDecoder', logs, log =>
      decoder.decode(log),
    );
    logger.info(`  speedup: ${(before / after).toFixed(2)}x`);
  }
}

main().catch(e => {
  logger.error(e);
  process.exit(1);
});
