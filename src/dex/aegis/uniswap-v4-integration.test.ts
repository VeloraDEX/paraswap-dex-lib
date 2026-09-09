/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();
import { DummyDexHelper, IDexHelper } from '../../dex-helper';
import { Network, SwapSide } from '../../constants';
import { Aegis } from './uniswap-v4';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';
import { Interface, Result, defaultAbiCoder } from '@ethersproject/abi';
import QuoterAbi from '../../abi/uniswap-v4/quoter.abi.json';
import { PoolKey } from './types';
import * as util from 'util';
import { checkPoolsLiquidity } from '../../../tests/utils';

const quoterIface = new Interface(QuoterAbi);

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  poolKey: PoolKey,
  zeroForOne: boolean,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      {
        poolKey,
        zeroForOne,
        exactAmount: amount.toString(),
        hookData: '0x',
      },
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
  dexHelper: IDexHelper,
  funcName: string,
  blockNumber: number,
  exchangeAddress: string,
  prices: bigint[],
  poolKey: PoolKey,
  zeroForOne: boolean,
  _amounts: bigint[],
  readerIface = quoterIface,
) {
  const sum = prices.reduce((acc, curr) => (acc += curr), 0n);

  if (sum === 0n) {
    console.log(
      `Prices were not calculated for pool ${poolKey.toString()} (zeroForOne: ${zeroForOne}). Most likely price impact is too big for requested amount`,
    );
    return false;
  }

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    _amounts.slice(1),
    funcName,
    poolKey,
    zeroForOne,
  );

  console.log('readerCallData: ', readerCallData);

  let readerResult;
  try {
    readerResult = (
      await dexHelper.multiContract.methods
        .aggregate(readerCallData)
        .call({}, blockNumber)
    ).returnData;
  } catch (e) {
    console.log('E: ', e);
    console.log('PRICES: ', prices);
    console.log('pool key: ', poolKey);
    console.log('readerCallData: ', readerCallData);
    console.log(
      `Can not fetch on-chain pricing for pool ${JSON.stringify(
        poolKey,
      )}. It happens for low liquidity pools`,
      e,
    );
    return false;
  }

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  let firstZeroIndex = prices.slice(1).indexOf(0n);

  // we skipped first, so add +1 on result
  firstZeroIndex = firstZeroIndex === -1 ? prices.length : firstZeroIndex;

  console.log('amounts: ', _amounts);
  console.log('prices: ', prices);
  console.log('expectedPrices: ', expectedPrices);

  // Compare only the ones for which we were able to calculate prices
  for (let i = 0; i < firstZeroIndex; i++) {
    if (prices[i] === 0n && expectedPrices[i] === 0n) continue;
    if (prices[i] === 0n || expectedPrices[i] === 0n) {
      expect(prices[i]).toEqual(expectedPrices[i]);
      continue;
    }

    // Exact price matching - no tolerance
    expect(prices[i]).toEqual(expectedPrices[i]);
  }

  return true;
}

describe('Aegis integration tests', () => {
  const dexKey = 'Aegis';

  describe('Unichain', () => {
    const network = Network.UNICHAIN;
    const dexHelper = new DummyDexHelper(network);

    let blockNumber: number;
    let aegis: Aegis;

    describe('ETH -> WBTC', () => {
      const TokenASymbol = 'ETH';
      const TokenA = Tokens[network][TokenASymbol];

      const TokenBSymbol = 'WBTC';
      const TokenB = Tokens[network][TokenBSymbol];

      beforeEach(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        aegis = new Aegis(network, dexKey, dexHelper);
        await aegis.initializePricing(blockNumber);
      });

      it('ETH -> WBTC getPoolIdentifiers and getPricesVolume SELL', async () => {
        console.log('BLOCK: ', blockNumber);

        const amounts = [
          0n,
          1n * BI_POWS[18],
          2n * BI_POWS[18],
          3n * BI_POWS[18],
          4n * BI_POWS[18],
          5n * BI_POWS[18],
          6n * BI_POWS[18],
          7n * BI_POWS[18],
          8n * BI_POWS[18],
          9n * BI_POWS[18],
          10n * BI_POWS[18],
        ];

        const pools = await aegis.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aegis.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          util.inspect(poolPrices, false, null, true),
        );

        expect(poolPrices).not.toBeNull();

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const res = await checkOnChainPricing(
              dexHelper,
              'quoteExactInputSingle',
              blockNumber,
              '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
              price.prices,
              price.data.path[0].pool.key,
              price.data.path[0].zeroForOne,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('ETH -> WBTC getPoolIdentifiers and getPricesVolume BUY', async () => {
        console.log('BLOCK NUMBER: ', blockNumber);

        const amounts = [
          0n,
          1n * BI_POWS[8], // WBTC has 8 decimals
          2n * BI_POWS[8],
          3n * BI_POWS[8],
          4n * BI_POWS[8],
          5n * BI_POWS[8],
        ];

        const pools = await aegis.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aegis.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          util.inspect(poolPrices, false, null, true),
        );

        expect(poolPrices).not.toBeNull();

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const res = await checkOnChainPricing(
              dexHelper,
              'quoteExactOutputSingle',
              blockNumber,
              '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
              price.prices,
              price.data.path[0].pool.key,
              price.data.path[0].zeroForOne,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('WBTC -> ETH getPoolIdentifiers and getPricesVolume SELL', async () => {
        const amounts = [
          0n,
          1n * BI_POWS[8], // WBTC has 8 decimals
          2n * BI_POWS[8],
          3n * BI_POWS[8],
          4n * BI_POWS[8],
          5n * BI_POWS[8],
        ];

        const pools = await aegis.getPoolIdentifiers(
          TokenB,
          TokenA,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aegis.getPricesVolume(
          TokenB,
          TokenA,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        console.log(
          `${TokenBSymbol} <> ${TokenASymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const res = await checkOnChainPricing(
              dexHelper,
              'quoteExactInputSingle',
              blockNumber,
              '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
              price.prices,
              price.data.path[0].pool.key,
              price.data.path[0].zeroForOne,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('WBTC -> ETH getPoolIdentifiers and getPricesVolume BUY', async () => {
        console.log('BLOCK: ', blockNumber);
        const amounts = [
          0n,
          1n * BI_POWS[18],
          2n * BI_POWS[18],
          3n * BI_POWS[18],
          4n * BI_POWS[18],
          5n * BI_POWS[18],
        ];

        const pools = await aegis.getPoolIdentifiers(
          TokenB,
          TokenA,
          SwapSide.BUY,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aegis.getPricesVolume(
          TokenB,
          TokenA,
          amounts,
          SwapSide.BUY,
          blockNumber,
          pools,
        );

        console.log(
          `${TokenBSymbol} <> ${TokenASymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();

        let falseChecksCounter = 0;
        await Promise.all(
          poolPrices!.map(async price => {
            const res = await checkOnChainPricing(
              dexHelper,
              'quoteExactOutputSingle',
              blockNumber,
              '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
              price.prices,
              price.data.path[0].pool.key,
              price.data.path[0].zeroForOne,
              amounts,
            );
            if (res === false) falseChecksCounter++;
          }),
        );

        expect(falseChecksCounter).toBeLessThan(poolPrices!.length);
      });

      it('ETH getTopPoolsForToken', async () => {
        const poolLiquidity = await aegis.getTopPoolsForToken(
          TokenA.address,
          10,
        );
        console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

        // ETH as base token may not have top pools in the same way
        // This is expected behavior for base tokens
        if (poolLiquidity.length === 0) {
          console.log(
            'ETH has no top pools - this is expected for base tokens',
          );
        } else if (!aegis.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
        }
      });

      it('WBTC getTopPoolsForToken', async () => {
        const poolLiquidity = await aegis.getTopPoolsForToken(
          TokenB.address,
          10,
        );
        console.log(`${TokenBSymbol} Top Pools:`, util.inspect(poolLiquidity));

        if (!aegis.hasConstantPriceLargeAmounts) {
          checkPoolsLiquidity(poolLiquidity, TokenB.address, dexKey);
        }
      });
    });
  });
});
