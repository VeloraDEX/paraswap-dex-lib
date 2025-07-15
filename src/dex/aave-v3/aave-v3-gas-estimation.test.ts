/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('AaveV3 Gas Estimation', () => {
  const dexKey = 'AaveV3';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const ETH = Tokens[network]['ETH'];
    const WETH = Tokens[network]['WETH'];
    const aEthWETH = Tokens[network]['aEthWETH'];
    const amount = 1000000000000000000n;

    it('supply', async () => {
      await testGasEstimation(
        network,
        WETH,
        aEthWETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('withdraw', async () => {
      await testGasEstimation(
        network,
        aEthWETH,
        WETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('depositETH', async () => {
      await testGasEstimation(
        network,
        ETH,
        aEthWETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('withdrawETH', async () => {
      await testGasEstimation(
        network,
        aEthWETH,
        ETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
