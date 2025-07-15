/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('AaveV3Stata Gas Estimation', () => {
  const dexKey = 'AaveV3Stata';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const WETH = Tokens[network]['WETH'];
    const stataEthWETH = Tokens[network]['stataEthWETH'];
    const amount = 1000000000000000000n;

    it('redeem', async () => {
      await testGasEstimation(
        network,
        stataEthWETH,
        WETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('deposit', async () => {
      await testGasEstimation(
        network,
        WETH,
        stataEthWETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
