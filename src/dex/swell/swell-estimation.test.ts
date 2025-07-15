/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Swell Gas Estimation', () => {
  const dexKey = 'Swell';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const ETH = Tokens[network]['ETH'];
    const SWETH = Tokens[network]['SWETH'];
    const amount = 45410357n;

    it('deposit', async () => {
      await testGasEstimation(
        network,
        ETH,
        SWETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
