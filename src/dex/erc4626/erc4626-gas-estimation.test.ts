/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('wUSDM Gas Estimation', () => {
  const dexKey = 'wUSDM';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const wUSDM = Tokens[network]['wUSDM'];
    const USDM = Tokens[network]['USDM'];
    const amount = 500n;

    it('deposit', async () => {
      await testGasEstimation(
        network,
        USDM,
        wUSDM,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('redeem', async () => {
      await testGasEstimation(
        network,
        wUSDM,
        USDM,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
