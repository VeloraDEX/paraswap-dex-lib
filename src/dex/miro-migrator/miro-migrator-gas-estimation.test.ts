/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';
import { BI_POWS } from '../../bigint-constants';

describe('MiroMigrator Gas Estimation', () => {
  const dexKey = 'MiroMigrator';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const PSP = Tokens[network]['PSP'];
    const sePSP1 = Tokens[network]['sePSP1'];
    const VLR = Tokens[network]['VLR'];
    const amount = BI_POWS[18];

    describe('migratePSPtoVLR', () => {
      it('swapExactAmountIn', async () => {
        await testGasEstimation(
          network,
          PSP,
          VLR,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });

      it('swapExactAmountOut', async () => {
        await testGasEstimation(
          network,
          PSP,
          VLR,
          amount,
          SwapSide.BUY,
          dexKey,
          ContractMethodV6.swapExactAmountOut,
        );
      });
    });

    describe('migrateSePSP1toVLR', () => {
      it('swapExactAmountIn', async () => {
        await testGasEstimation(
          network,
          sePSP1,
          VLR,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });

      it('swapExactAmountOut', async () => {
        await testGasEstimation(
          network,
          sePSP1,
          VLR,
          amount,
          SwapSide.BUY,
          dexKey,
          ContractMethodV6.swapExactAmountOut,
        );
      });
    });
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const PSP = Tokens[network]['PSP'];
    const sePSP1 = Tokens[network]['sePSP1'];
    const VLR = Tokens[network]['VLR'];
    const amount = BI_POWS[18];

    describe('migratePSPtoVLR', () => {
      it('swapExactAmountIn', async () => {
        await testGasEstimation(
          network,
          PSP,
          VLR,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });

      it('swapExactAmountOut', async () => {
        await testGasEstimation(
          network,
          PSP,
          VLR,
          amount,
          SwapSide.BUY,
          dexKey,
          ContractMethodV6.swapExactAmountOut,
        );
      });
    });

    describe('migrateSePSP1toVLR', () => {
      it('swapExactAmountIn', async () => {
        await testGasEstimation(
          network,
          sePSP1,
          VLR,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });

      it('swapExactAmountOut', async () => {
        await testGasEstimation(
          network,
          sePSP1,
          VLR,
          amount,
          SwapSide.BUY,
          dexKey,
          ContractMethodV6.swapExactAmountOut,
        );
      });
    });
  });
});
