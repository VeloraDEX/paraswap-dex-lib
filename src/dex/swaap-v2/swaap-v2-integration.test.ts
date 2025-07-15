/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { SwaapV2 } from './swaap-v2';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
  sleep,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import * as util from 'util';

async function testPricingOnNetwork(
  swaapV2: SwaapV2,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await swaapV2.getPoolIdentifiers(
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

  const poolPrices = await swaapV2.getPricesVolume(
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
  if (swaapV2.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }
}

describe('Swaap V2', function () {
  const dexKey = 'SwaapV2';
  let blockNumber: number;
  let swaapV2: SwaapV2;

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'USDCe';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      10n * BI_POWS[tokens[destTokenSymbol].decimals],
      20n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      swaapV2 = new SwaapV2(network, dexKey, dexHelper);
      if (swaapV2.initializePricing) {
        await swaapV2.initializePricing(0);
        await sleep(5000);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        swaapV2,
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
        swaapV2,
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
      const swaapV2 = new SwaapV2(network, dexKey, dexHelper);
      const poolLiquidity = await swaapV2.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!swaapV2.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Base', () => {
    const network = Network.BASE;
    const dexHelper = new DummyDexHelper(network);

    beforeAll(async () => {
      swaapV2 = new SwaapV2(network, dexKey, dexHelper);
      if (swaapV2.initializePricing) {
        await swaapV2.initializePricing(0);
        await sleep(5000);
      }
    });

    const tokens = Tokens[network];
    const srcTokenSymbol = 'USDbC';

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const swaapV2 = new SwaapV2(network, dexKey, dexHelper);
      const poolLiquidity = await swaapV2.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        util.inspect(poolLiquidity, false, null, true),
      );

      if (!swaapV2.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          tokens[srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const dexHelper = new DummyDexHelper(network);

    beforeAll(async () => {
      swaapV2 = new SwaapV2(network, dexKey, dexHelper);
      if (swaapV2.initializePricing) {
        await swaapV2.initializePricing(0);
        await sleep(5000);
      }
    });

    const tokens = Tokens[network];
    const srcTokenSymbol = 'USDC';

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const swaapV2 = new SwaapV2(network, dexKey, dexHelper);
      const poolLiquidity = await swaapV2.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        util.inspect(poolLiquidity, false, null, true),
      );

      if (!swaapV2.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          tokens[srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
