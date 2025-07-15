/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Lido Gas Estimation', () => {
  const dexKey = 'Lido';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const STETH = Tokens[network]['STETH'];
    const ETH = Tokens[network]['ETH'];
    const amount = 100000000000000000000n;

    it('submit', async () => {
      await testGasEstimation(
        network,
        ETH,
        STETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
