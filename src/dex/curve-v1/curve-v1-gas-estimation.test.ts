/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('CurveV1 Gas Estimation', () => {
  const dexKey = 'CurveV1';
  const network = Network.MAINNET;

  describe('swapExactAmountInOnCurveV1', () => {
    const USDT = Tokens[network]['USDT'];
    const USDC = Tokens[network]['USDC'];
    const amount = 100000000n; // 100 usdt

    it('exchange_underlying', async () => {
      await testGasEstimation(
        network,
        USDT,
        USDC,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountInOnCurveV1,
      );
    });
  });
});
