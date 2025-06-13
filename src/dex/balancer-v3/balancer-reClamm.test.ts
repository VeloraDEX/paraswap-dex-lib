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
// https://balancer.fi/pools/base/v3/0xBa615a0A9237b64BFb3051f8160483C10Dde0012
const reClammPool = '0xBa615a0A9237b64BFb3051f8160483C10Dde0012'.toLowerCase();

describe('BalancerV3 reClamm tests', function () {
  describe('reClamm pool should be returned', function () {
    const blockNumber = 31119392;
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
    const blockNumber = 31094200;
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
    // Pool out of range after this tx: https://basescan.org/tx/0x5b89fcf88860f04cf6798c1ee7a3044b3f30a8dc2e85e5cdd34845e13bbb6f70
    const blockNumber = 31094381;
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
