import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { UniswapV2FunctionsV6 } from './types';

describe('UniswapV2 E2E Mainnet', () => {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  describe('UniswapV2', () => {
    const dexKey = 'UniswapV2';

    describe('UniswapV2 Simpleswap', () => {
      it('USDC -> USDT', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '1000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('ETH -> USDC', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('USDC -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('WBTC -> USDT', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.USDT,
          holders.WBTC,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('UniswapV2_special', () => {
      describe('SELL_V6', () => {
        it('EX1: USDC -> USDT', async () => {
          await testE2E(
            tokens.USDC,
            tokens.USDT,
            holders.USDC,
            '1000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('EX1: ETH -> USDC', async () => {
          await testE2E(
            tokens.ETH,
            tokens.USDC,
            holders.ETH,
            '700000000000000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('EX1: USDC -> ETH', async () => {
          await testE2E(
            tokens.USDC,
            tokens.ETH,
            holders.USDC,
            '2000000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('EX1: WBTC -> USDT', async () => {
          await testE2E(
            tokens.WBTC,
            tokens.USDT,
            holders.WBTC,
            '20000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.swapExactAmountIn,
            network,
            provider,
          );
        });
        it('EX1: PSP -> WETH -> USDT', async () => {
          await testE2E(
            tokens.PSP,
            tokens.USDT,
            holders.PSP,
            '1000000000000000000',
            SwapSide.SELL,
            dexKey,
            ContractMethod.multiSwap,
            network,
            provider,
          );
        });
        // TODO: Update: goes through balancer only
        // it('EX2: USDT -> USDC', async () => {
        //   await testE2E(
        //     tokens.USDT,
        //     tokens.USDC,
        //     holders.USDT,
        //     '1000000000000',
        //     SwapSide.SELL,
        //     [dexKey, 'BalancerV2' /* , 'TraderJoeV2.1'  'SolidlyV3'*/],
        //     ContractMethod.multiSwap,
        //     network,
        //     provider,
        //   );
        // });
      });
      describe('BUY_V6', () => {
        it('EX3: USDC -> USDT', async () => {
          await testE2E(
            tokens.USDC,
            tokens.USDT,
            holders.USDC,
            '1000000',
            SwapSide.BUY,
            dexKey,
            ContractMethod.swapExactAmountOut,
            network,
            provider,
          );
        });
        it('EX3: ETH -> DAI', async () => {
          await testE2E(
            tokens.ETH,
            tokens.DAI,
            holders.ETH,
            '7000000000000000',
            SwapSide.BUY,
            dexKey,
            ContractMethod.swapExactAmountOut,
            network,
            provider,
          );
        });
        it('EX3: USDC -> ETH', async () => {
          await testE2E(
            tokens.USDC,
            tokens.ETH,
            holders.USDC,
            '2000000000',
            SwapSide.BUY,
            dexKey,
            ContractMethod.swapExactAmountOut,
            network,
            provider,
          );
        });
        it('EX3: WBTC -> USDT', async () => {
          await testE2E(
            tokens.WBTC,
            tokens.USDT,
            holders.WBTC,
            '20000000',
            SwapSide.BUY,
            dexKey,
            ContractMethod.swapExactAmountOut,
            network,
            provider,
          );
        });
        // it('EX3: PSP -> WETH -> USDT', async () => {
        //   await testE2E(
        //     tokens.PSP,
        //     tokens.USDT,
        //     holders.PSP,
        //     '1000000000000000000',
        //     SwapSide.BUY,
        //     dexKey,
        //     ContractMethod.multiSwap,
        //     network,
        //     provider,
        //   );
        // });
        // TODO: Update: goes through balancer only
        // it('EX2: USDT -> USDC', async () => {
        //   await testE2E(
        //     tokens.USDT,
        //     tokens.USDC,
        //     holders.USDT,
        //     '1000000000000',
        //     SwapSide.BUY,
        //     [dexKey, 'BalancerV2' /* , 'TraderJoeV2.1'  'SolidlyV3'*/],
        //     ContractMethod.multiSwap,
        //     network,
        //     provider,
        //   );
        // });
      });
    });

    describe('Multiswap', () => {
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.BADGER,
          tokens.ETH,
          holders.BADGER,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('swapOnUniswap', () => {
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswap,
          network,
          provider,
        );
      });
      it('TOKEN[BADGER] -> ETH', async () => {
        await testE2E(
          tokens.BADGER,
          tokens.ETH,
          holders.BADGER,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswap,
          network,
          provider,
        );
      });
      it('TOKEN[USDC] -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswap,
          network,
          provider,
        );
      });
    });

    describe('swapOnUniswapFork', () => {
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.BADGER,
          tokens.ETH,
          holders.BADGER,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
    });

    describe('swapOnUniswapV2Fork', () => {
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapV2Fork,
          network,
          provider,
        );
      });
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.BADGER,
          tokens.ETH,
          holders.BADGER,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapV2Fork,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapV2Fork,
          network,
          provider,
        );
      });
    });

    describe('buyOnUniswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '700000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN[BADGER]', async () => {
        await testE2E(
          tokens.ETH,
          tokens.BADGER,
          holders.ETH,
          '700000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswap,
          network,
          provider,
        );
      });
      it('TOKEN[USDC] -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswap,
          network,
          provider,
        );
      });

      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswap,
          network,
          provider,
        );
      });
    });

    describe('buyOnUniswapFork', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '700000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapFork,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN[BADGER]', async () => {
        await testE2E(
          tokens.ETH,
          tokens.BADGER,
          holders.ETH,
          '700000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapFork,
          network,
          provider,
        );
      });
      it('TOKEN[USDC] -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapFork,
          network,
          provider,
        );
      });

      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapFork,
          network,
          provider,
        );
      });
    });

    describe('buyOnUniswapV2Fork', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '700000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapV2Fork,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN[BADGER]', async () => {
        await testE2E(
          tokens.ETH,
          tokens.BADGER,
          holders.ETH,
          '700000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapV2Fork,
          network,
          provider,
        );
      });
      it('TOKEN[USDC] -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapV2Fork,
          network,
          provider,
        );
      });

      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapV2Fork,
          network,
          provider,
        );
      });
    });

    describe('simpleBuy', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '700000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN[BADGER]', async () => {
        await testE2E(
          tokens.ETH,
          tokens.BADGER,
          holders.ETH,
          '700000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('TOKEN[USDC] -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '20000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });

    describe('BuyMethod', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '700000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN[BADGER]', async () => {
        await testE2E(
          tokens.ETH,
          tokens.BADGER,
          holders.ETH,
          '700000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
      it('TOKEN[USDC] -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '20000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
    });

    describe('STETH->ETH', () => {
      it('simpleSwap', async () => {
        await testE2E(
          tokens.STETH,
          tokens.ETH,
          holders.STETH,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('multiSwap', async () => {
        await testE2E(
          tokens.STETH,
          tokens.ETH,
          holders.STETH,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('megaSwap', async () => {
        await testE2E(
          tokens.STETH,
          tokens.ETH,
          holders.STETH,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });

    describe('V6_swapExactAmountInOnUniswapV2', () => {
      it('WETH -> WBTC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.WBTC,
          holders.WETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('WETH (amountIn=1000000000000) -> WBTC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.WBTC,
          holders.WETH,
          '1000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> WETH', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.WETH,
          holders.WBTC,
          '100000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('ETH -> WBTC', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> ETH', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.ETH,
          holders.WBTC,
          '100000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('USDC -> WBTC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> USDC', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.USDC,
          holders.WBTC,
          '100000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '100000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
      it('USDC -> USDT', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '100000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountInOnUniswapV2,
          network,
          provider,
        );
      });
    });

    describe('V6_swapExactAmountOutOnUniswapV2', () => {
      it('WETH -> WBTC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.WBTC,
          holders.WETH,
          '1000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> WETH', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.WETH,
          holders.WBTC,
          '7000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> WETH (amountOut=1000000)', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.WETH,
          holders.WBTC,
          '7000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('ETH -> WBTC', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '1000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> ETH ', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.ETH,
          holders.WBTC,
          '7000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('USDC -> WBTC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '20000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('WBTC -> USDC', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.USDC,
          holders.WBTC,
          '1000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
      it('USDC -> USDT', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '1000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOutOnUniswapV2,
          network,
          provider,
        );
      });
    });
  });

  describe('SushiSwap', () => {
    const dexKey = 'SushiSwap';

    describe('Simpleswap', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.BADGER,
          holders.WBTC,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('MultiSwap', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.BADGER,
          tokens.ETH,
          holders.BADGER,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.WBTC,
          holders.USDT,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('swapOnUniswapFork', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.BADGER,
          tokens.ETH,
          holders.BADGER,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.WBTC,
          holders.USDT,
          '2000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
    });
    describe('swapOnUniswapV2Fork', () => {
      it('SAITAMA -> ETH', async () => {
        await testE2E(
          tokens.SAITAMA,
          tokens.ETH,
          holders.SAITAMA,
          '11111111111000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapV2Fork,
          network,
          provider,
        );
      });
      it('ETH -> SAITAMA', async () => {
        await testE2E(
          tokens.ETH,
          tokens.SAITAMA,
          holders.ETH,
          '11111111111000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapV2Fork,
          network,
          provider,
        );
      });
    });
    describe('buyOnUniswapV2Fork', () => {
      it('SAITAMA -> ETH', async () => {
        await testE2E(
          tokens.SAITAMA,
          tokens.ETH,
          holders.SAITAMA,
          '60000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapV2Fork,
          network,
          provider,
        );
      });
      it('ETH -> SAITAMA', async () => {
        await testE2E(
          tokens.ETH,
          tokens.SAITAMA,
          holders.ETH,
          '11111111111000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buyOnUniswapV2Fork,
          network,
          provider,
        );
      });
    });
  });

  describe('DefiSwap', () => {
    const dexKey = 'DefiSwap';

    describe('Simpleswap', () => {
      it('DefiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('DefiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDC,
          tokens.ETH,
          holders.USDC,
          '2000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('DefiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WBTC,
          tokens.renBTC,
          holders.WBTC,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('DefiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('DefiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.LINK,
          tokens.ETH,
          holders.LINK,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('DefiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('swapOnUniswapFork', () => {
      it('DefiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.WBTC,
          holders.ETH,
          '7000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
      it('DefiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.LINK,
          tokens.ETH,
          holders.LINK,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
      it('DefiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.WBTC,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapOnUniswapFork,
          network,
          provider,
        );
      });
    });
  });

  describe('Verse', () => {
    const dexKey = 'Verse';

    describe('Simpleswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '2000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '1000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WETH,
          tokens.USDT,
          holders.WETH,
          '100000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '1000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '50000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('Megaswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '1000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '50000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('ShibaSwap', () => {
    const dexKey = 'ShibaSwap';

    describe('Simpleswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WETH,
          tokens.USDT,
          holders.WETH,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('MultiSwap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '10000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('SimpleBuy', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '10000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '20000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '2000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });
    describe('MegaSwap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '10000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.USDT,
          holders.USDC,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('PancakeSwapV2', () => {
    const dexKey = 'PancakeSwapV2';

    describe('Simpleswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '500000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.STG,
          holders.USDC,
          '50000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('SimpleBuy', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '2000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '1000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.STG,
          holders.USDC,
          '100000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '500000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.STG,
          holders.USDC,
          '1000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('MegaPath', () => {
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens.USDT,
          tokens.ETH,
          holders.USDT,
          '200000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDT,
          holders.ETH,
          '500000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.USDC,
          tokens.STG,
          holders.USDC,
          '1000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe(`Swapsicle`, () => {
    const dexKey = 'Swapsicle';

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.simpleSwap,
          ContractMethod.multiSwap,
          ContractMethod.megaSwap,
        ],
      ],
      [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
    ]);

    const pairs: { name: string; sellAmount: string; buyAmount: string }[][] = [
      [
        { name: 'USDC', sellAmount: '7000', buyAmount: '10000' },
        { name: 'WETH', sellAmount: '1000000000000000000', buyAmount: '4000' },
      ],
    ];

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          pairs.forEach(pair => {
            describe(`${contractMethod}`, () => {
              it(`${pair[0].name} -> ${pair[1].name}`, async () => {
                await testE2E(
                  tokens[pair[0].name],
                  tokens[pair[1].name],
                  holders[pair[0].name],
                  side === SwapSide.SELL
                    ? pair[0].sellAmount
                    : pair[0].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
              it(`${pair[1].name} -> ${pair[0].name}`, async () => {
                await testE2E(
                  tokens[pair[1].name],
                  tokens[pair[0].name],
                  holders[pair[1].name],
                  side === SwapSide.SELL
                    ? pair[1].sellAmount
                    : pair[1].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
            });
          });
        });
      }),
    );
  });

  describe(`RingV2`, () => {
    const dexKey = 'RingV2';

    const sideToContractMethods = new Map([
      [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
      [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
    ]);

    const getOneUnit = (tokenSymbol: string): string => {
      const decimalsMap: Record<string, number> = {
        ETH: 18,
        DAI: 18,
        WBTC: 8,
        USDC: 6,
      };
      return '1' + '0'.repeat(decimalsMap[tokenSymbol]);
    };

    const pairs = [
      { from: 'USDC', to: 'ETH' },
      { from: 'WBTC', to: 'DAI' },
    ];

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          pairs.forEach(({ from, to }) => {
            describe(`${contractMethod}`, () => {
              it(`${from} -> ${to}`, async () => {
                await testE2E(
                  tokens[from],
                  tokens[to],
                  holders[from],
                  side === SwapSide.SELL ? getOneUnit(from) : getOneUnit(to),
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
              it(`${to} -> ${from}`, async () => {
                await testE2E(
                  tokens[to],
                  tokens[from],
                  holders[to],
                  side === SwapSide.SELL ? getOneUnit(to) : getOneUnit(from),
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
            });
          });
        });
      }),
    );
  });
});
