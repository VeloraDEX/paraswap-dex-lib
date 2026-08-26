/*
 * Golden-fixture generator for the Go port of the revertable fallback group
 * encoding (VeloraDEX/velora-dex-lib). Not a test of this repo: it dumps
 * bytecode built by the TS Executor01/02 builders for a fixed scenario matrix
 * so the Go builders can assert byte-for-byte parity on identical inputs.
 *
 * Run:
 *   FALLBACK_GOLDENS_OUT=/path/to/fallback_goldens.json \
 *     npx jest src/executor/generate-fallback-goldens.test.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { Executor02BytecodeBuilder } from './Executor02BytecodeBuilder';
import { Network, NULL_ADDRESS } from '../constants';
import { DummyDexHelper } from '../dex-helper';
import { OptimalRate } from '@paraswap/core';
import { DexExchangeBuildParam } from '../types';

const OUT = process.env.FALLBACK_GOLDENS_OUT;

const ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TOKEN_1 = '0x1111111111111111111111111111111111111111';
const TOKEN_2 = '0x2222222222222222222222222222222222222222';

const TARGET_FALLBACK = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TARGET_PRIMARY = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TARGET_HOP = '0xcccccccccccccccccccccccccccccccccccccccc';
const TARGET_OTHER = '0xdddddddddddddddddddddddddddddddddddddddd';

const SRC_AMOUNT = '1000000000';
const DEST_AMOUNT = '500000000000000000';

const pad32 = (n: string): string => BigInt(n).toString(16).padStart(64, '0');

const param = (
  selector: string,
  needWrapNative: boolean,
  dexFuncHasRecipient: boolean,
  targetExchange: string,
): DexExchangeBuildParam =>
  ({
    needWrapNative,
    dexFuncHasRecipient,
    exchangeData: '0x' + selector + pad32(SRC_AMOUNT),
    insertFromAmountPos: 4,
    targetExchange,
  } as unknown as DexExchangeBuildParam);

const swap = (srcToken: string, destToken: string) => ({
  srcToken,
  destToken,
  srcAmount: SRC_AMOUNT,
  destAmount: DEST_AMOUNT,
  swapExchanges: [
    {
      exchange: 'Dexalot',
      srcAmount: SRC_AMOUNT,
      destAmount: DEST_AMOUNT,
      percent: 100,
    },
  ],
});

const splitSwap = (srcToken: string, destToken: string) => ({
  srcToken,
  destToken,
  srcAmount: SRC_AMOUNT,
  destAmount: DEST_AMOUNT,
  swapExchanges: [
    {
      exchange: 'dexA',
      srcAmount: '600000000',
      destAmount: '300000000000000000',
      percent: 60,
    },
    {
      exchange: 'dexB',
      srcAmount: '400000000',
      destAmount: '200000000000000000',
      percent: 40,
    },
  ],
});

const route = (swaps: object[]): OptimalRate =>
  ({
    network: 1,
    side: 'SELL',
    srcToken: (swaps[0] as any).srcToken,
    destToken: (swaps[swaps.length - 1] as any).destToken,
    srcAmount: SRC_AMOUNT,
    destAmount: DEST_AMOUNT,
    bestRoute: [{ percent: 100, swaps }],
    contractMethod: 'swapExactAmountIn',
  } as unknown as OptimalRate);

const wethWithdraw = (wethAddress: string) => ({
  withdraw: {
    callee: wethAddress,
    calldata: '0x2e1a7d4d' + pad32(DEST_AMOUNT),
    value: '0',
  },
});

const wethDeposit = (wethAddress: string) => ({
  deposit: {
    callee: wethAddress,
    calldata: '0xd0e30db0',
    value: SRC_AMOUNT,
  },
});

describe('fallback golden generator', () => {
  (OUT ? it : it.skip)('writes the golden fixtures', () => {
    const dexHelper = new DummyDexHelper(Network.MAINNET);
    const WETH = dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    const e01 = new Executor01BytecodeBuilder(dexHelper);
    const e02 = new Executor02BytecodeBuilder(dexHelper);

    const withFallback = (
      primary: DexExchangeBuildParam,
      fallback: DexExchangeBuildParam,
    ): DexExchangeBuildParam =>
      ({ ...primary, fallbackParam: fallback } as DexExchangeBuildParam);

    const rawPrimary = param('deadbeef', false, true, TARGET_PRIMARY);
    const rawFallback = param('feedc0de', false, true, TARGET_FALLBACK);
    const wethFallback = param('feedc0de', true, true, TARGET_FALLBACK);
    const wethPrimary = param('deadbeef', true, true, TARGET_PRIMARY);
    const hopParam = param('cafebabe', false, true, TARGET_HOP);
    const wethHopParam = param('cafebabe', true, true, TARGET_HOP);

    const approvedWethFallback = {
      ...wethFallback,
      approveData: { token: WETH, target: TARGET_FALLBACK },
    } as unknown as DexExchangeBuildParam;

    const scenarios: {
      name: string;
      executor: 'Executor01' | 'Executor02';
      priceRoute: OptimalRate;
      exchangeParams: DexExchangeBuildParam[];
      maybeWethCallData?: object;
    }[] = [
      // --- Executor01 ---
      {
        name: 'e01-simple-group',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_1, TOKEN_2)]),
        exchangeParams: [withFallback(rawPrimary, rawFallback)],
      },
      {
        name: 'e01-recipient-mismatch',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_1, TOKEN_2)]),
        exchangeParams: [
          withFallback(
            rawPrimary,
            param('feedc0de', false, false, TARGET_FALLBACK),
          ),
        ],
      },
      {
        name: 'e01-final-eth-dest-mixed-wrapness',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_1, ETH)]),
        exchangeParams: [withFallback(rawPrimary, wethFallback)],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e01-multihop-final-eth-dest',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_2, TOKEN_1), swap(TOKEN_1, ETH)]),
        exchangeParams: [
          param('cafebabe', false, false, TARGET_HOP),
          withFallback(rawPrimary, wethFallback),
        ],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e01-mid-route-raw-weth-rawnext',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_1, ETH), swap(ETH, TOKEN_2)]),
        exchangeParams: [withFallback(rawPrimary, wethFallback), hopParam],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e01-mid-route-raw-weth-wethnext',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_1, ETH), swap(ETH, TOKEN_2)]),
        exchangeParams: [withFallback(rawPrimary, wethFallback), wethHopParam],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e01-mid-route-weth-raw-wethnext',
        executor: 'Executor01',
        priceRoute: route([swap(TOKEN_1, ETH), swap(ETH, TOKEN_2)]),
        exchangeParams: [
          withFallback(
            param('deadbeef', true, true, TARGET_PRIMARY),
            param('feedc0de', false, true, TARGET_FALLBACK),
          ),
          wethHopParam,
        ],
        maybeWethCallData: wethWithdraw(WETH),
      },
      // --- Executor02 ---
      {
        name: 'e02-whole-hop-mid-route',
        executor: 'Executor02',
        priceRoute: route([swap(TOKEN_1, TOKEN_2), swap(TOKEN_2, TOKEN_1)]),
        exchangeParams: [withFallback(rawPrimary, rawFallback), hopParam],
      },
      {
        name: 'e02-whole-hop-final',
        executor: 'Executor02',
        priceRoute: route([swap(TOKEN_1, TOKEN_2), swap(TOKEN_2, TOKEN_1)]),
        exchangeParams: [hopParam, withFallback(rawPrimary, rawFallback)],
      },
      {
        name: 'e02-split-member',
        executor: 'Executor02',
        priceRoute: route([
          splitSwap(TOKEN_1, TOKEN_2),
          swap(TOKEN_2, TOKEN_1),
        ]),
        exchangeParams: [
          withFallback(rawPrimary, rawFallback),
          param('beefdead', false, true, TARGET_OTHER),
          hopParam,
        ],
      },
      {
        name: 'e02-ethdest-raw-fallback-with-recipient',
        executor: 'Executor02',
        priceRoute: route([swap(TOKEN_1, TOKEN_2), splitSwap(TOKEN_2, ETH)]),
        exchangeParams: [
          hopParam,
          withFallback(
            param('deadbeef', true, true, TARGET_PRIMARY),
            param('feedc0de', false, true, TARGET_FALLBACK),
          ),
          param('beefdead', true, true, TARGET_OTHER),
        ],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e02-ethdest-raw-fallback-no-recipient',
        executor: 'Executor02',
        priceRoute: route([swap(TOKEN_1, TOKEN_2), splitSwap(TOKEN_2, ETH)]),
        exchangeParams: [
          hopParam,
          withFallback(
            param('deadbeef', true, true, TARGET_PRIMARY),
            param('feedc0de', false, false, TARGET_FALLBACK),
          ),
          param('beefdead', true, true, TARGET_OTHER),
        ],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e02-ethdest-raw-primary-weth-fallback',
        executor: 'Executor02',
        priceRoute: route([swap(TOKEN_1, TOKEN_2), splitSwap(TOKEN_2, ETH)]),
        exchangeParams: [
          hopParam,
          withFallback(rawPrimary, wethFallback),
          param('beefdead', true, true, TARGET_OTHER),
        ],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e02-guard-mid-route-mixed-wrapness',
        executor: 'Executor02',
        priceRoute: route([swap(TOKEN_1, ETH), swap(ETH, TOKEN_2)]),
        exchangeParams: [
          withFallback(
            param('deadbeef', true, true, TARGET_PRIMARY),
            param('feedc0de', false, true, TARGET_FALLBACK),
          ),
          wethHopParam,
        ],
        maybeWethCallData: wethWithdraw(WETH),
      },
      {
        name: 'e02-input-extwrap-raw-fallback',
        executor: 'Executor02',
        priceRoute: route([swap(ETH, TOKEN_2), swap(TOKEN_2, TOKEN_1)]),
        exchangeParams: [
          withFallback(
            wethPrimary,
            param('feedc0de', false, true, TARGET_FALLBACK),
          ),
          hopParam,
        ],
        maybeWethCallData: wethDeposit(WETH),
      },
      {
        name: 'e02-input-extwrap-weth-fallback-approve',
        executor: 'Executor02',
        priceRoute: route([swap(ETH, TOKEN_2), swap(TOKEN_2, TOKEN_1)]),
        exchangeParams: [
          withFallback(wethPrimary, approvedWethFallback),
          hopParam,
        ],
        maybeWethCallData: wethDeposit(WETH),
      },
      {
        name: 'e02-input-rawprimary-weth-fallback',
        executor: 'Executor02',
        priceRoute: route([swap(ETH, TOKEN_2), swap(TOKEN_2, TOKEN_1)]),
        exchangeParams: [
          withFallback(rawPrimary, approvedWethFallback),
          hopParam,
        ],
        maybeWethCallData: wethDeposit(WETH),
      },
    ];

    const output = {
      tsCommit: execSync('git rev-parse HEAD').toString().trim(),
      context: {
        network: 1,
        augustusV6Address:
          dexHelper.config.data.augustusV6Address!.toLowerCase(),
        wrappedNativeTokenAddress: WETH,
      },
      scenarios: scenarios.map(scenario => ({
        ...scenario,
        bytecode: (scenario.executor === 'Executor01'
          ? e01
          : e02
        ).buildByteCode(
          scenario.priceRoute,
          scenario.exchangeParams,
          NULL_ADDRESS,
          scenario.maybeWethCallData as any,
        ),
      })),
    };

    writeFileSync(OUT!, JSON.stringify(output, null, 2) + '\n');
  });
});
