/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('AngleStakedStable Gas Estimation', () => {
  const dexKey = 'AngleStakedStableUSD';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDA = Tokens[network]['USDA'];
    const stUSD = Tokens[network]['stUSD'];
    const amount = 990000000000000000n;

    it('deposit', async () => {
      await testGasEstimation(
        network,
        USDA,
        stUSD,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
