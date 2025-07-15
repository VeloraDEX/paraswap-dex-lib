// npx jest src/dex/balancer-v3/balancer-test-weighted.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import {
  allPricesAreZero,
  checkOnChainPricingNonMulti,
} from './balancer-test-helpers';
import { ExchangePrices, Token } from '../../types';
import { BalancerV3Data } from './types';

const dexKey = 'BalancerV3';
const blockNumber = 27675048;
let balancerV3: BalancerV3;
const network = Network.BASE;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const usdc = tokens['USDC'];
const weth = tokens['WETH'];
// https://basescan.org/address/0x0657c3467f3bf465fab59b10f1453d665abe507e
const weightedPool = '0x0657c3467f3bf465fab59b10f1453d665abe507e'.toLowerCase();

describe('BalancerV3 Weighted pool tests', function () {
  beforeAll(async () => {
    balancerV3 = new BalancerV3(network, dexKey, dexHelper);
    if (balancerV3.initializePricing) {
      await balancerV3.initializePricing(blockNumber);
    }
  });

  describe('pool should be returned', function () {
    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        weth,
        usdc,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === weightedPool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(weth.address, 100);
      expect(pools.some(pool => pool.address === weightedPool)).toBe(true);
    });
  });

  describe('should match onchain pricing', function () {
    it('SELL', async function () {
      const amounts = [0n, 3000000000000000n];
      const side = SwapSide.SELL;
      await testPricesVsOnchain(amounts, weth, usdc, side, blockNumber, [
        weightedPool,
      ]);
    });
    it('BUY', async function () {
      const amounts = [0n, 5000000n];
      const side = SwapSide.BUY;
      await testPricesVsOnchain(amounts, weth, usdc, side, blockNumber, [
        weightedPool,
      ]);
    });
  });
});

async function testPricesVsOnchain(
  amounts: bigint[],
  srcToken: Token,
  dstToken: Token,
  side: SwapSide,
  blockNumber: number,
  limitPools: string[],
) {
  const prices = await balancerV3.getPricesVolume(
    srcToken,
    dstToken,
    amounts,
    side,
    blockNumber,
    limitPools,
  );
  expect(prices).not.toBeNull();
  expect(prices?.length).toBeGreaterThan(0);
  expect(allPricesAreZero(prices!)).toBe(false);
  await checkOnChainPricingNonMulti(
    network,
    side,
    balancerV3,
    blockNumber,
    prices as ExchangePrices<BalancerV3Data>,
    amounts,
  );
}
