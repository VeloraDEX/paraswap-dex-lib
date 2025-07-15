/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Bancor Gas Estimation', () => {
  const dexKey = 'Bancor';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDT = Tokens[network]['USDT'];
    const BNT = Tokens[network]['BNT'];
    const amount = 100000000n;

    // https://dashboard.tenderly.co/paraswap/paraswap/simulator/bcb58187-2a53-4d7f-b0b7-f1cce81ef0c8/gas-usage
    it('convert2', async () => {
      await testGasEstimation(
        network,
        USDT,
        BNT,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
