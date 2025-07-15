/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('CurveV2 Gas Estimation', () => {
  const dexKey = 'CurveV2';
  const network = Network.MAINNET;

  describe('swapExactAmountInOnCurveV2', () => {
    const USDC = Tokens[network]['USDC'];
    const USDT = Tokens[network]['USDT'];
    const amount = 1000000n; // 1 usdc

    it('exchange_underlying', async () => {
      await testGasEstimation(
        network,
        USDC,
        USDT,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountInOnCurveV2,
      );
    });
  });
});
