/* eslint-disable no-console */
import dotenv from 'dotenv';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

dotenv.config();

describe('MakerPsm Gas Estimation', () => {
  const dexKey = 'MakerPsm';
  const network = Network.MAINNET;
  const srcToken = Tokens[network]['USDC'];
  const destToken = Tokens[network]['DAI'];
  const methods: ContractMethodV6[] = [
    ContractMethodV6.swapExactAmountInOutOnMakerPSM,
    ContractMethodV6.swapExactAmountIn,
  ];
  const amount = 10000000n;

  methods.forEach(async method => {
    it(method, async () => {
      await testGasEstimation(
        network,
        srcToken,
        destToken,
        amount,
        SwapSide.SELL,
        dexKey,
        method,
      );
    });
  });
});
