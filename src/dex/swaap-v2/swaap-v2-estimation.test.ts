/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('SwaapV2 Gas Estimation', () => {
  const dexKey = 'SwaapV2';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDC = Tokens[network]['USDC'];
    const WETH = Tokens[network]['WETH'];
    const amount = 45410357n;

    it('swap', async () => {
      await testGasEstimation(
        network,
        USDC,
        WETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
