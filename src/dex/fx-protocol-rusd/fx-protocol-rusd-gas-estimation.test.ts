/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('FxProtocolRusd Gas Estimation', () => {
  const dexKey = 'FxProtocolRusd';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const weETH = Tokens[network]['weETH'];
    const rUSD = Tokens[network]['rUSD'];
    const amount = 1000000000000000000n;

    it('mint', async () => {
      await testGasEstimation(
        network,
        weETH,
        rUSD,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
