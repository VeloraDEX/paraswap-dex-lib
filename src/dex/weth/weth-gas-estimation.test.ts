/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';
import { ethers } from 'ethers';

describe('Weth Gas Estimation', () => {
  const dexKey = 'Weth';
  const network = Network.MAINNET;

  describe('swapExactAmountIn', () => {
    const ETH = Tokens[network]['ETH'];
    const WETH = Tokens[network]['WETH'];
    const amount = ethers.utils.parseEther('1').toBigInt();

    it('wrap', async () => {
      await testGasEstimation(
        network,
        ETH,
        WETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });

    it('unwrap', async () => {
      await testGasEstimation(
        network,
        WETH,
        ETH,
        amount,
        SwapSide.SELL,
        dexKey,
        ContractMethodV6.swapExactAmountIn,
      );
    });
  });
});
