/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../../../dex-helper/index';
import { Network, SwapSide } from '../../../../constants';
import { BI_POWS } from '../../../../bigint-constants';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
} from '../../../../../tests/utils';
import { Tokens } from '../../../../../tests/constants-e2e';
import VelodromeSlipstreamQuoterV2ABI from '../../../../abi/velodrome-slipstream/VelodromeSlipstreamQuoterV2.abi.json';
import { Address } from '@paraswap/core';
import { TopazCL } from './topaz-cl';

const network = Network.BSC;
const dexKey = 'TopazCL';
const quoterAddress = '0x7CCB89bB9BdEF68688F39a2c22d249fD1D9759f1';
const velodromeQuoterIface = new Interface(VelodromeSlipstreamQuoterV2ABI);

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: Address,
  tokenOut: Address,
  tickSpacing: bigint,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      [tokenIn, tokenOut, amount.toString(), tickSpacing.toString(), 0],
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

async function checkOnChainPricing(
  dexHelper: DummyDexHelper,
  topazCL: TopazCL,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  tokenIn: Address,
  tokenOut: Address,
  tickSpacing: bigint,
  _amounts: bigint[],
) {
  const sum = prices.reduce((acc, curr) => (acc += curr), 0n);

  if (sum === 0n) {
    console.log(
      `Prices were not calculated for tokenIn=${tokenIn}, tokenOut=${tokenOut}, tickSpacing=${tickSpacing}. Most likely price impact is too big for requested amount`,
    );
    return false;
  }

  const readerCallData = getReaderCalldata(
    quoterAddress,
    velodromeQuoterIface,
    _amounts.slice(1),
    funcName,
    tokenIn,
    tokenOut,
    tickSpacing,
  );

  let readerResult;
  try {
    readerResult = (
      await dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
  } catch (e) {
    console.log(
      `Can not fetch on-chain pricing for tickSpacing ${tickSpacing}. It happens for low liquidity pools`,
      e,
    );
    return false;
  }

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, velodromeQuoterIface, funcName),
  );

  console.log('ON-CHAIN PRICES: ', expectedPrices);
  console.log('  CACHED PRICES: ', prices);

  let maxDiffPercent = 0;
  for (let i = 1; i < prices.length; i++) {
    if (expectedPrices[i] === 0n) continue;
    const diff =
      Number(((prices[i] - expectedPrices[i]) * 10000n) / expectedPrices[i]) /
      100;
    console.log(`  Amount ${_amounts[i]}: diff = ${diff}%`);
    maxDiffPercent = Math.max(maxDiffPercent, Math.abs(diff));
  }

  expect(maxDiffPercent).toBeLessThan(1);
  return true;
}

describe('TopazCL Integration Tests', () => {
  const dexHelper = new DummyDexHelper(network);
  let topazCL: TopazCL;
  let blockNumber: number;

  const TokenASymbol = 'USDT';
  const TokenA = Tokens[network][TokenASymbol];

  const TokenBSymbol = 'WBNB';
  const TokenB = Tokens[network][TokenBSymbol];

  beforeEach(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    topazCL = new TopazCL(network, dexKey, dexHelper);
  });

  it('getPoolIdentifiers and getPricesVolume SELL', async () => {
    const amounts = [0n, BI_POWS[18], BI_POWS[18] * 2n];

    const pools = await topazCL.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await topazCL.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

    let falseChecksCounter = 0;
    await Promise.all(
      poolPrices!.map(async price => {
        const tickSpacing =
          topazCL.eventPools[price.poolIdentifiers![0]]!.tickSpacing!;
        const res = await checkOnChainPricing(
          dexHelper,
          topazCL,
          'quoteExactInputSingle',
          blockNumber,
          price.prices,
          TokenA.address,
          TokenB.address,
          tickSpacing,
          amounts,
        );
        if (res === false) falseChecksCounter++;
      }),
    );

    expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async () => {
    const amounts = [0n, BI_POWS[18], BI_POWS[18] * 2n];

    const pools = await topazCL.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.BUY,
      blockNumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await topazCL.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.BUY,
      blockNumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('getTopPoolsForToken', async () => {
    const tokenA = Tokens[network]['WBNB'];
    const poolLiquidity = await topazCL.getTopPoolsForToken(tokenA.address, 10);
    console.log(
      `${dexKey} Top Pools for WBNB:`,
      JSON.stringify(poolLiquidity, null, 2),
    );

    if (poolLiquidity.length > 0) {
      checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
    }
  });
});
