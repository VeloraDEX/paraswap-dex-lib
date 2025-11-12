/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { sleep } from '../../../tests/utils';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { Bebop } from './bebop';
import { uint8ToNumber } from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { ethers } from 'ethers';

jest.setTimeout(300000);

describe('Bebop', () => {
  let bebop: Bebop;
  let dexHelper: DummyDexHelper;
  const network = Network.MAINNET;
  const dexKey = 'Bebop';

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    bebop = new Bebop(network, dexKey, dexHelper);
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    await bebop.initializePricing(blockNumber);
    await sleep(20000);
  });

  it('test', async () => {
    const allPrices = await bebop.getCachedPrices();
    if (!allPrices) {
      return;
    }

    const uniqueTokens: string[] = Array.from(
      new Set(
        Object.keys(allPrices)
          .map(t => t.split('/'))
          .flat(),
      ),
    );

    const calls: MultiCallParams<number>[] = [];

    for (const token of uniqueTokens) {
      calls.push({
        target: token,
        callData: bebop.erc20Interface.encodeFunctionData('decimals'),
        decodeFunction: uint8ToNumber,
      });
    }

    const results = await dexHelper.multiWrapper.tryAggregate<number>(
      false,
      calls,
    );

    const humanAmounts = [0.001, 0.01, 0.1, 1, 10, 100, 1000];

    try {
      const absoluteBpsCompareByIndex: Record<string, number> = {};
      const relativeBpsCompare: Record<string, number[]> = {};
      const resMaxAvgDiff: Record<string, number> = {};

      for (let i = 0; i < uniqueTokens.length; i++) {
        for (let j = 0; j < uniqueTokens.length; j++) {
          if (i === j) {
            continue;
          }

          const _srcToken = {
            address: uniqueTokens[i],
            decimals: results[i].returnData ?? 18,
          };
          const _destToken = {
            address: uniqueTokens[j],
            decimals: results[j].returnData ?? 18,
          };

          const amounts = humanAmounts.map(t =>
            ethers.utils
              .parseUnits(t.toString(), _destToken.decimals)
              .toBigInt(),
          );

          const srcToken = bebop.dexHelper.config.wrapETH(_srcToken);
          const destToken = bebop.dexHelper.config.wrapETH(_destToken);

          const instructions = bebop.calculateInstructionsSync(
            srcToken,
            destToken,
            SwapSide.BUY,
            allPrices,
          );

          if (!instructions || instructions.length === 0) {
            continue;
          }

          const outputs = instructions.map(instructionSet =>
            bebop.calculateOutput(
              instructionSet,
              srcToken,
              destToken,
              amounts,
              SwapSide.BUY,
            ),
          );

          if (outputs.length < 2) {
            continue;
          }

          const res: Record<string, number> = {};

          for (let n = 0; n < outputs[0].length; n++) {
            const theBestOutputIndex = outputs.reduce(
              (bestIndex, currentOutput, currentIndex) =>
                currentOutput[n] > outputs[bestIndex][n]
                  ? currentIndex
                  : bestIndex,
              0,
            );

            res[theBestOutputIndex] = (res[theBestOutputIndex] ?? 0) + 1;

            if (theBestOutputIndex !== 0) {
              const theBestOutputValue = outputs[theBestOutputIndex][n];
              const baselineOutputValue = outputs[0][n];

              const bpsDifference = bpsDiff(
                theBestOutputValue,
                baselineOutputValue,
              );

              if (!relativeBpsCompare[theBestOutputIndex]) {
                relativeBpsCompare[theBestOutputIndex] = [];
              }

              relativeBpsCompare[theBestOutputIndex].push(bpsDifference);
            }
          }

          const theBestOutput = Object.entries(res).reduce(
            (bestEntry, currentEntry) =>
              currentEntry[1] > bestEntry[1] ? currentEntry : bestEntry,
          )[0];

          absoluteBpsCompareByIndex[theBestOutput] =
            (absoluteBpsCompareByIndex[theBestOutput] ?? 0) + 1;

          if (outputs.length > 1) {
            const firstOutput = outputs[0];

            // Calculate average differences for each output compared to first output
            const avgDiffs = outputs.map((output, i) => {
              if (i === 0) return 0n; // First output has 0 diff with itself

              // Calculate differences for each amount compared to first output
              let totalDiff = 0n;
              for (let k = 0; k < output.length; k++) {
                totalDiff += output[k] - firstOutput[k];
              }

              // Return average difference (divided by number of amounts)
              return (totalDiff / BigInt(output.length)) * (false ? 1n : -1n);
            });

            // Find index of output with maximum average difference
            let maxDiffIndex = 0;
            let maxDiff = avgDiffs[0];

            for (let i = 1; i < avgDiffs.length; i++) {
              if (avgDiffs[i] > maxDiff) {
                maxDiff = avgDiffs[i];
                maxDiffIndex = i;
              }
            }

            if (
              maxDiffIndex !== 0 &&
              srcToken.address === '0xdac17f958d2ee523a2206206994597c13d831ec7'
            ) {
              const a = avgDiffs[0];
              // console.log('')
            }

            resMaxAvgDiff[maxDiffIndex] =
              (resMaxAvgDiff[maxDiffIndex] ?? 0) + 1;
          }
        }
        console.timeEnd(`Token ${i}/${uniqueTokens.length}`);
      }

      console.log(absoluteBpsCompareByIndex);
      console.log(relativeBpsCompare);
      console.log(resMaxAvgDiff);
    } catch (error) {
      console.log('error', error);
    }
  });
});

function bpsDiff(a: bigint, b: bigint): number {
  if (a === BigInt(0) && b === BigInt(0)) {
    return 0;
  }
  // Handle case where one value is 0
  if (a === BigInt(0) || b === BigInt(0)) {
    return 10000; // 100% difference in bps
  }
  const diff = a > b ? a - b : b - a;
  const average = (a + b) / BigInt(2);

  return Number((diff * 10_000n) / average);
}
