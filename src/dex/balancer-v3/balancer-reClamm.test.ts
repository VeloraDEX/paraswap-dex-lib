// npx jest src/dex/balancer-v3/balancer-reClamm.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import { testPricesVsOnchain } from './balancer-test-helpers';

const dexKey = 'BalancerV3';
let balancerV3: BalancerV3;
const network = Network.BASE;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const weth = tokens['WETH'];
const usdc = tokens['USDC'];
// https://balancer.fi/pools/base/v3/0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B
const reClammPool = '0x97c4B3E63566D6Ece3c9BCE535EDc2CA52FC6d5B'.toLowerCase();

describe('BalancerV3 reClamm tests', function () {
  describe('reClamm pool should be returned', function () {
    const blockNumber = 31484040;
    beforeAll(async () => {
      balancerV3 = new BalancerV3(network, dexKey, dexHelper);
      if (balancerV3.initializePricing) {
        await balancerV3.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        weth,
        usdc,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === reClammPool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(usdc.address, 100);
      expect(pools.some(pool => pool.address === reClammPool)).toBe(true);
    });
  });

  describe('should match onchain pricing - in range', function () {
    const blockNumber = 31484040;
    beforeAll(async () => {
      balancerV3 = new BalancerV3(network, dexKey, dexHelper);
      if (balancerV3.initializePricing) {
        await balancerV3.initializePricing(blockNumber);
      }
    });

    it('SELL', async function () {
      const amounts = [0n, 100000n];
      const side = SwapSide.SELL;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        usdc,
        weth,
        side,
        blockNumber,
        [reClammPool],
      );
    });
    it('BUY', async function () {
      const amounts = [0n, 200000n];
      const side = SwapSide.BUY;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        weth,
        usdc,
        side,
        blockNumber,
        [reClammPool],
      );
    });
  });

  describe('should match onchain pricing - out of range', function () {
    // Pool out of range after this tx: https://basescan.org/tx/0xa0a1e8fc10d421400cbecaeb8e9cf0c3a556f19dcfc5f6006459c86b64b79d99
    const blockNumber = 31484055;
    beforeAll(async () => {
      balancerV3 = new BalancerV3(network, dexKey, dexHelper);
      if (balancerV3.initializePricing) {
        await balancerV3.initializePricing(blockNumber);
      }
    });

    it('SELL', async function () {
      const amounts = [0n, 100000n];
      const side = SwapSide.SELL;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        usdc,
        weth,
        side,
        blockNumber,
        [reClammPool],
      );
    });
    it('BUY', async function () {
      const amounts = [0n, 2200000000000n];
      const side = SwapSide.BUY;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        usdc,
        weth,
        side,
        blockNumber,
        [reClammPool],
      );
    });
  });
});
