/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('AaveV2 Gas Estimation', () => {
  const dexKey = 'AaveV2';
  const network = Network.MAINNET;

  it('swapExactAmountIn', async () => {
    const srcToken = Tokens[network]['WETH'];
    const destToken = Tokens[network]['AWETH'];

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
