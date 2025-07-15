// npx jest src/dex/balancer-v3/balancer-buffer.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3 } from './balancer-v3';

const dexKey = 'BalancerV3';
const blockNumber = 21990000;
let balancerV3: BalancerV3;
const network = Network.MAINNET;
const dexHelper = new DummyDexHelper(network);
const tokens = Tokens[network];
const usdc = tokens['USDC'];
const waEthUSDC = tokens['waEthUSDC'];

// https://balancer.fi/pools/ethereum/v3/0x85b2b559bc2d21104c4defdd6efca8a20343361d
const boostedStablePool = '0x85b2b559bc2d21104c4defdd6efca8a20343361d';

describe('BalancerV3 Buffer/ERC4626 tests', function () {
  beforeAll(async () => {
    balancerV3 = new BalancerV3(network, dexKey, dexHelper);
    if (balancerV3.initializePricing) {
      await balancerV3.initializePricing(blockNumber);
    }
  });

  describe('boosted stable pool should be returned', function () {
    it('getPoolIdentifiers', async function () {
      const pools = await balancerV3.getPoolIdentifiers(
        usdc,
        waEthUSDC,
        SwapSide.SELL,
        blockNumber,
      );
      expect(pools.some(pool => pool === boostedStablePool)).toBe(true);
    });

    it('getTopPoolsForToken', async function () {
      const pools = await balancerV3.getTopPoolsForToken(waEthUSDC.address, 10);
      expect(pools.some(pool => pool.address === boostedStablePool)).toBe(true);
    });
  });

  describe('should return 0 prices when amount > maxDeposit/mint', function () {
    it('SELL (maxDeposit)', async function () {
      const amounts = [0n, 10000000000000000n];
      const side = SwapSide.SELL;

      const prices = await balancerV3.getPricesVolume(
        usdc,
        waEthUSDC,
        amounts,
        side,
        blockNumber,
        [boostedStablePool],
      );
      prices![0].prices.forEach(p => expect(p).toEqual(0n));
    });
    it('BUY (maxMint)', async function () {
      const amounts = [0n, 500000000000000000n];
      const side = SwapSide.BUY;
      const prices = await balancerV3.getPricesVolume(
        usdc,
        waEthUSDC,
        amounts,
        side,
        blockNumber,
        [boostedStablePool],
      );
      prices![0].prices.forEach(p => expect(p).toEqual(0n));
    });
  });
});
