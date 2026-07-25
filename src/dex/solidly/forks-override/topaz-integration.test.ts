/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../../dex-helper';
import { Network, SwapSide } from '../../../constants';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../../tests/utils';
import { BI_POWS } from '../../../bigint-constants';
import { Tokens } from '../../../../tests/constants-e2e';
import { Interface, Result } from '@ethersproject/abi';
import solidlyPairABI from '../../../abi/solidly/SolidlyPair.json';
import { Topaz } from './topaz';

const amounts18 = [0n, BI_POWS[18], 2000000000000000000n];

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [amount, tokenIn]),
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

const constructCheckOnChainPricing =
  (dexHelper: DummyDexHelper) =>
  async (
    topaz: Topaz,
    funcName: string,
    blockNumber: number,
    prices: bigint[],
    exchangeAddress: string,
    tokenIn: string,
    amounts: bigint[],
  ) => {
    const readerIface = new Interface(solidlyPairABI as any);

    const readerCallData = getReaderCalldata(
      exchangeAddress,
      readerIface,
      amounts.slice(1),
      funcName,
      tokenIn,
    );

    const readerResult = (
      await dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
    const expectedPrices = [0n].concat(
      decodeReaderResult(readerResult, readerIface, funcName),
    );

    console.log('ON-CHAIN PRICES: ', expectedPrices);
    console.log('  CACHED PRICES: ', prices);

    expect(prices.map(p => p.toString())).toEqual(
      expectedPrices.map(p => p.toString()),
    );
  };

describe('Topaz V2 integration tests', () => {
  const network = Network.BSC;
  const dexHelper = new DummyDexHelper(network);
  const checkOnChainPricing = constructCheckOnChainPricing(dexHelper);

  const dexKey = 'Topaz';

  describe('Volatile pool', () => {
    const TokenASymbol = 'WBNB';
    const tokenA = Tokens[network][TokenASymbol];
    const TokenBSymbol = 'USDT';
    const tokenB = Tokens[network][TokenBSymbol];

    it('getPoolIdentifiers and getPricesVolume SELL', async () => {
      const topaz = new Topaz(network, dexKey, dexHelper);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const pools = await topaz.getPoolIdentifiers(
        tokenA,
        tokenB,
        SwapSide.SELL,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await topaz.getPricesVolume(
        tokenA,
        tokenB,
        amounts18,
        SwapSide.SELL,
        blocknumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts18, SwapSide.SELL, dexKey);

      for (const poolPrice of poolPrices || []) {
        await checkOnChainPricing(
          topaz,
          'getAmountOut',
          blocknumber,
          poolPrice.prices,
          poolPrice.poolAddresses![0],
          tokenA.address,
          amounts18,
        );
      }
    });
  });

  describe('Stable pool', () => {
    const TokenASymbol = 'USDT';
    const tokenA = Tokens[network][TokenASymbol];
    const TokenBSymbol = 'USDC';
    const tokenB = Tokens[network][TokenBSymbol];

    it('getPoolIdentifiers and getPricesVolume SELL', async () => {
      const topaz = new Topaz(network, dexKey, dexHelper);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const pools = await topaz.getPoolIdentifiers(
        tokenA,
        tokenB,
        SwapSide.SELL,
        blocknumber,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
        pools,
      );

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await topaz.getPricesVolume(
        tokenA,
        tokenB,
        amounts18,
        SwapSide.SELL,
        blocknumber,
        pools,
      );
      console.log(
        `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
        poolPrices,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, amounts18, SwapSide.SELL, dexKey);

      for (const poolPrice of poolPrices || []) {
        await checkOnChainPricing(
          topaz,
          'getAmountOut',
          blocknumber,
          poolPrice.prices,
          poolPrice.poolAddresses![0],
          tokenA.address,
          amounts18,
        );
      }
    });
  });

  describe('getTopPoolsForToken', () => {
    it('should return top pools for WBNB', async () => {
      const topaz = new Topaz(network, dexKey, dexHelper);
      const tokenA = Tokens[network]['WBNB'];
      const poolLiquidity = await topaz.getTopPoolsForToken(tokenA.address, 10);
      console.log(
        `${dexKey} Top Pools for WBNB:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (poolLiquidity.length > 0) {
        checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
      }
    });
  });
});
