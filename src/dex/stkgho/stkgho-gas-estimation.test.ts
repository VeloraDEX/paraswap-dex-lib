/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('StkGHO Gas Estimation', () => {
  const dexKey = 'StkGHO';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const GHO = Tokens[network]['GHO'];
    const stkGHO = Tokens[network]['stkGHO'];
    const amount = 1000000000000000000n;

    it('stake', async () => {
      await testGasEstimation(
        network,
        GHO,
        stkGHO,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
