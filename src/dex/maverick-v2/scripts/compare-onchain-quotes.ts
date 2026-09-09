/* eslint-disable no-console */
/*

Compares MaverickV2 local pricing with on-chain results at one block, for
every pool the dex initializes on the given network:
  - tick sqrt price / liquidity vs PoolLens.getTickSqrtPriceAndL
  - estimateSwap (amountIn, amountOut) vs Quoter.calculateSwap, both
    directions, exact-in and exact-out, using the same tickLimit as pricing

Usage: npx ts-node src/dex/maverick-v2/scripts/compare-onchain-quotes.ts [network=1]

*/
import * as dotenv from 'dotenv';
dotenv.config();
import { Interface } from '@ethersproject/abi';
import { BytesLike } from 'ethers';
import { DummyDexHelper } from '../../../dex-helper';
import { MaverickV2 } from '../maverick-v2';
import { MaverickV2Config } from '../config';
import { MaverickTickMath } from '../maverick-math/maverick-tick-math';
import { PoolState } from '../types';
import { extractSuccessAndValue } from '../../../lib/decoders';
import { MultiResult } from '../../../lib/multi-wrapper';
import QuoterABI from '../../../abi/maverick-v2/MaverickV2Quoter.json';
import LensABI from '../../../abi/maverick-v2/MaverickV2PoolLens.json';

const network = Number(process.argv[2] || 1);
const dexKey = 'MaverickV2';
const quoterIface = new Interface(QuoterABI);
const lensIface = new Interface(LensABI);
const MAX_UINT128 = (1n << 128n) - 1n;

const AMOUNT_MULTIPLIERS: [bigint, bigint][] = [
  [1n, 1000000n],
  [1n, 1000n],
  [1n, 7n],
  [1n, 1n],
  [3n, 1n],
  [17n, 1n],
  [123n, 1n],
  [1000n, 1n],
  [12345n, 1n],
  [100000n, 1n],
];
const RESERVE_FRACTIONS: [bigint, bigint][] = [
  [1n, 10n],
  [1n, 2n],
  [9n, 10n],
  [999n, 1000n],
];

type Pair = [bigint, bigint] | null;

const decodePair =
  (iface: Interface, fn: string, keys: [string, string]) =>
  (result: MultiResult<BytesLike> | BytesLike): Pair => {
    const [success, data] = extractSuccessAndValue(result);
    if (!success || data === '0x') return null;
    const decoded = iface.decodeFunctionResult(fn, data);
    return [
      BigInt(decoded[keys[0]].toString()),
      BigInt(decoded[keys[1]].toString()),
    ];
  };

const decodeQuote = decodePair(quoterIface, 'calculateSwap', [
  'amountIn',
  'amountOut',
]);
const decodeTick = decodePair(lensIface, 'getTickSqrtPriceAndL', [
  'sqrtPrice',
  'liquidity',
]);

(async () => {
  const dexHelper = new DummyDexHelper(network);
  const dex = new MaverickV2(network, dexKey, dexHelper);
  const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
  await dex.initializePricing(blockNumber);
  const { quoterAddress, poolLensAddress } = MaverickV2Config[dexKey][network];

  const pools = Object.values(dex.pools).filter(p => p.getState(blockNumber));
  console.log(`network=${network} block=${blockNumber} pools=${pools.length}`);

  // ticks
  const tickCalls = [];
  const tickExpected: { pool: string; tick: bigint; local: Pair }[] = [];
  for (const pool of pools) {
    const state = pool.getState(blockNumber) as PoolState;
    for (const [tickKey, tick] of Object.entries(state.ticks)) {
      const [lower, upper] = MaverickTickMath.tickSqrtPrices(
        pool.tickSpacing,
        BigInt(tickKey),
      );
      tickExpected.push({
        pool: pool.address,
        tick: BigInt(tickKey),
        local: MaverickTickMath.getTickSqrtPriceAndL(
          tick.reserveA,
          tick.reserveB,
          lower,
          upper,
        ),
      });
      tickCalls.push({
        target: poolLensAddress,
        callData: lensIface.encodeFunctionData('getTickSqrtPriceAndL', [
          pool.address,
          tickKey,
        ]),
        decodeFunction: decodeTick,
      });
    }
  }
  const tickResults = await dexHelper.multiWrapper.tryAggregate<Pair>(
    false,
    tickCalls,
    blockNumber,
    200,
    false,
  );
  let tickMismatches = 0;
  tickResults.forEach(({ returnData: onchain }, i) => {
    const { pool, tick, local } = tickExpected[i];
    if (!onchain || !local) return;
    if (onchain[0] !== local[0] || onchain[1] !== local[1]) {
      tickMismatches++;
      console.log(
        `TICK MISMATCH pool=${pool} tick=${tick} local=[${local}] onchain=[${onchain}]`,
      );
    }
  });

  // swaps
  type Case = {
    pool: string;
    label: string;
    tokenAIn: boolean;
    exactOutput: boolean;
    amount: bigint;
    local: Pair | string;
  };
  const cases: Case[] = [];
  const quoteCalls = [];
  for (const pool of pools) {
    const state = pool.getState(blockNumber) as PoolState;
    for (const tokenAIn of [true, false]) {
      for (const exactOutput of [false, true]) {
        const inToken = tokenAIn ? pool.tokenA : pool.tokenB;
        const outToken = tokenAIn ? pool.tokenB : pool.tokenA;
        const unit = 10n ** BigInt((exactOutput ? outToken : inToken).decimals);
        const outReserve = tokenAIn ? state.reserveB : state.reserveA;
        const amounts = new Set<bigint>();
        AMOUNT_MULTIPLIERS.forEach(([n, d]) => amounts.add((unit * n) / d));
        RESERVE_FRACTIONS.forEach(([n, d]) =>
          amounts.add((outReserve * n) / d),
        );
        const tickLimit = tokenAIn
          ? state.activeTick + 100n
          : state.activeTick - 100n;

        for (const amount of amounts) {
          if (amount === 0n || amount > MAX_UINT128) continue;
          let local: Pair | string;
          try {
            local = pool.poolMath.estimateSwap(
              { ...state, ticks: { ...state.ticks } },
              amount,
              tokenAIn,
              exactOutput,
              tickLimit,
            );
          } catch (e: any) {
            local = `throws: ${e?.message || e}`;
          }
          cases.push({
            pool: pool.address,
            label: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
            tokenAIn,
            exactOutput,
            amount,
            local,
          });
          quoteCalls.push({
            target: quoterAddress,
            callData: quoterIface.encodeFunctionData('calculateSwap', [
              pool.address,
              amount,
              tokenAIn,
              exactOutput,
              tickLimit,
            ]),
            decodeFunction: decodeQuote,
          });
        }
      }
    }
  }
  const quoteResults = await dexHelper.multiWrapper.tryAggregate<Pair>(
    false,
    quoteCalls,
    blockNumber,
    15,
    false,
  );

  let matches = 0;
  let mismatches = 0;
  let onlyLocalThrows = 0;
  let onlyOnchainFails = 0;
  let unfillableBuys = 0;
  quoteResults.forEach(({ returnData: onchain }, i) => {
    const c = cases[i];
    const describe = `${c.label} pool=${c.pool} tokenAIn=${c.tokenAIn} exactOutput=${c.exactOutput} amount=${c.amount}`;
    if (typeof c.local === 'string') {
      if (!onchain) return;
      // estimateSwap rejects a BUY the pool can't fill, the Quoter returns
      // the partial fill; swap() prices both as 0
      if (c.exactOutput && onchain[1] < c.amount) {
        unfillableBuys++;
        return;
      }
      onlyLocalThrows++;
      console.log(
        `LOCAL THROWS ${describe} local=${c.local} onchain=[${onchain}]`,
      );
      return;
    }
    if (!onchain) {
      onlyOnchainFails++;
      console.log(`ONCHAIN FAILS ${describe} local=[${c.local}]`);
      return;
    }
    if (c.local![0] !== onchain[0] || c.local![1] !== onchain[1]) {
      mismatches++;
      console.log(
        `QUOTE MISMATCH ${describe} local=[${
          c.local
        }] onchain=[${onchain}] dIn=${c.local![0] - onchain[0]} dOut=${
          c.local![1] - onchain[1]
        }`,
      );
    } else {
      matches++;
    }
  });

  console.log(
    `RESULT network=${network} block=${blockNumber} ticks=${tickExpected.length} tickMismatches=${tickMismatches} quotes=${cases.length} matches=${matches} mismatches=${mismatches} unfillableBuys=${unfillableBuys} onlyLocalThrows=${onlyLocalThrows} onlyOnchainFails=${onlyOnchainFails}`,
  );
  process.exit(mismatches || tickMismatches ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
