/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('ConcentratorArusd Gas Estimation', () => {
  const dexKey = 'ConcentratorArusd';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const rUSD = Tokens[network]['rUSD'];
    const arUSD = Tokens[network]['arUSD'];
    const amount = 1000000000000000n;

    it('deposit', async () => {
      await testGasEstimation(
        network,
        rUSD,
        arUSD,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
