// npx jest src/dex/balancer-v3/balancer-quantAMM.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import { testPricesVsOnchain } from './balancer-test-helpers';

const dexKey = 'BalancerV3';
let balancerV3: BalancerV3;
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const usdc = tokens['USDC'];
const wbtc = tokens['WBTC'];
// https://balancer.fi/pools/ethereum/v3/0x6b61d8680c4f9e560c8306807908553f95c749c5
const quantAMMPool = '0x6b61d8680c4f9e560c8306807908553f95c749c5'.toLowerCase();

describe('BalancerV3 QuantAMM tests', function () {
  const blockNumber = 22744200;
  describe('QuantAMM pool should be returned', function () {
    beforeAll(async () => {
      balancerV3 = new BalancerV3(network, dexKey, dexHelper);
      if (balancerV3.initializePricing) {
        await balancerV3.initializePricing(blockNumber);
      }
    });

    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        usdc,
        wbtc,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === quantAMMPool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(wbtc.address, 10);
      expect(pools.some(pool => pool.address === quantAMMPool)).toBe(true);
    });
  });

  describe('should match onchain pricing', function () {
    beforeAll(async () => {
      balancerV3 = new BalancerV3(network, dexKey, dexHelper);
      if (balancerV3.initializePricing) {
        await balancerV3.initializePricing(blockNumber);
      }
    });

    it('SELL', async function () {
      const amounts = [0n, 10000n];
      const side = SwapSide.SELL;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        wbtc,
        usdc,
        side,
        blockNumber,
        [quantAMMPool],
      );
    });
    it('BUY', async function () {
      const amounts = [0n, 1000000n];
      const side = SwapSide.BUY;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        wbtc,
        usdc,
        side,
        blockNumber,
        [quantAMMPool],
      );
    });
  });
});
