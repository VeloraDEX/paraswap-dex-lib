/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('AaveV3StataV2 Gas Estimation', () => {
  const dexKey = 'AaveV3StataV2';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const WETH = Tokens[network]['WETH'];
    const waEthWETH = Tokens[network]['waEthWETH'];
    const amount = 1000000000000000000n; // 1 eth

    it('redeem', async () => {
      await testGasEstimation(
        network,
        waEthWETH,
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
        waEthWETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
