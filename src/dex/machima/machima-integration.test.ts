/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper, IDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Machima } from './machima';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { AGGREGATOR_QUOTER_ABI } from './abi';
import { MachimaConfig } from './config';

/*
  Machima integration tests (Base mainnet, chainId 8453).

  Requires an archive RPC for Base, e.g. in .env:
    HTTP_PROVIDER_8453=https://...

  Pricing is validated against the on-chain MachimaAggregatorQuoter.quote,
  which applies classification + tax + the XMA sell floor exactly as the
  MachimaAggregatorRouter executes. This is the same parity approach used for
  the KyberSwap dex-lib integration.

  Run: npx jest src/dex/machima/machima-integration.test.ts
*/

const network = Network.BASE;
const dexKey = 'Machima';
const quoterAddress = MachimaConfig[dexKey][network].aggregatorQuoter;
const quoterIface = new Interface(AGGREGATOR_QUOTER_ABI);

async function checkOnChainPricing(
  dexHelper: IDexHelper,
  blockNumber: number,
  srcToken: string,
  destToken: string,
  prices: bigint[],
  amounts: bigint[],
) {
  // Compare against MachimaAggregatorQuoter.quote for the non-zero amounts.
  const calls = amounts.slice(1).map(amount => ({
    target: quoterAddress,
    callData: quoterIface.encodeFunctionData('quote', [
      srcToken,
      destToken,
      amount.toString(),
    ]),
  }));

  const readerResult = (
    await dexHelper.multiContract.methods.aggregate(calls).call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    readerResult.map(
      (result: any) =>
        quoterIface
          .decodeFunctionResult('quote', result)[0]
          .toBigInt() as bigint,
    ),
  );

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  machima: Machima,
  dexHelper: IDexHelper,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];
  const srcToken = networkTokens[srcTokenSymbol];
  const destToken = networkTokens[destTokenSymbol];

  const pools = await machima.getPoolIdentifiers(
    srcToken,
    destToken,
    SwapSide.SELL,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers:`,
    pools,
  );
  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await machima.getPricesVolume(
    srcToken,
    destToken,
    amounts,
    SwapSide.SELL,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices:`,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);

  await checkOnChainPricing(
    dexHelper,
    blockNumber,
    srcToken.address,
    destToken.address,
    poolPrices![0].prices,
    amounts,
  );
}

describe('Machima', function () {
  let blockNumber: number;
  let machima: Machima;
  const dexHelper = new DummyDexHelper(network);
  const tokens = Tokens[network];

  const amountsXma = [
    0n,
    1n * BI_POWS[18],
    2n * BI_POWS[18],
    3n * BI_POWS[18],
    4n * BI_POWS[18],
    5n * BI_POWS[18],
  ];

  // Uniformly-spaced amounts (checkPoolPrices assumes constant step size).
  const amountsWeth = [
    0n,
    2n * BI_POWS[16], // 0.02 WETH
    4n * BI_POWS[16],
    6n * BI_POWS[16],
    8n * BI_POWS[16],
    10n * BI_POWS[16], // 0.10 WETH
  ];

  beforeAll(async () => {
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    machima = new Machima(network, dexKey, dexHelper);
    if (machima.initializePricing) {
      await machima.initializePricing(blockNumber);
    }
  });

  it('XMA -> WETH SELL (aggregator-quoter path, incl. sell floor)', async function () {
    await testPricingOnNetwork(
      machima,
      dexHelper,
      blockNumber,
      'XMA',
      'WETH',
      amountsXma,
    );
  });

  it('WETH -> XMA SELL (Machima buy; event path + buy tax)', async function () {
    await testPricingOnNetwork(
      machima,
      dexHelper,
      blockNumber,
      'WETH',
      'XMA',
      amountsWeth,
    );
  });

  it('returns null for exact-out (ParaSwap BUY) — unsupported', async function () {
    const poolPrices = await machima.getPricesVolume(
      tokens['WETH'],
      tokens['XMA'],
      amountsWeth,
      SwapSide.BUY,
      blockNumber,
    );
    expect(poolPrices).toBeNull();
  });

  it('getTopPoolsForToken', async function () {
    const newMachima = new Machima(network, dexKey, dexHelper);
    const poolLiquidity = await newMachima.getTopPoolsForToken(
      tokens['XMA'].address,
      10,
    );
    console.log('XMA Top Pools:', poolLiquidity);

    // getTopPoolsForToken requires a configured elixir subgraph URL. When set,
    // assert liquidity; otherwise it returns [] and discovery runs off events.
    if (MachimaConfig[dexKey][network].subgraphURL) {
      checkPoolsLiquidity(poolLiquidity, tokens['XMA'].address, dexKey);
    }
  });
});
