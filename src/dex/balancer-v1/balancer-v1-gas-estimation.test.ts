/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('BalancerV1 Gas Estimation', () => {
  const dexKey = 'BalancerV1';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const USDC = Tokens[network]['USDC'];
    const WBTC = Tokens[network]['WBTC'];
    const amount = 3333000000n;

    it('batchSwapExactIn', async () => {
      await testGasEstimation(
        network,
        USDC,
        WBTC,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
