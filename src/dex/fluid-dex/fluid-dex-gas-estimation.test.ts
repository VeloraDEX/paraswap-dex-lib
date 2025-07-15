/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('FluidDex Gas Estimation', () => {
  const dexKey = 'FluidDex';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDC = Tokens[network]['USDC'];
    const USDT = Tokens[network]['USDT'];
    const amount = 10000n;

    it('swapIn', async () => {
      await testGasEstimation(
        network,
        USDC,
        USDT,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
