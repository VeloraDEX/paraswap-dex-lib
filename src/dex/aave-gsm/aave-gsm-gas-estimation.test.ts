/* eslint-disable no-console */
import dotenv from 'dotenv';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

dotenv.config();

describe('AaveGsm Gas Estimation', () => {
  const dexKey = 'AaveGsm';
  const network = Network.MAINNET;

  it('swapExactAmountIn', async () => {
    const srcToken = Tokens[network]['GHO'];
    const destToken = Tokens[network]['waEthUSDT'];

    const amount = 1000000000000000000n;

    await testGasEstimation(
      network,
      srcToken,
      destToken,
      amount,
      SwapSide.SELL,
      dexKey,
      ContractMethodV6.swapExactAmountIn,
    );
  });
});
