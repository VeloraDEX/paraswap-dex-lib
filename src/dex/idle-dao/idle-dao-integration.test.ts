import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { IdleDao } from './idle-dao';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';

async function testForIntegration(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
) {
  const TokenA = Tokens[network][tokenASymbol];
  const TokenB = Tokens[network][tokenBSymbol];
  const tokenAAmounts = [
    0n,
    BigInt(tokenAAmount),
    BigInt(tokenAAmount) * BigInt(2),
  ];
  const tokenBAmounts = [
    0n,
    BigInt(tokenBAmount),
    BigInt(tokenBAmount) * BigInt(2),
  ];

  describe('IdleDao', function () {
    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      const dexHelper = new DummyDexHelper(network);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const idleDao = new IdleDao(network, dexKey, dexHelper);

      await idleDao.initializePricing(blocknumber);

      const pools = await idleDao.getPoolIdentifiers(TokenA, TokenB);

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await idleDao.getPricesVolume(
        TokenA,
        TokenB,
        tokenAAmounts,
        SwapSide.SELL,
        blocknumber,
        pools,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, tokenAAmounts, SwapSide.SELL, dexKey);
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      const dexHelper = new DummyDexHelper(network);
      const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const idleDao = new IdleDao(network, dexKey, dexHelper);

      await idleDao.initializePricing(blocknumber);

      const pools = await idleDao.getPoolIdentifiers(TokenA, TokenB);

      expect(pools.length).toBeGreaterThan(0);

      const poolPrices = await idleDao.getPricesVolume(
        TokenA,
        TokenB,
        tokenBAmounts,
        SwapSide.BUY,
        blocknumber,
        pools,
      );

      expect(poolPrices).not.toBeNull();
      checkPoolPrices(poolPrices!, tokenBAmounts, SwapSide.BUY, dexKey);
    });

    it.only('getTopPoolsForToken', async function () {
      const dexHelper = new DummyDexHelper(network);
      const idleDao = new IdleDao(network, dexKey, dexHelper);

      const poolLiquidity = await idleDao.getTopPoolsForToken(
        TokenA.address,
        10,
      );

      checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
    });
  });
}

describe('IdleDao Integration tests', () => {
  const dexKey = 'IdleDao';

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const tests = [
      {
        tokenASymbol: 'STETH',
        tokenBSymbol: 'AA_wstETH',
        tokenAAmount: '1000000000000000000',
        tokenBAmount: '1000000000000000000',
      },
      {
        tokenASymbol: 'USDC',
        tokenBSymbol: 'AA_idle_cpPOR-USDC',
        tokenAAmount: '1000000',
        tokenBAmount: '1000000000000000000',
      },
      {
        tokenASymbol: 'USDT',
        tokenBSymbol: 'BB_idle_cpFAS-USDT',
        tokenAAmount: '1000000',
        tokenBAmount: '1000000000000000000',
      },
      {
        tokenASymbol: 'WETH',
        tokenBSymbol: 'BB_Re7WETH',
        tokenAAmount: '100000000000000',
        tokenBAmount: '100000000000000',
      },
      {
        tokenASymbol: 'WETH',
        tokenBSymbol: 'AA_Re7WETH',
        tokenAAmount: '1000000000000000',
        tokenBAmount: '1000000000000000',
      },
      {
        tokenASymbol: 'STETH',
        tokenBSymbol: 'AA_iETHv2',
        tokenAAmount: '1000000000000000',
        tokenBAmount: '1000000000000000',
      },
      {
        tokenASymbol: 'STETH',
        tokenBSymbol: 'BB_iETHv2',
        tokenAAmount: '1000000000000000',
        tokenBAmount: '1000000000000000',
      },
    ];

    tests.forEach(testData => {
      testForIntegration(
        network,
        dexKey,
        testData.tokenASymbol,
        testData.tokenBSymbol,
        testData.tokenAAmount,
        testData.tokenBAmount,
      );
    });
  });
});
