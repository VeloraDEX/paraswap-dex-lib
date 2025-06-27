import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper';
import { Network, SwapSide } from '../../constants';
import { UniswapV2 } from './uniswap-v2';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { BI_POWS } from '../../bigint-constants';
import { Tokens } from '../../../tests/constants-e2e';

const amounts = [0n, BI_POWS[18], 2000000000000000000n];

describe('UniswapV2', function () {
  const dexKey = 'UniswapV2';
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const uniswapV2 = new UniswapV2(network, dexKey, dexHelper);

  const tokenASymbol = 'USDC';
  const tokenBSymbol = 'DAI';

  const tokenA = Tokens[network][tokenASymbol];
  const tokenB = Tokens[network][tokenBSymbol];

  it(`${tokenASymbol} <> ${tokenBSymbol} getPoolIdentifiers and getPricesVolume SELL`, async function () {
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    const pools = await uniswapV2.getPoolIdentifiers(
      tokenA,
      tokenB,
      SwapSide.SELL,
      blockNumber,
    );
    console.log(`${tokenASymbol} <> ${tokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV2.getPricesVolume(
      tokenA,
      tokenB,
      amounts,
      SwapSide.SELL,
      blockNumber,
      pools,
    );
    console.log(`${tokenASymbol} <> ${tokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
  });

  it(`${tokenASymbol} <> ${tokenBSymbol} getPoolIdentifiers and getPricesVolume BUY`, async function () {
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    const pools = await uniswapV2.getPoolIdentifiers(
      tokenA,
      tokenB,
      SwapSide.BUY,
      blockNumber,
    );
    console.log(`${tokenASymbol} <> ${tokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await uniswapV2.getPricesVolume(
      tokenA,
      tokenB,
      amounts,
      SwapSide.BUY,
      blockNumber,
      pools,
    );
    console.log(`${tokenASymbol} <> ${tokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
  });

  it('getTopPoolsForToken', async function () {
    const poolLiquidity = await uniswapV2.getTopPoolsForToken(
      tokenA.address,
      10,
    );
    console.log(`${tokenASymbol} Top Pools:`, poolLiquidity);

    checkPoolsLiquidity(poolLiquidity, tokenA.address, dexKey);
  });
});
