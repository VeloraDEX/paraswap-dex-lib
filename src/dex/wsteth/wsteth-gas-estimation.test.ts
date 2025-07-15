/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('wstETH Gas Estimation', () => {
  const dexKey = 'wstETH';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const STETH = Tokens[network]['STETH'];
    const wstETH = Tokens[network]['wstETH'];
    const amount = 1000000000000000000n;

    it('wrap', async () => {
      await testGasEstimation(
        network,
        STETH,
        wstETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('unwrap', async () => {
      await testGasEstimation(
        network,
        wstETH,
        STETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
