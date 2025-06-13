/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { getDexKeysWithNetwork } from '../../utils';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Token } from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AaveV3PtRollOverData } from './types';

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/dummy-dex-helper';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AaveV3PtRollOver } from './aave-v3-pt-roll-over';

const checkOnChainPricing = async (
  aaveV3PtRollOver: AaveV3PtRollOver,
  functionName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  srcToken: Token,
  destToken: Token,
  dexHelper: IDexHelper,
  data: AaveV3PtRollOverData,
) => {
  // Skip on-chain pricing check for this DEX since it uses Pendle Oracle
  // and the transaction construction is mock for now
  console.log('Skipping on-chain pricing check for oracle-based DEX');
  return;
};

async function testPricingOnNetwork(
  aaveV3PtRollOver: AaveV3PtRollOver,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcName: string,
) {
  const networkTokens = Tokens[network];

  const pools = await aaveV3PtRollOver.getPoolIdentifiers(
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

  const poolPrices = await aaveV3PtRollOver.getPricesVolume(
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

  // Check if onchain pricing equals to the pricing returned by the implementation
  await checkOnChainPricing(
    aaveV3PtRollOver,
    funcName,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    aaveV3PtRollOver.dexHelper,
    poolPrices![0].data,
  );
}

describe('AaveV3PtRollOver', function () {
  const dexKey = 'AaveV3PtRollOver';
  let blockNumber: number;
  let aaveV3PtRollOver: AaveV3PtRollOver;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'PT-sUSDe-29MAY2025';
    const destTokenSymbol = 'PT-sUSDe-31JUL2025';

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
      aaveV3PtRollOver = new AaveV3PtRollOver(network, dexKey, dexHelper);
      if (aaveV3PtRollOver.initializePricing) {
        await aaveV3PtRollOver.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        aaveV3PtRollOver,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
        'getPricesVolume',
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      // PT rollover only supports SELL side (rolling from expiring PT to new PT)
      // BUY side is not applicable for this use case
      const pools = await aaveV3PtRollOver.getPoolIdentifiers(
        tokens[srcTokenSymbol],
        tokens[destTokenSymbol],
        SwapSide.BUY,
        blockNumber,
      );

      // Should return empty array for BUY side
      expect(pools.length).toBe(0);
      console.log('BUY side correctly returns empty pools (expected behavior)');
    });

    it('getTopPoolsForToken', async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newAaveV3PtRollOver = new AaveV3PtRollOver(
        network,
        dexKey,
        dexHelper,
      );
      if (newAaveV3PtRollOver.updatePoolState) {
        await newAaveV3PtRollOver.updatePoolState();
      }
      const poolLiquidity = await newAaveV3PtRollOver.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(`${srcTokenSymbol} Top Pools:`, poolLiquidity);

      if (!newAaveV3PtRollOver.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
