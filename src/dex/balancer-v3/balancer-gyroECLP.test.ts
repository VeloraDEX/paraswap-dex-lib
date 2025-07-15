// npx jest src/dex/balancer-v3/balancer-gyroECLP.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import { testPricesVsOnchain } from './balancer-test-helpers';

const dexKey = 'BalancerV3';
const blockNumber = 317980000;
let balancerV3: BalancerV3;
const network = Network.ARBITRUM;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const eBTC = tokens['eBTC'];
const usdc = tokens['USDC'];
// https://arbiscan.io/address/0xa0e5e7728e026bde02810d255a6b94a9aa47b5f9
const gyroECLPPool = '0xa0e5e7728e026bde02810d255a6b94a9aa47b5f9'.toLowerCase();

describe('BalancerV3 GyroECLP tests', function () {
  beforeAll(async () => {
    balancerV3 = new BalancerV3(network, dexKey, dexHelper);
    if (balancerV3.initializePricing) {
      await balancerV3.initializePricing(blockNumber);
    }
  });

  describe('GyroECLP pool should be returned', function () {
    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        eBTC,
        usdc,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === gyroECLPPool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(usdc.address, 10);
      expect(pools.some(pool => pool.address === gyroECLPPool)).toBe(true);
    });

    describe('should match onchain pricing', function () {
      it('SELL', async function () {
        const amounts = [0n, 10000000n];
        const side = SwapSide.SELL;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          usdc,
          eBTC,
          side,
          blockNumber,
          [gyroECLPPool],
        );
      });
      it('BUY', async function () {
        const amounts = [0n, 10000000n];
        const side = SwapSide.BUY;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          eBTC,
          usdc,
          side,
          blockNumber,
          [gyroECLPPool],
        );
      });
    });
  });
});
