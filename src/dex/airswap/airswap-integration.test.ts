import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { DummyDexHelper } from '../../dex-helper';
import { Network, SwapSide } from '../../constants';
import { AirSwap } from './airswap';
import { checkPoolPrices, sleep } from '../../../tests/utils';
import { BI_POWS } from '../../bigint-constants';
import { startTestServer } from './test-server.test';
import { SmartTokens } from '../../../tests/constants-e2e';

const PK_KEY = process.env.TEST_PK_KEY;
if (!PK_KEY) {
  throw new Error('Mising TEST_PK_KEY');
}

const testAccount = new ethers.Wallet(PK_KEY!);
const stopServer = startTestServer(testAccount);

const smartTokens = SmartTokens[1];
const WETH = smartTokens.WETH.token;
const DAI = smartTokens.DAI.token;

const amountsForSell = [
  0n,
  1n * BI_POWS[WETH.decimals],
  2n * BI_POWS[WETH.decimals],
  3n * BI_POWS[WETH.decimals],
  4n * BI_POWS[WETH.decimals],
  5n * BI_POWS[WETH.decimals],
  6n * BI_POWS[WETH.decimals],
  7n * BI_POWS[WETH.decimals],
  8n * BI_POWS[WETH.decimals],
  9n * BI_POWS[WETH.decimals],
  10n * BI_POWS[WETH.decimals],
];

const dexKey = 'AirSwap';

describe('AirSwap', function () {
  it('getPoolIdentifiers and getPricesVolume', async function () {
    const dexHelper = new DummyDexHelper(Network.MAINNET);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const airswap = new AirSwap(Network.MAINNET, dexKey, dexHelper);

    airswap.initializePricing(blocknumber);
    await sleep(5000);

    const pools = await airswap.getPoolIdentifiers(
      WETH,
      DAI,
      SwapSide.SELL,
      blocknumber,
    );
    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await airswap.getPricesVolume(
      WETH,
      DAI,
      amountsForSell,
      SwapSide.SELL,
      blocknumber,
      pools,
    );

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amountsForSell, SwapSide.SELL, dexKey);
  });

  afterAll(() => {
    stopServer();
  });
});
