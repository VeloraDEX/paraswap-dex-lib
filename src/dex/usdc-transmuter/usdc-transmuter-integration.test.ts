/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { UsdcTransmuter } from './usdc-transmuter';
import {
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

describe('UsdcTransmuter', function () {
  const dexKey = 'UsdcTransmuter';
  let blockNumber: number;
  let usdcTransmuter: UsdcTransmuter;

  describe('Gnosis Chain', () => {
    const network = Network.GNOSIS;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];
    const USDCSymbol = 'USDC';
    const USDCeSymbol = 'USDCe';

    const USDCToken = tokens[USDCSymbol];
    const USDCeToken = tokens[USDCeSymbol];

    const amountsForSell = [
      0n,
      1n * BI_POWS[6],
      2n * BI_POWS[6],
      3n * BI_POWS[6],
      4n * BI_POWS[6],
      5n * BI_POWS[6],
      6n * BI_POWS[6],
      7n * BI_POWS[6],
      8n * BI_POWS[6],
      9n * BI_POWS[6],
      10n * BI_POWS[6],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      usdcTransmuter = new UsdcTransmuter(network, dexKey, dexHelper);
    });

    it('getPoolIdentifiers and getPricesVolume DEPOSIT', async function () {
      const pools = await usdcTransmuter.getPoolIdentifiers(
        USDCToken,
        USDCeToken,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(`${USDCSymbol} <> ${USDCeSymbol} Pool Identifiers: `, pools);

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await usdcTransmuter.getPricesVolume(
        USDCToken,
        USDCeToken,
        amountsForSell,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(`${USDCSymbol} <> ${USDCeSymbol} Pool Prices: `, poolPrices);

      expect(poolPrices).not.toBeNull();
      checkConstantPoolPrices(poolPrices!, amountsForSell, dexKey);
    });

    it('getPoolIdentifiers and getPricesVolume WITHDRAW', async function () {
      const pools = await usdcTransmuter.getPoolIdentifiers(
        USDCeToken,
        USDCToken,
        SwapSide.SELL,
        blockNumber,
      );
      console.log(`${USDCSymbol} <> ${USDCeSymbol} Pool Identifiers: `, pools);

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await usdcTransmuter.getPricesVolume(
        USDCeToken,
        USDCToken,
        amountsForSell,
        SwapSide.SELL,
        blockNumber,
        pools,
      );
      console.log(`${USDCSymbol} <> ${USDCeSymbol} Pool Prices: `, poolPrices);

      expect(poolPrices).not.toBeNull();
      checkConstantPoolPrices(poolPrices!, amountsForSell, dexKey);
    });

    it(`getTopPoolsForToken ${USDCSymbol}`, async function () {
      const newUsdcTransmuter = new UsdcTransmuter(network, dexKey, dexHelper);
      const poolLiquidity = await newUsdcTransmuter.getTopPoolsForToken(
        USDCToken.address,
        10,
      );
      console.log(`${USDCSymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, USDCToken.address, dexKey);
    });

    it(`getTopPoolsForToken ${USDCeSymbol}`, async function () {
      const newUsdcTransmuter = new UsdcTransmuter(network, dexKey, dexHelper);
      const poolLiquidity = await newUsdcTransmuter.getTopPoolsForToken(
        USDCeToken.address,
        10,
      );
      console.log(`${USDCeSymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, USDCeToken.address, dexKey);
    });
  });
});
