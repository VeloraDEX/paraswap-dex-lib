/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Usual Gas Estimation', () => {
  const network = Network.MAINNET;

  describe('UsualBond', () => {
    const dexKey = 'UsualBond';

    describe('swapExactAmountIn', () => {
      const USD0 = Tokens[network]['USD0'];
      const USD0pp = Tokens[network]['USD0++'];
      const amount = 100000n;

      it('mint', async () => {
        await testGasEstimation(
          network,
          USD0,
          USD0pp,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });
    });
  });

  describe('UsualMUsd0', () => {
    const dexKey = 'UsualMUsd0';

    describe('swapExactAmountIn', () => {
      const UsualM = Tokens[network]['UsualM'];
      const USD0 = Tokens[network]['USD0'];
      const amount = 100000n;

      it('swap', async () => {
        await testGasEstimation(
          network,
          UsualM,
          USD0,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });
    });
  });

  describe('UsualUSDCUsd0', () => {
    const dexKey = 'UsualUSDCUsd0';

    describe('swapExactAmountIn', () => {
      const UsualUSDC = Tokens[network]['UsualUSDC'];
      const USD0 = Tokens[network]['USD0'];
      const amount = 100000n;

      it('swap', async () => {
        await testGasEstimation(
          network,
          UsualUSDC,
          USD0,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });
    });
  });
});
