// npx jest src/dex/balancer-v3/balancer-stableSurge.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import { testPricesVsOnchain } from './balancer-test-helpers';

const dexKey = 'BalancerV3';
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];

describe('BalancerV3 stableSurge V1 hook tests', function () {
  const blockNumber = 22086000;
  let balancerV3: BalancerV3;
  const tBTC = tokens['tBTCv2'];
  const baoBTC = tokens['baoBTC'];
  // https://balancer.fi/pools/ethereum/v3/0xb22bd670c6e57c5fb486914dc478ae668507ddc8
  const stableSurgeV1Pool =
    '0xb22bd670c6e57c5fb486914dc478ae668507ddc8'.toLowerCase();

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
      expect(pools.some(pool => pool === stableSurgeV1Pool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(baoBTC.address, 100);
      expect(pools.some(pool => pool.address === stableSurgeV1Pool)).toBe(true);
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
          [stableSurgeV1Pool],
        );
      });
      it('BUY', async function () {
        const amounts = [0n, 50000000n];
        const side = SwapSide.BUY;
        await testPricesVsOnchain(
          balancerV3,
          network,
          amounts,
          tBTC,
          baoBTC,
          side,
          blockNumber,
          [stableSurgeV1Pool],
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
          [stableSurgeV1Pool],
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
          [stableSurgeV1Pool],
        );
      });
    });
  });
});

describe('BalancerV3 stableSurge V2 hook tests', function () {
  const blockNumber = 22466700;
  let balancerV3: BalancerV3;
  const EURC = tokens['EUROC'];
  const RLUSD = tokens['RLUSD'];
  // https://etherscan.io/address/0x0629e9703f0447402158eedca5148fe98df6d7a3
  const stableSurgeV2Pool =
    '0x0629e9703f0447402158eedca5148fe98df6d7a3'.toLowerCase();

  beforeAll(async () => {
    balancerV3 = new BalancerV3(network, dexKey, dexHelper);
    if (balancerV3.initializePricing) {
      await balancerV3.initializePricing(blockNumber);
    }
  });

  describe('pool with stableSurge hook should be returned', function () {
    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        EURC,
        RLUSD,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === stableSurgeV2Pool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(RLUSD.address, 100);
      expect(pools.some(pool => pool.address === stableSurgeV2Pool)).toBe(true);
    });
  });

  describe('should match onchain pricing', function () {
    it('SELL', async function () {
      const amounts = [0n, 100000000n];
      const side = SwapSide.SELL;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        EURC,
        RLUSD,
        side,
        blockNumber,
        [stableSurgeV2Pool],
      );
    });
    it('BUY', async function () {
      const amounts = [0n, 700000000n];
      const side = SwapSide.BUY;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        RLUSD,
        EURC,
        side,
        blockNumber,
        [stableSurgeV2Pool],
      );
    });
  });
});
