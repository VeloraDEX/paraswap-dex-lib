// npx jest src/dex/balancer-v3/balancer-stableSurge.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import { testPricesVsOnchain } from './balancer-test-helpers';

const dexKey = 'BalancerV3';
const blockNumber = 22630600;
let balancerV3: BalancerV3;
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const tBTC = tokens['tBTCv2'];
const baoBTC = tokens['baoBTC'];
// https://balancer.fi/pools/ethereum/v3/0xb22bd670c6e57c5fb486914dc478ae668507ddc8
const stableSurgePool =
  '0xb22bd670c6e57c5fb486914dc478ae668507ddc8'.toLowerCase();

describe('BalancerV3 stableSurge hook tests', function () {
  beforeAll(async () => {
    balancerV3 = new BalancerV3(network, dexKey, dexHelper);
    if (balancerV3.initializePricing) {
      await balancerV3.initializePricing(blockNumber);
    }
  });

  describe('pool with stableSurge hook should be returned', function () {
    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        tBTC,
        baoBTC,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === stableSurgePool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(baoBTC.address, 10);
      expect(pools.some(pool => pool.address === stableSurgePool)).toBe(true);
    });
  });

  describe('should match onchain pricing', function () {
    describe('using staticFee', function () {
      it('SELL', async function () {
        const amounts = [0n, 100000000n];
        const side = SwapSide.SELL;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          tBTC,
          baoBTC,
          side,
          blockNumber,
          [stableSurgePool],
        );
      });
      it('BUY', async function () {
        const amounts = [0n, 50000000n];
        const side = SwapSide.BUY;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          baoBTC,
          tBTC,
          side,
          blockNumber,
          [stableSurgePool],
        );
      });
    });
    describe('using surge fee', function () {
      it('SELL', async function () {
        const amounts = [0n, 1000000000000000000n];
        const side = SwapSide.SELL;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          baoBTC,
          tBTC,
          side,
          blockNumber,
          [stableSurgePool],
        );
      });
      it('BUY', async function () {
        const amounts = [0n, 1976459205n];
        const side = SwapSide.BUY;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          baoBTC,
          tBTC,
          side,
          blockNumber,
          [stableSurgePool],
        );
      });
    });
  });
});
