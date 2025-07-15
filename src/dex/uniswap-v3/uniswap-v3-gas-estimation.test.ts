/* eslint-disable no-console */
import dotenv from 'dotenv';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Tokens } from '../../../tests/constants-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';
import { ethers } from 'ethers';

dotenv.config();

describe('UniswapV3 Gas Estimation', () => {
  const dexKey = 'UniswapV3';
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const ETH = tokens['ETH'];
  const WETH = tokens['WETH'];
  const USDT = tokens['USDT'];
  const USDC = tokens['USDC'];
  const WBTC = tokens['WBTC'];
  const amount = 100000000n; // 100 usdt

  const methods: ContractMethodV6[] = [
    ContractMethodV6.swapExactAmountInOnUniswapV3,
    ContractMethodV6.swapExactAmountIn,
  ];

  methods.forEach(async method => {
    describe(method, () => {
      it('one swap', async () => {
        await testGasEstimation(
          network,
          USDT,
          USDC,
          amount,
          SwapSide.SELL,
          dexKey,
          method,
        );
      });

      it('one swap with unwrap', async () => {
        await testGasEstimation(
          network,
          USDT,
          ETH,
          amount,
          SwapSide.SELL,
          dexKey,
          method,
        );
      });

      it('one swap with wrap', async () => {
        const oneEth = ethers.utils.parseEther('1').toBigInt();

        await testGasEstimation(
          network,
          ETH,
          USDT,
          oneEth,
          SwapSide.SELL,
          dexKey,
          method,
        );
      });

      it('two swaps', async () => {
        const route = [USDT.address, WETH.address, USDC.address];

        await testGasEstimation(
          network,
          USDT,
          USDC,
          amount,
          SwapSide.SELL,
          dexKey,
          method,
          route,
        );
      });

      it('three swaps', async () => {
        const route = [USDT.address, WETH.address, WBTC.address, USDC.address];

        await testGasEstimation(
          network,
          USDT,
          USDC,
          amount,
          SwapSide.SELL,
          dexKey,
          method,
          route,
        );
      });
    });
  });
});
