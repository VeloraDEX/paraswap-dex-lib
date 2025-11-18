/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Cap } from './cap';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { CapConfig } from './config';
import { Token } from '../../types';

async function checkOnChainPricing(
  cap: Cap,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  srcToken: Token,
  destToken: Token,
  side: SwapSide,
) {
  let _srcToken = srcToken.address;
  let _destToken = destToken.address;
  if (side === SwapSide.SELL) {
    [_srcToken, _destToken] = [_destToken, _srcToken];
  }

  let expectedPrices: bigint[] = [];

  for (const config of Object.values(CapConfig[cap.dexKey][cap.network])) {
    const vault = config.vault;
    const assets = Object.values(config.assets);

    // burn
    if (_destToken === vault.address) {
      const srcAssets = assets.find(
        asset => asset.address.toLowerCase() === _srcToken.toLowerCase(),
      );
      if (!srcAssets) {
        continue;
      }

      const multicall = [
        ...amounts.map(amount => ({
          target: vault.address,
          callData: cap.capIface.encodeFunctionData('getBurnAmount', [
            srcAssets.address,
            amount,
          ]),
        })),
      ];

      const returnData = (
        await cap.dexHelper.multiContract.methods
          .aggregate(multicall)
          .call({}, blockNumber)
      ).returnData;

      expectedPrices = returnData
        .map((result: any) =>
          cap.capIface.decodeFunctionResult('getBurnAmount', result),
        )
        .map((result: any) => result[0])
        .map((result: any) => BigInt(result));

      break;
    }

    // mint
    if (_srcToken === vault.address) {
      const destAssets = assets.find(
        asset => asset.address.toLowerCase() === _destToken.toLowerCase(),
      );
      if (!destAssets) {
        continue;
      }

      const multicall = [
        ...amounts.map(amount => ({
          target: vault.address,
          callData: cap.capIface.encodeFunctionData('getMintAmount', [
            destAssets.address,
            amount,
          ]),
        })),
      ];

      const returnData = (
        await cap.dexHelper.multiContract.methods
          .aggregate(multicall)
          .call({}, blockNumber)
      ).returnData;

      expectedPrices = returnData
        .map((result: any) =>
          cap.capIface.decodeFunctionResult('getMintAmount', result),
        )
        .map((result: any) => result[0])
        .map((result: any) => BigInt(result));

      break;
    }
  }

  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  cap: Cap,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await cap.getPoolIdentifiers(
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

  const poolPrices = await cap.getPricesVolume(
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
  if (cap.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones

  await checkOnChainPricing(
    cap,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
  );
}

describe('Cap', function () {
  const dexKey = 'Cap';
  let blockNumber: number;
  let cap: Cap;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];
    const srcTokenSymbol = 'cUSD';
    const destTokenSymbol = 'USDC';

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
      cap = new Cap(network, dexKey, dexHelper);
      await cap.eventPools.initialize(blockNumber);
      if (cap.initializePricing) {
        await cap.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        cap,
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
        cap,
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
      const newCap = new Cap(network, dexKey, dexHelper);

      const poolLiquidity = await newCap.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newCap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
