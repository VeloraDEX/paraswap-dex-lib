/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('SkyConverter Gas Estimation', () => {
  const network = Network.MAINNET;

  describe('DaiUsds', () => {
    const dexKey = 'DaiUsds';

    describe('swapExactAmountIn', () => {
      const DAI = Tokens[network]['DAI'];
      const USDS = Tokens[network]['USDS'];
      const amount = 10000000000000000000n;

      it('daiToUsds', async () => {
        await testGasEstimation(
          network,
          DAI,
          USDS,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });

      it('usdsToDai', async () => {
        await testGasEstimation(
          network,
          USDS,
          DAI,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });
    });
  });

  describe('MkrSky', () => {
    const dexKey = 'MkrSky';

    describe('swapExactAmountIn', () => {
      const MKR = Tokens[network]['MKR'];
      const SKY = Tokens[network]['SKY'];
      const amount = 10000000000000000000n;

      it('mkrToSky', async () => {
        await testGasEstimation(
          network,
          MKR,
          SKY,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });

      it('skyToMkr', async () => {
        await testGasEstimation(
          network,
          SKY,
          MKR,
          amount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });
    });
  });
});
