/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Wombat Gas Estimation', () => {
  const dexKey = 'Wombat';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDT = Tokens[network]['USDT'];
    const USDC = Tokens[network]['USDC'];
    const amount = 100000000n;

    it('swapExactTokensForTokens', async () => {
      await testGasEstimation(
        network,
        USDT,
        USDC,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
