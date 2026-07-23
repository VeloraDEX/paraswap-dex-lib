/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import BigNumber from 'bignumber.js';
import { utils } from 'ethers';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Bebop } from './bebop';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

async function testPricingOnNetwork(
  bebop: Bebop,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];

  const pools = await bebop.getPoolIdentifiers(
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

  const poolPrices = await bebop.getPricesVolume(
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
  if (bebop.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey, false);
  }
}

describe('Bebop', function () {
  const dexKey = 'Bebop';
  let blockNumber: number;
  let bebop: Bebop;

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'ETH';
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
      1000n * BI_POWS[tokens[destTokenSymbol].decimals],
      2000n * BI_POWS[tokens[destTokenSymbol].decimals],
      3000n * BI_POWS[tokens[destTokenSymbol].decimals],
      4000n * BI_POWS[tokens[destTokenSymbol].decimals],
      5000n * BI_POWS[tokens[destTokenSymbol].decimals],
      6000n * BI_POWS[tokens[destTokenSymbol].decimals],
      7000n * BI_POWS[tokens[destTokenSymbol].decimals],
      8000n * BI_POWS[tokens[destTokenSymbol].decimals],
      9000n * BI_POWS[tokens[destTokenSymbol].decimals],
      10000n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      bebop = new Bebop(network, dexKey, dexHelper);
      if (bebop.initializePricing) {
        await bebop.initializePricing(blockNumber);
      }
    });

    afterAll(async () => {
      if (bebop?.releaseResources) {
        await bebop.releaseResources();
      }
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        bebop,
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
        bebop,
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
      const newBebop = new Bebop(network, dexKey, dexHelper);
      if (newBebop.updatePoolState) {
        await newBebop.updatePoolState();
      }
      const poolLiquidity = await newBebop.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );
      console.log(
        `${srcTokenSymbol} Top Pools:`,
        JSON.stringify(poolLiquidity, null, 2),
      );

      if (!newBebop.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it('getPoolIdentifiers returns no liquidity for Wrapped -> Native', async function () {
      const pools = await bebop.getPoolIdentifiers(
        tokens['WETH'],
        tokens['ETH'],
        SwapSide.SELL,
        blockNumber,
      );
      console.log('WETH -> ETH Pool Identifiers: ', pools);

      expect(pools.length).toBe(0);
    });

  });

  describe('DexParam Generation', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];
    const bebop = new Bebop(network, dexKey, dexHelper);
    const routerAddress = '0xBeb0009ACa35087ce7cCF11637E24dd1Aad3bf2A';
    const settlementAddress = '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F';
    const userAddress = '0x5Bad996643a924De21b6b2875c85C33F3c5bBcB6';
    const routerCalldata =
      '0xa3ce737f' + '0'.repeat(64) + '1'.padStart(64, '0');

    it('uses returned router tx target and approval target', () => {
      const data = {
        approvalTarget: settlementAddress,
        partialFillOffset: 1,
        tx: {
          to: routerAddress,
          value: '0x0',
          data: routerCalldata,
        },
      };

      const dexParam = bebop.getDexParam(
        tokens['WETH'].address,
        tokens['USDC'].address,
        '1000000000000000000',
        '1000000000',
        userAddress,
        data,
        SwapSide.SELL,
      );

      expect(dexParam.targetExchange).toBe(utils.getAddress(routerAddress));
      expect(dexParam.spender).toBe(utils.getAddress(settlementAddress));
      expect(dexParam.exchangeData).toBe(routerCalldata);
      expect(dexParam.insertFromAmountPos).toBe(36);
    });

    it('does not infer a dynamic amount position without partialFillOffset', () => {
      const data = {
        approvalTarget: routerAddress,
        tx: {
          to: routerAddress,
          value: '0x0',
          data: routerCalldata,
        },
      };

      const dexParam = bebop.getDexParam(
        tokens['WETH'].address,
        tokens['USDC'].address,
        '1000000000000000000',
        '1000000000',
        userAddress,
        data,
        SwapSide.SELL,
      );

      expect(dexParam.targetExchange).toBe(utils.getAddress(routerAddress));
      expect(dexParam.spender).toBe(utils.getAddress(routerAddress));
      expect(dexParam.swappedAmountNotPresentInExchangeData).toBe(true);
      expect(dexParam.insertFromAmountPos).toBeUndefined();
    });

    it('does not insert sell amount into router buy calldata', () => {
      const data = {
        approvalTarget: routerAddress,
        partialFillOffset: 1,
        tx: {
          to: routerAddress,
          value: '0x0',
          data: routerCalldata,
        },
      };

      const dexParam = bebop.getDexParam(
        tokens['WETH'].address,
        tokens['USDC'].address,
        '1000000000000000000',
        '1000000000',
        userAddress,
        data,
        SwapSide.BUY,
      );

      expect(dexParam.targetExchange).toBe(utils.getAddress(routerAddress));
      expect(dexParam.spender).toBe(utils.getAddress(routerAddress));
      expect(dexParam.swappedAmountNotPresentInExchangeData).toBe(true);
      expect(dexParam.insertFromAmountPos).toBeUndefined();
    });

    it('passes slippage to quote request and validates minimum amount', async () => {
      const localDexHelper = new DummyDexHelper(network);
      const localBebop = new Bebop(network, dexKey, localDexHelper);
      const wethAddress = utils.getAddress(tokens['WETH'].address);
      const usdcAddress = utils.getAddress(tokens['USDC'].address);

      const getMock = jest.fn(async (url: string) => {
        expect(decodeURIComponent(url)).toContain('slippage=1');

        return {
          requestId: 'request-id',
          quoteId: 'quote-id',
          expiry: Math.floor(Date.now() / 1000) + 60,
          approvalTarget: routerAddress,
          buyTokens: {
            [usdcAddress]: {
              amount: '1000000000',
              minimumAmount: '980000000',
            },
          },
          sellTokens: {
            [wethAddress]: {
              amount: '1000000000000000000',
            },
          },
          tx: {
            to: routerAddress,
            value: '0x0',
            data: routerCalldata,
          },
        };
      });

      (localDexHelper.httpRequest.get as any) = getMock;

      await expect(
        localBebop.preProcessTransaction(
          {
            srcAmount: '1000000000000000000',
            destAmount: '1000000000',
          } as any,
          tokens['WETH'],
          tokens['USDC'],
          SwapSide.SELL,
          {
            slippageFactor: new BigNumber('0.99'),
            txOrigin: userAddress,
            userAddress,
            executionContractAddress: userAddress,
            recipient: userAddress,
          } as any,
        ),
      ).rejects.toThrow(/SlippageCheckError/);

      expect(getMock).toHaveBeenCalledTimes(1);
    });

  });
});
