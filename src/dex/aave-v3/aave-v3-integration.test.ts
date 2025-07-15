import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { AaveV3, TOKEN_LIST_CACHE_KEY } from './aave-v3';
import {
  checkConstantPoolPrices,
  checkPoolsLiquidity,
} from '../../../tests/utils';
import { BI_POWS } from '../../bigint-constants';

const network = Network.MAINNET;
const TokenASymbol = 'USDT';
const TokenA = {
  address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  decimals: 6,
};

const TokenBSymbol = 'aPolUSDT';
const TokenB = {
  address: '0x6ab707aca953edaefbc4fd23ba73294241490620',
  decimals: 6,
  symbol: 'aPolUSDT',
};

const amounts = [0n, BI_POWS[6], 2000000n];

const dexKey = 'AaveV3Lido';

describe('AaveV3', function () {
  it('The "initializePricing" method sets cache properly', async () => {
    const dexHelper = new DummyDexHelper(network);
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const aaveV3 = new AaveV3(network, dexKey, dexHelper);

    await expect(
      dexHelper.cache.getAndCacheLocally(
        dexKey,
        network,
        TOKEN_LIST_CACHE_KEY,
        0,
      ),
    ).resolves.toBeNull();
    await aaveV3.initializePricing(blockNumber);
    await expect(
      dexHelper.cache.getAndCacheLocally(
        dexKey,
        network,
        TOKEN_LIST_CACHE_KEY,
        0,
      ),
    ).resolves.toMatch('aPol');
  });

  if (TokenA) {
    if (TokenB) {
      it('getPoolIdentifiers and getPricesVolume SELL', async function () {
        const dexHelper = new DummyDexHelper(network);
        const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        const aaveV3 = new AaveV3(network, dexKey, dexHelper);

        // Invoke the "initializePricing" method manually in tests. Invoked by the SDK automatically otherwise.
        await aaveV3.initializePricing(blockNumber);

        const pools = await aaveV3.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aaveV3.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `,
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkConstantPoolPrices(poolPrices!, amounts, dexKey);

        const topPoolsA = await aaveV3.getTopPoolsForToken(TokenA.address, 10);
        const topPoolsB = await aaveV3.getTopPoolsForToken(TokenB.address, 10);

        expect(topPoolsA.length).toBeGreaterThan(0);
        expect(topPoolsB.length).toBeGreaterThan(0);
      });

      it('getPoolIdentifiers and getPricesVolume BUY', async function () {
        const dexHelper = new DummyDexHelper(network);
        const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
        const aaveV3 = new AaveV3(network, dexKey, dexHelper);

        // Invoke the "initializePricing" method manually in tests. Invoked by the SDK automatically otherwise.
        await aaveV3.initializePricing(blocknumber);

        const pools = await aaveV3.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.BUY,
          blocknumber,
        );
        console.log(
          `${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `,
          pools,
        );

        expect(pools.length).toBeGreaterThan(0);

        const poolPrices = await aaveV3.getPricesVolume(
          TokenA,
          TokenB,
          amounts,
          SwapSide.BUY,
          blocknumber,
          pools,
        );
        console.log(
          '${TokenASymbol} <> ${TokenBSymbol} Pool Prices: ',
          poolPrices,
        );

        expect(poolPrices).not.toBeNull();
        checkConstantPoolPrices(poolPrices!, amounts, dexKey);
      });
    } else expect(TokenB).not.toBeNull();

    it('getTopPoolsForToken', async function () {
      const dexHelper = new DummyDexHelper(network);
      const aaveV3 = new AaveV3(network, dexKey, dexHelper);

      const poolLiquidity = await aaveV3.getTopPoolsForToken(
        '0xc035a7cf15375ce2706766804551791ad035e0c2',
        10,
      );
      console.log(`${TokenASymbol} Top Pools:`, poolLiquidity);

      checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
    });
  } else expect(TokenA).not.toBe(undefined);
});
