/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Stader Gas Estimation', () => {
  const dexKey = 'Stader';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const ETH = Tokens[network]['ETH'];
    const ETHx = Tokens[network]['ETHx'];
    const amount = 1000000000000000000n;

    it('deposit', async () => {
      await testGasEstimation(
        network,
        ETH,
        ETHx,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
