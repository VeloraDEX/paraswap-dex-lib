import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { WstGBP } from './wstgbp';
import { WstGBPConfig } from './config';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  tokenIn: string,
  amounts: bigint[],
  funcName: string,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [tokenIn, amount]),
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

// The adapter's view quotes mirror its execution bit-for-bit (same shared library on-chain), so they
// are the ground truth the pricing must match exactly.
async function checkOnChainPricing(
  wstGBP: WstGBP,
  funcName: 'quoteExactInput' | 'quoteExactOutput',
  tokenIn: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
) {
  const exchangeAddress =
    WstGBPConfig['wstGBP'][Network.MAINNET].adapterAddress;

  const readerIface = WstGBP.adapterIface;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    tokenIn,
    amounts.slice(1),
    funcName,
  );
  const readerResult = (
    await wstGBP.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );
  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  wstGBP: WstGBP,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await wstGBP.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await wstGBP.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  checkPoolPrices(poolPrices!, amounts, side, dexKey);

  // On-chain truth: exact-in prices must equal quoteExactInput, exact-out inputs quoteExactOutput,
  // for the actual input token of the trade (direction is inferred from tokenIn on-chain).
  const tokenIn = networkTokens[srcTokenSymbol].address;
  await checkOnChainPricing(
    wstGBP,
    side === SwapSide.SELL ? 'quoteExactInput' : 'quoteExactOutput',
    tokenIn,
    blockNumber,
    poolPrices![0].prices,
    amounts,
  );
}

describe('WstGBP', function () {
  const dexKey = 'wstGBP';
  let blockNumber: number;
  let wstGBP: WstGBP;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const tGBPSymbol = 'tGBP';
    const wstGBPSymbol = 'wstGBP';

    // Above the wrapper's dust floors (mint needs >= mintcost ~1.0e18 tGBP; redeem >= 1e18 wstGBP)
    // and comfortably inside the depth caps at any realistic fork block. Evenly spaced from the first
    // non-zero amount: checkPoolPrices compares successive marginal prices, and on a constant-price
    // venue an uneven first step reads as a (spurious) marginal-price decrease.
    const amounts = [
      0n,
      2n * BI_POWS[18],
      4n * BI_POWS[18],
      6n * BI_POWS[18],
      8n * BI_POWS[18],
      10n * BI_POWS[18],
      12n * BI_POWS[18],
      14n * BI_POWS[18],
      16n * BI_POWS[18],
      18n * BI_POWS[18],
      20n * BI_POWS[18],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      wstGBP = new WstGBP(network, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL tGBP->wstGBP (buy at mintcost)', async function () {
      await testPricingOnNetwork(
        wstGBP,
        network,
        dexKey,
        blockNumber,
        tGBPSymbol,
        wstGBPSymbol,
        SwapSide.SELL,
        amounts,
      );
    });

    it('getPoolIdentifiers and getPricesVolume SELL wstGBP->tGBP (sell at burncost)', async function () {
      await testPricingOnNetwork(
        wstGBP,
        network,
        dexKey,
        blockNumber,
        wstGBPSymbol,
        tGBPSymbol,
        SwapSide.SELL,
        amounts,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY tGBP->wstGBP (exact wstGBP out)', async function () {
      await testPricingOnNetwork(
        wstGBP,
        network,
        dexKey,
        blockNumber,
        tGBPSymbol,
        wstGBPSymbol,
        SwapSide.BUY,
        amounts,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY wstGBP->tGBP (exact tGBP out)', async function () {
      await testPricingOnNetwork(
        wstGBP,
        network,
        dexKey,
        blockNumber,
        wstGBPSymbol,
        tGBPSymbol,
        SwapSide.BUY,
        amounts,
      );
    });

    it('getTopPoolsForToken tGBP', async function () {
      const newWstGBP = new WstGBP(network, dexKey, dexHelper);
      const poolLiquidity = await newWstGBP.getTopPoolsForToken(
        tokens[tGBPSymbol].address,
        10,
      );
      console.log(`${tGBPSymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(
        poolLiquidity,
        Tokens[network][tGBPSymbol].address,
        dexKey,
      );
    });

    it('getTopPoolsForToken wstGBP', async function () {
      const newWstGBP = new WstGBP(network, dexKey, dexHelper);
      const poolLiquidity = await newWstGBP.getTopPoolsForToken(
        tokens[wstGBPSymbol].address,
        10,
      );
      console.log(`${wstGBPSymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(
        poolLiquidity,
        Tokens[network][wstGBPSymbol].address,
        dexKey,
      );
    });
  });
});
