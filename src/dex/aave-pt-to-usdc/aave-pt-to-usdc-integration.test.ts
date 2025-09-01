/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AavePtToUsdc } from './aave-pt-to-usdc';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import PENDLE_ORACLE_ABI from '../../abi/PendleOracle.json';
import { AavePtToUsdcConfig } from './config';

async function checkOnChainPricing(
  aavePtToUsdc: AavePtToUsdc,
  network: Network,
  dexKey: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  side: SwapSide,
  marketAddress: string,
) {
  const oracle = AavePtToUsdcConfig[dexKey][network].oracleAddress;
  const oracleIface = new Interface(PENDLE_ORACLE_ABI);
  const callData = oracleIface.encodeFunctionData('getPtToAssetRate', [
    marketAddress,
    0,
  ]);

  const { returnData } = await aavePtToUsdc.dexHelper.multiContract.methods
    .aggregate([
      {
        target: oracle,
        callData,
      },
    ])
    .call({}, blockNumber);

  const decoded = oracleIface.decodeFunctionResult(
    'getPtToAssetRate',
    returnData[0],
  );

  const rate = BigInt(decoded[0].toString());

  const expected = [0n].concat(
    amounts
      .slice(1)
      .map(a =>
        side === SwapSide.SELL
          ? (a * rate) / 10n ** 18n
          : (a * 10n ** 18n + (rate - 1n)) / rate,
      ),
  );

  expect(prices).toEqual(expected);
}

async function testPricingOnNetwork(
  aavePtToUsdc: AavePtToUsdc,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await aavePtToUsdc.getPoolIdentifiers(
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

  const poolPrices = await aavePtToUsdc.getPricesVolume(
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
  if (aavePtToUsdc.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  await checkOnChainPricing(
    aavePtToUsdc,
    network,
    dexKey,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    side,
    poolPrices![0].data.marketAddress,
  );
}

describe('AavePtToUsdc', function () {
  const dexKey = 'AavePtToUsdc';
  let blockNumber: number;
  let aavePtToUsdc: AavePtToUsdc;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'PT-USDe-25SEP2025';
    const destTokenSymbol = 'USDE';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals],
      2n * BI_POWS[tokens[destTokenSymbol].decimals],
      3n * BI_POWS[tokens[destTokenSymbol].decimals],
      4n * BI_POWS[tokens[destTokenSymbol].decimals],
      5n * BI_POWS[tokens[destTokenSymbol].decimals],
      6n * BI_POWS[tokens[destTokenSymbol].decimals],
      7n * BI_POWS[tokens[destTokenSymbol].decimals],
      8n * BI_POWS[tokens[destTokenSymbol].decimals],
      9n * BI_POWS[tokens[destTokenSymbol].decimals],
      10n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      aavePtToUsdc = new AavePtToUsdc(network, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        aavePtToUsdc,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        aavePtToUsdc,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAavePtToUsdc = new AavePtToUsdc(network, dexKey, dexHelper);

      const poolLiquidity = await newAavePtToUsdc.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newAavePtToUsdc.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
