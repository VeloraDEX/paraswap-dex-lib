/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Orbital } from './orbital';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import OrbitalPoolABI from '../../abi/orbital/OrbitalPool.json';

const POOL = '0x6b229b018Cc4B5ba48ab3C7a5b4578E17Bc117DA';
const poolIface = new Interface(OrbitalPoolABI);

// The pool's own quote(assetIn, assetOut, amount, exactInput) at the same block: (amountIn, amountOut).
async function checkOnChainPricing(
  orbital: Orbital,
  blockNumber: number,
  assetIn: number,
  assetOut: number,
  side: SwapSide,
  prices: bigint[],
  amounts: bigint[],
) {
  const exactInput = side === SwapSide.SELL;
  const calls = amounts.slice(1).map(amount => ({
    target: POOL,
    callData: poolIface.encodeFunctionData('quote', [
      assetIn,
      assetOut,
      amount,
      exactInput,
    ]),
  }));
  const { returnData } = await orbital.dexHelper.multiContract.methods
    .aggregate(calls)
    .call({}, blockNumber);
  const expected = returnData.map((data: string) => {
    const [amountIn, amountOut] = poolIface.decodeFunctionResult('quote', data);
    return BigInt((exactInput ? amountOut : amountIn).toString());
  });
  expect(prices).toEqual([0n, ...expected]);
}

async function testPricing(
  orbital: Orbital,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const tokens = Tokens[network];
  const pools = await orbital.getPoolIdentifiers(
    tokens[srcTokenSymbol],
    tokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(`${srcTokenSymbol} <> ${destTokenSymbol} pools:`, pools);
  expect(pools).toEqual([`${dexKey}_${POOL}`.toLowerCase()]);

  const poolPrices = await orbital.getPricesVolume(
    tokens[srcTokenSymbol],
    tokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} ${side} prices:`,
    poolPrices,
  );
  expect(poolPrices).not.toBeNull();
  checkPoolPrices(poolPrices!, amounts, side, dexKey);

  const { assetIn, assetOut } = poolPrices![0].data;
  await checkOnChainPricing(
    orbital,
    blockNumber,
    assetIn,
    assetOut,
    side,
    poolPrices![0].prices,
    amounts,
  );
}

// Evenly spaced (checkPoolPrices compares consecutive increments): 0 to 1,000 tokens by 100, within the pool's
// capacity in every direction.
const ladder = (decimals: number) =>
  Array.from({ length: 11 }, (_, k) => BigInt(k) * 100n * BI_POWS[decimals]);

describe('Orbital', function () {
  const dexKey = 'Orbital';
  let blockNumber: number;
  let orbital: Orbital;

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];

    beforeAll(async () => {
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      orbital = new Orbital(network, dexKey, dexHelper);
      await orbital.initializePricing(blockNumber);
    });

    // Every direction of the three assets, both sides: USDC (6), USDT0 (6), DAI (18).
    for (const [src, dest] of [
      ['USDCn', 'USDT'],
      ['USDT', 'USDCn'],
      ['USDCn', 'DAI'],
      ['DAI', 'USDCn'],
      ['USDT', 'DAI'],
      ['DAI', 'USDT'],
    ]) {
      it(`${src} -> ${dest} SELL`, async function () {
        await testPricing(
          orbital,
          network,
          dexKey,
          blockNumber,
          src,
          dest,
          SwapSide.SELL,
          ladder(tokens[src].decimals),
        );
      });

      it(`${src} -> ${dest} BUY`, async function () {
        await testPricing(
          orbital,
          network,
          dexKey,
          blockNumber,
          src,
          dest,
          SwapSide.BUY,
          ladder(tokens[dest].decimals),
        );
      });
    }

    it('prices an amount beyond the pool at 0, not as an error', async function () {
      const amounts = [0n, 1n * BI_POWS[6], 10n ** 15n * BI_POWS[6]];
      const poolPrices = await orbital.getPricesVolume(
        tokens.USDCn,
        tokens.USDT,
        amounts,
        SwapSide.SELL,
        blockNumber,
      );
      expect(poolPrices![0].prices[1]).toBeGreaterThan(0n);
      expect(poolPrices![0].prices[2]).toBe(0n);
    });

    it('getTopPoolsForToken', async function () {
      // Without initializePricing: the pool tracker only calls updatePoolState.
      const newOrbital = new Orbital(network, dexKey, dexHelper);
      await newOrbital.updatePoolState();
      for (const symbol of ['USDCn', 'USDT', 'DAI']) {
        const poolLiquidity = await newOrbital.getTopPoolsForToken(
          tokens[symbol].address,
          10,
        );
        console.log(`${symbol} top pools:`, poolLiquidity);
        checkPoolsLiquidity(poolLiquidity, tokens[symbol].address, dexKey);
        expect(poolLiquidity[0].connectorTokens).toHaveLength(2);
      }
    });
  });
});
