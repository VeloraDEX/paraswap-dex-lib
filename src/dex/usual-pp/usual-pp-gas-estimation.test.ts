/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('UsualPP Gas Estimation', () => {
  const dexKey = 'UsualPP';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USD0pp = Tokens[network]['USD0++'];
    const USD0 = Tokens[network]['USD0'];
    const amount = 100000000n;

    it('unlockUsd0ppFloorPrice', async () => {
      await testGasEstimation(
        network,
        USD0pp,
        USD0,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
