import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper';
import { PromiseScheduler } from '../../lib/promise-scheduler';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Token } from '../../types';
import { Tokens } from '../../../tests/constants-e2e';
import {
  checkConstantPoolPrices,
  checkPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { poolInterface } from './abi';
import { Stabull } from './stabull';
import {
  quoteBuy,
  quoteSell,
  quoteViewBuy,
  quoteViewSell,
} from './contract-math/math';

const schedulerRun = jest
  .spyOn(PromiseScheduler.prototype as any, 'run')
  .mockImplementation(() => undefined);
afterAll(() => schedulerRun.mockRestore());

// Encode all requested quote sizes for one batched contract read.
function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  srcToken: string,
  destToken: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      srcToken,
      destToken,
      amount,
    ]),
  }));
}

// Decode each contract quote without losing integer precision.
function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
): bigint[] {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0].toString());
  });
}

// Compare local view quotes with contract results at the same block.
async function checkOnChainPricing(
  stabull: Stabull,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  exchangeAddress: string,
  srcToken: Token,
  destToken: Token,
) {
  const readerCallData = getReaderCalldata(
    exchangeAddress,
    poolInterface,
    amounts.slice(1),
    funcName,
    srcToken.address,
    destToken.address,
  );
  const readerResult = (
    await stabull.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;
  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, poolInterface, funcName),
  );

  expect(prices).toEqual(expectedPrices);
}

// Exercise public pool selection and pricing before checking contract quotes.
async function testPricingOnNetwork(
  stabull: Stabull,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
) {
  const networkTokens = getTokens(network);
  const srcToken = networkTokens[srcTokenSymbol];
  const destToken = networkTokens[destTokenSymbol];

  const pools = await stabull.getPoolIdentifiers(
    srcToken,
    destToken,
    side,
    blockNumber,
  );
  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await stabull.getPricesVolume(
    srcToken,
    destToken,
    amounts,
    side,
    blockNumber,
    pools,
  );
  expect(poolPrices).not.toBeNull();
  if (stabull.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  const pool = poolPrices![0].data.pool;
  const eventPool = stabull.factory.pools.get(pool.toLowerCase())!;
  const state = eventPool.getState(blockNumber)!;
  const inputIndex = eventPool.poolConfig.tokens.findIndex(
    token => token.toLowerCase() === srcToken.address.toLowerCase(),
  );
  expect(inputIndex).toBeGreaterThanOrEqual(0);

  const executionPrices = amounts.map(amount =>
    (side === SwapSide.SELL ? quoteSell : quoteBuy)(state, inputIndex, amount),
  );
  expect(poolPrices![0].prices).toEqual(executionPrices);
  const unitToken = side === SwapSide.SELL ? srcToken : destToken;
  expect(poolPrices![0].unit).toBe(
    (side === SwapSide.SELL ? quoteSell : quoteBuy)(
      state,
      inputIndex,
      BI_POWS[unitToken.decimals],
    ),
  );

  // Execution and view paths floor the transferred token balance differently.
  const viewPrices = amounts.map(amount =>
    (side === SwapSide.SELL ? quoteViewSell : quoteViewBuy)(
      state,
      inputIndex,
      amount,
    ),
  );
  await checkOnChainPricing(
    stabull,
    funcNameToCheck,
    blockNumber,
    viewPrices,
    amounts,
    pool,
    srcToken,
    destToken,
  );
}

// Keep protocol-specific token fixtures local to the Stabull integration.
function getTokens(network: Network): Record<string, Token> {
  const networkTokens = Tokens[network];
  if (network === Network.MAINNET) {
    return {
      ...networkTokens,
      NZDS: {
        address: '0xda446fad08277b4d2591536f204e018f32b6831c',
        decimals: 6,
        symbol: 'NZDS',
      },
    };
  }
  if (network === Network.POLYGON) {
    return {
      ...networkTokens,
      BRZ: {
        address: '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc',
        decimals: 18,
        symbol: 'BRZ',
      },
      USDC: {
        address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
        decimals: 6,
        symbol: 'USDC',
      },
    };
  }
  return networkTokens;
}

const testCases = [
  { network: Network.MAINNET, srcTokenSymbol: 'NZDS', destTokenSymbol: 'USDC' },
  { network: Network.POLYGON, srcTokenSymbol: 'BRZ', destTokenSymbol: 'USDC' },
  { network: Network.BASE, srcTokenSymbol: 'EURC', destTokenSymbol: 'USDC' },
];

describe('Stabull', () => {
  const dexKey = 'Stabull';
  jest.setTimeout(180_000);

  for (const { network, srcTokenSymbol, destTokenSymbol } of testCases) {
    describe(network, () => {
      const tokens = getTokens(network);
      const amountsForSell = [
        0n,
        1n * BI_POWS[tokens[srcTokenSymbol].decimals],
        2n * BI_POWS[tokens[srcTokenSymbol].decimals],
        3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      ];
      const amountsForReverseSell = [
        0n,
        1n * BI_POWS[tokens[destTokenSymbol].decimals],
        2n * BI_POWS[tokens[destTokenSymbol].decimals],
        3n * BI_POWS[tokens[destTokenSymbol].decimals],
      ];
      let dexHelper: DummyDexHelper;
      let stabull: Stabull;
      let blockNumber: number;

      beforeAll(async () => {
        dexHelper = new DummyDexHelper(
          network,
          process.env[`HTTP_PROVIDER_${network}`],
        );
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        stabull = new Stabull(network, dexKey, dexHelper);
        await stabull.initializePricing(blockNumber);
      });
      afterAll(() => stabull?.releaseResources());

      it('getPoolIdentifiers and getPricesVolume SELL', async () => {
        await testPricingOnNetwork(
          stabull,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.SELL,
          amountsForSell,
          'viewOriginSwap',
        );
      });

      it('getPoolIdentifiers and getPricesVolume reverse SELL', async () => {
        await testPricingOnNetwork(
          stabull,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.SELL,
          amountsForReverseSell,
          'viewOriginSwap',
        );
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async () => {
        await testPricingOnNetwork(
          stabull,
          network,
          dexKey,
          blockNumber,
          srcTokenSymbol,
          destTokenSymbol,
          SwapSide.BUY,
          amountsForReverseSell,
          'viewTargetSwap',
        );
      });

      it('getPoolIdentifiers and getPricesVolume reverse BUY', async () => {
        await testPricingOnNetwork(
          stabull,
          network,
          dexKey,
          blockNumber,
          destTokenSymbol,
          srcTokenSymbol,
          SwapSide.BUY,
          amountsForSell,
          'viewTargetSwap',
        );
      });

      it('getTopPoolsForToken', async () => {
        const freshStabull = new Stabull(network, dexKey, dexHelper);
        try {
          await freshStabull.updatePoolState();
          const poolLiquidity = await freshStabull.getTopPoolsForToken(
            tokens[srcTokenSymbol].address,
            10,
          );
          expect(poolLiquidity.length).toBeGreaterThan(0);
          checkPoolsLiquidity(
            poolLiquidity,
            tokens[srcTokenSymbol].address,
            dexKey,
          );
        } finally {
          await freshStabull.releaseResources();
        }
      });
    });
  }
});
