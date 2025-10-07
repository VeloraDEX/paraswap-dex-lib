// npx jest src/dex/balancer-v3/balancer-akronHook.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';
import { testPricesVsOnchain } from './balancer-test-helpers';

const dexKey = 'BalancerV3';
const blockNumber = 30215021;
let balancerV3: BalancerV3;
const network = Network.BASE;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const waBasUSDC = tokens['waBasUSDC'];
const waBasWETH = tokens['waBasWETH'];
// https://balancer.fi/pools/base/v3/0x4fbb7870dbe7a7ef4866a33c0eed73d395730dc0
const akronHookPool =
  '0x4fbb7870dbe7a7ef4866a33c0eed73d395730dc0'.toLowerCase();

describe('BalancerV3 Akron hook tests', function () {
  beforeAll(async () => {
    balancerV3 = new BalancerV3(network, dexKey, dexHelper);
    if (balancerV3.initializePricing) {
      await balancerV3.initializePricing(blockNumber);
    }
  });

  describe('pool with Akron hook should be returned', function () {
    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        waBasUSDC,
        waBasWETH,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === akronHookPool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(
        waBasWETH.address,
        100,
      );
      expect(pools.some(pool => pool.address === akronHookPool)).toBe(true);
    });
  });

  describe('should match onchain pricing', function () {
    it('SELL', async function () {
      const amounts = [0n, 10000n, 100000000n];
      const side = SwapSide.SELL;

      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        waBasUSDC,
        waBasWETH,
        side,
        blockNumber,
        [akronHookPool],
      );
    });
    it('BUY', async function () {
      const amounts = [0n, 10000n, 1000000000n];
      const side = SwapSide.BUY;
      await testPricesVsOnchain(
        balancerV3,
        network,
        amounts,
        waBasWETH,
        waBasUSDC,
        side,
        blockNumber,
        [akronHookPool],
      );
    });
  });
});
