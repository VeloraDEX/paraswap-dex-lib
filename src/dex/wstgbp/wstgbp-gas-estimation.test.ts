/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('WstGBP Gas Estimation', () => {
  const dexKey = 'wstGBP';
  const network = Network.MAINNET;

  const tGBP = Tokens[network]['tGBP'];
  const wstGBP = Tokens[network]['wstGBP'];
  const amount = 3000000000000000000n;

  describe('swapExactAmountIn', () => {
    it('mint (buy wstGBP with tGBP)', async () => {
      await testGasEstimation(
        network,
        tGBP,
        wstGBP,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('redeem (sell wstGBP for tGBP)', async () => {
      await testGasEstimation(
        network,
        wstGBP,
        tGBP,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });

  describe('swapExactAmountOut', () => {
    it('mint (exact wstGBP out)', async () => {
      await testGasEstimation(
        network,
        tGBP,
        wstGBP,
        amount,
        SwapSide.BUY,
        dexKey,
        ContractMethodV6.swapExactAmountOut,
      );
    });

    it('redeem (exact tGBP out)', async () => {
      await testGasEstimation(
        network,
        wstGBP,
        tGBP,
        amount,
        SwapSide.BUY,
        dexKey,
        ContractMethodV6.swapExactAmountOut,
      );
    });
  });
});
