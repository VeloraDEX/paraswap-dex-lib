/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';

describe('Kelp Gas Estimation', () => {
  const dexKey = 'Kelp';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const srcTokens = [
      Tokens[network]['ETH'],
      Tokens[network]['WETH'],
      Tokens[network]['STETH'],
      Tokens[network]['wstETH'],
      Tokens[network]['ETHx'],
    ];
    const destToken = Tokens[network]['rsETH'];
    const testAmount = 1000000000000000000n;

    srcTokens.forEach(srcToken => {
      const testName =
        srcToken.symbol === 'ETH' || srcToken.symbol === 'WETH'
          ? 'depositETH'
          : 'depositAsset';

      it(`${testName}`, async () => {
        await testGasEstimation(
          network,
          srcToken,
          destToken,
          testAmount,
          SwapSide.SELL,
          dexKey,
          ContractMethodV6.swapExactAmountIn,
        );
      });
    });
  });
});
