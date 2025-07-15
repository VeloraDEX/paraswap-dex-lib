import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { LitePsm } from './lite-psm';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { BI_POWS } from '../../bigint-constants';

const network = Network.MAINNET;
const TokenASymbol = 'USDC';
const TokenA = Tokens[network][TokenASymbol];

const TokenBSymbol = 'DAI';
const TokenB = Tokens[network][TokenBSymbol];

const tokenAAmounts = [0n, BI_POWS[8], 200000000n];

const tokenBAmounts = [0n, BI_POWS[18], 2000000000000000000n];

const dexKey = 'LitePsm';

describe('LitePsm', function () {
  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const litePsm = new LitePsm(network, dexKey, dexHelper);

    await litePsm.initializePricing(blocknumber);

    const pools = await litePsm.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await litePsm.getPricesVolume(
      TokenA,
      TokenB,
      tokenAAmounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, tokenAAmounts, SwapSide.SELL, dexKey);
  });

  it('getPoolIdentifiers and getPricesVolume BUY', async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const litePsm = new LitePsm(network, dexKey, dexHelper);

    await litePsm.initializePricing(blocknumber);

    const pools = await litePsm.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.BUY,
      blocknumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await litePsm.getPricesVolume(
      TokenA,
      TokenB,
      tokenBAmounts,
      SwapSide.BUY,
      blocknumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, tokenBAmounts, SwapSide.BUY, dexKey);
  });

  it('getTopPoolsForToken', async function () {
    const dexHelper = new DummyDexHelper(network);
    const litePsm = new LitePsm(network, dexKey, dexHelper);

    const poolLiquidity = await litePsm.getTopPoolsForToken(TokenA.address, 10);
    console.log(
      `${TokenASymbol} Top Pools:`,
      JSON.stringify(poolLiquidity, null, 2),
    );

    checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
  });
});
