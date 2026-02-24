import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('UniswapV2 E2E Gnosis', () => {
  const network = Network.GNOSIS;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  describe('SushiSwap', () => {
    const dexKey = 'SushiSwap';

    describe('swapExactAmountIn', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.XDAI,
          tokens.USDC,
          holders.XDAI,
          '700000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.WETH,
          tokens.XDAI,
          holders.WETH,
          '700000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WETH,
          tokens.USDC,
          holders.WETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
    });

    describe('swapExactAmountOut', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.XDAI,
          tokens.USDC,
          holders.XDAI,
          '700000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.XDAI,
          holders.USDC,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WETH,
          holders.USDC,
          '7000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
    });
  });

  describe('HoneySwap', () => {
    const dexKey = 'HoneySwap';

    describe('swapExactAmountIn', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.XDAI,
          tokens.USDC,
          holders.XDAI,
          '700000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.WETH,
          tokens.XDAI,
          holders.WETH,
          '700000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WETH,
          tokens.USDC,
          holders.WETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
    });

    describe('swapExactAmountOut', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.XDAI,
          tokens.USDC,
          holders.XDAI,
          '700000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.XDAI,
          holders.USDC,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WETH,
          holders.USDC,
          '700000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
    });
  });
});
