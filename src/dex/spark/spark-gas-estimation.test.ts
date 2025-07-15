/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Spark Gas Estimation', () => {
  const dexKey = 'Spark';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const DAI = Tokens[network]['DAI'];
    const sDAI = Tokens[network]['sDAI'];
    const amount = 1000000000000000000n;

    it('deposit', async () => {
      await testGasEstimation(
        network,
        DAI,
        sDAI,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
