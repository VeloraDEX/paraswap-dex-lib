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
const eurc = tokens['EURC'];

describe('BalancerV3 reClamm tests', function () {
  // reClamm V1 & V2 are paused so we only test V3
  describe('reClamm version 3', function () {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);
    const tokens = Tokens[network];
    const usdc = tokens['USDC'];
    const weth = tokens['WETH'];
    const blockNumber = 25135240;
    // https://balancer.fi/pools/ethereum/v3/0xda66e8ddf9959e4db759bfd06256730d8a8b2d13
    const reClammPool =
      '0xda66e8ddf9959e4db759bfd06256730d8a8b2d13'.toLowerCase();

    describe('reClamm pool should be returned', function () {
      beforeAll(async () => {
        balancerV3 = new BalancerV3(network, dexKey, dexHelper);
        if (balancerV3.initializePricing) {
          await balancerV3.initializePricing(blockNumber);
        }
      });

      it('getPoolIdentifiers', async function () {
        const pools = await balancerV3.getPoolIdentifiers(
          usdc,
          weth,
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
  });
});
