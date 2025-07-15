/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('AngleTransmuter Gas Estimation', () => {
  const dexKey = 'AngleTransmuter';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDC = Tokens[network]['USDC'];
    const USDA = Tokens[network]['USDA'];
    const amount = 99000000000000000n;

    it('swapExactInput - from collateral', async () => {
      await testGasEstimation(
        network,
        USDC,
        USDA,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('swapExactInput - to collateral', async () => {
      await testGasEstimation(
        network,
        USDA,
        USDC,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
