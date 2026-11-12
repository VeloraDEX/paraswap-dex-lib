/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';

// Pools are exact-input only, so only SELL routes exist. The pricing applies
// the pool's fee multiplier for callers that are not whitelisted, so these
// pass before and after the Velora executors are whitelisted.
function testForNetwork(
  network: Network,
  pairs: [string, string, string, string][],
) {
  const dexKey = 'LunarBase';
  const tokens = Tokens[network];
  const holders = Holders[network];
  const side = SwapSide.SELL;
  const contractMethod = ContractMethod.swapExactAmountIn;

  describe(`${network}`, () => {
    pairs.forEach(([a, b, amountA, amountB]) => {
      it(`${a} -> ${b}`, async () => {
        await testE2E(
          tokens[a],
          tokens[b],
          holders[a],
          amountA,
          side,
          dexKey,
          contractMethod,
          network,
        );
      });

      it(`${b} -> ${a}`, async () => {
        await testE2E(
          tokens[b],
          tokens[a],
          holders[b],
          amountB,
          side,
          dexKey,
          contractMethod,
          network,
        );
      });
    });
  });
}

describe('LunarBase E2E', () => {
  testForNetwork(Network.BASE, [
    ['ETH', 'USDC', '100000000000000000', '200000000'],
    ['WETH', 'USDC', '100000000000000000', '200000000'],
  ]);

  testForNetwork(Network.BSC, [
    ['BNB', 'USDT', '500000000000000000', '200000000000000000000'],
    ['WBNB', 'USDT', '500000000000000000', '200000000000000000000'],
  ]);
});
