/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Bebop Gas Estimation', () => {
  const dexKey = 'Bebop';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDC = Tokens[network]['USDC'];
    const WETH = Tokens[network]['WETH'];
    const amount = 1000000000n;

    // todo: debug build fail in this test case
    it('swapSingle', async () => {
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
