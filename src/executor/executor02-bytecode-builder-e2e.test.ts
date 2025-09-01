import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../tests/utils-e2e';
import { Holders, Tokens } from '../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../config';

jest.setTimeout(120000);

describe('Executor02ByteCodeBuilder e2e tests', () => {
  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokens = Tokens[network];
    const holders = Holders[network];
    const slippage = undefined;

    describe('SimpleSwap', () => {
      const contractMethod = ContractMethod.simpleSwap;

      describe('stUSD -> USDA via Angle Staked Stable USD', () => {
        const dexKeys = ['AngleStakedStableUSD'];

        const tokenASymbol: string = 'stUSD';
        const tokenBSymbol: string = 'USDA';
        const tokenAAmount: string = '60000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            200,
            2000,
          );
        });
      });

      describe('ETH -> SUSHI via SushiSwapV3 and UniswapV3', () => {
        const dexKeys = ['SushiSwapV3', 'UniswapV3'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'SUSHI';
        const tokenAAmount: string = '60000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            200,
            2000,
          );
        });
      });

      describe('SUSHI -> ETH via SushiSwapV3 and UniswapV3', () => {
        const dexKeys = ['SushiSwapV3', 'UniswapV3'];

        const tokenASymbol: string = 'SUSHI';
        const tokenBSymbol: string = 'ETH';
        const tokenAAmount: string = '3000000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('ETH -> USDC via SushiSwapV3 and BalancerV1', () => {
        const dexKeys = ['SushiSwapV3', 'BalancerV1'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '10000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('USDC -> ETH via SushiSwapV3 and BalancerV1', () => {
        const dexKeys = ['SushiSwapV3', 'BalancerV1'];

        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'ETH';
        const tokenAAmount: string = '20000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('USDT -> USDC via UniswapV3 and CurveV1', () => {
        const dexKeys = ['UniSwapV3', 'CurveV1'];

        const tokenASymbol: string = 'USDT';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '1100000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('ETH -> USDC via BalancerV2 and MaverickV1', () => {
        const dexKeys = ['MaverickV1', 'BalancerV2'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '3000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('ETH -> stETH via Lido, CurveV1, CurveV1Factory, UniswapV3, Solidly, BalancerV2, wstETH', () => {
        const dexKeys = [
          'Lido',
          'CurveV1',
          'CurveV1Factory',
          'UniswapV3',
          'Solidly',
          'BalancerV2',
          'wstETH',
        ];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'STETH';
        const tokenAAmount: string = '10000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });
    });

    describe('MultiSwap', () => {
      const contractMethod = ContractMethod.multiSwap;

      describe('WBTC -> ETH -> BAL via BalancerV2 and BalancerV1', () => {
        const dexKeys = ['BalancerV1', 'BalancerV2'];

        const tokenASymbol: string = 'WBTC';
        const tokenBSymbol: string = 'BAL';
        const tokenAAmount: string = '1000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
            false,
            [
              '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
              '0xba100000625a3754423978a60c9317c58a424e3d', // BAL
            ],
          );
        });
      });

      describe('WBTC -> ETH -> SUSHI via SushiSwapV3 and UniswapV3', () => {
        const dexKeys = ['SushiSwapV3', 'UniswapV3'];

        const tokenASymbol: string = 'WBTC';
        const tokenBSymbol: string = 'SUSHI';
        const tokenAAmount: string = '200000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
            [
              '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
              '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
            ],
          );
        });
      });

      describe('SUSHI -> ETH -> WBTC via SushiSwapV3 and UniswapV3', () => {
        const dexKeys = ['SushiSwapV3', 'UniswapV3'];

        const tokenASymbol: string = 'SUSHI';
        const tokenBSymbol: string = 'WBTC';
        const tokenAAmount: string = '100000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
            false,
            [
              '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
              '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
            ],
          );
        });
      });

      describe('BAL -> ETH -> SUSHI via BalancerV1,SushiSwapV3 and UniswapV3', () => {
        const dexKeys = ['SushiSwapV3', 'UniswapV3', 'BalancerV1'];

        const tokenASymbol: string = 'BAL';
        const tokenBSymbol: string = 'SUSHI';
        const tokenAAmount: string = '10000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
            [
              '0xba100000625a3754423978a60c9317c58a424e3D', // BAL
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
              '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
            ],
          );
        });
      });

      describe('ETH -> USDC -> MAV via MaverickV1,SushiSwapV3 and UniswapV3', () => {
        const dexKeys = ['SushiSwapV3', 'UniswapV3', 'MaverickV1'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'MAV';
        const tokenAAmount: string = '100000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
            false,
            [
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
              '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
              '0x7448c7456a97769f6cd04f1e83a4a23ccdc46abd', // MAV
            ],
          );
        });
      });

      describe('USDT -> DAI -> ETH via UniswapV3 on each path', () => {
        const dexKeys = ['UniswapV3'];

        const tokenASymbol: string = 'USDT';
        const tokenBSymbol: string = 'ETH';
        const tokenAAmount: string = '100000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
            [
              '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
              '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
            ],
          );
        });
      });

      describe('DAI -> USDC -> ETH via UniswapV3 and CurveV1', () => {
        const dexKeys = ['UniswapV3', 'CurveV1'];

        const tokenASymbol: string = 'DAI';
        const tokenBSymbol: string = 'ETH';
        const tokenAAmount: string = '30000000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
            [
              '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
              '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
            ],
          );
        });
      });

      describe('DAI -> WETH -> eETH via UniswapV2, UniswapV3 and EtherFi', () => {
        const dexKeys = ['UniswapV2', 'UniswapV3', 'EtherFi'];

        const tokenASymbol: string = 'DAI';
        const tokenBSymbol: string = 'eETH';
        const tokenAAmount: string = `${1e18}00000`;

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
            false,
            [
              '0x6B175474E89094C44Da98b954EedeAC495271d0F',
              '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
              '0x35fa164735182de50811e8e2e824cfb9b6118ac2',
            ],
          );
        });
      });
    });

    describe('MegaSwap', () => {
      const contractMethod = ContractMethod.megaSwap;

      describe('WBTC -> USDC via UniswapV3', () => {
        const dexKeys = ['UniswapV3'];

        const tokenASymbol: string = 'WBTC';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '2500000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('USDC -> ETH via UniswapV3', () => {
        const dexKeys = ['UniswapV3'];

        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'ETH';
        const tokenAAmount: string = '10000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
          );
        });
      });

      describe('ETH -> USDC via UniswapV3', () => {
        const dexKeys = ['UniswapV3'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '10000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });

      describe('DAI -> ETH via UniswapV3', () => {
        const dexKeys = ['UniswapV3'];

        const tokenASymbol: string = 'DAI';
        const tokenBSymbol: string = 'ETH';
        const tokenAAmount: string = '10000000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
          );
        });
      });

      describe('ETH -> USDC via BalancerV2 and UniswapV3', () => {
        const dexKeys = ['UniswapV3', 'BalancerV2'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '10000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            500,
            2000,
          );
        });
      });

      describe('WBTC -> DAI via UniswapV3', () => {
        const dexKeys = ['UniswapV3'];

        const tokenASymbol: string = 'WBTC';
        const tokenBSymbol: string = 'DAI';
        const tokenAAmount: string = '100000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            undefined,
            2000,
          );
        });
      });

      describe('ETH -> DAI via BalancerV2 and MaverickV1', () => {
        const dexKeys = ['BalancerV2', 'MaverickV1'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'DAI';
        const tokenAAmount: string = '20000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      describe('ETH -> USDT via MaverickV1 and BalancerV2', () => {
        const dexKeys = ['BalancerV2', 'MaverickV1'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'USDT';
        const tokenAAmount: string = '50000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      // describe('DAI -> ETH via SushiSwapV3,BalancerV1, BalancerV2 and CurveV1 ', () => {
      //   const dexKeys = ['SushiSwapV3', 'BalancerV1', 'BalancerV2', 'CurveV1'];
      //
      //   const tokenASymbol: string = 'DAI';
      //   const tokenBSymbol: string = 'ETH';
      //   const tokenAAmount: string = '900000000000000000000000';
      //
      //   const side = SwapSide.SELL;
      //
      //   it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
      //     await testE2E(
      //       tokens[tokenASymbol],
      //       tokens[tokenBSymbol],
      //       holders[tokenASymbol],
      //       tokenAAmount,
      //       side,
      //       dexKeys,
      //       contractMethod,
      //       network,
      //       provider,
      //       undefined,
      //       undefined,
      //       undefined,
      //       300,
      //       2000,
      //       false,
      //     );
      //   });
      // });

      describe('WBTC -> USDT via UniSwapV3 and CurveV1', () => {
        const dexKeys = ['UniSwapV3', 'CurveV1'];

        const tokenASymbol: string = 'WBTC';
        const tokenBSymbol: string = 'USDT';
        const tokenAAmount: string = '100000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      describe('ETH -> WBTC via SushiSwapV3 and BalancerV1', () => {
        const dexKeys = ['SushiSwapV3', 'BalancerV1'];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'WBTC';
        const tokenAAmount: string = '1000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      describe('USDC -> WBTC via BalancerV1', () => {
        const dexKeys = ['BalancerV1'];

        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'WBTC';
        const tokenAAmount: string = '3333000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      // describe('USDC -> USDT via CurveV1, CurveV2, UniSwapV3 and PancakeSwapV3', () => {
      //   const dexKeys = ['CurveV1', 'CurveV2', 'UniSwapV3', 'PancakeSwapV3'];
      //
      //   const tokenASymbol: string = 'USDC';
      //   const tokenBSymbol: string = 'USDT';
      //   const tokenAAmount: string = '100000000000000';
      //
      //   const side = SwapSide.SELL;
      //
      //   it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
      //     await testE2E(
      //       tokens[tokenASymbol],
      //       tokens[tokenBSymbol],
      //       holders[tokenASymbol],
      //       tokenAAmount,
      //       side,
      //       dexKeys,
      //       contractMethod,
      //       network,
      //       provider,
      //       undefined,
      //       undefined,
      //       undefined,
      //       300,
      //       2000,
      //       false,
      //     );
      //   });
      // });
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokens = Tokens[network];
    const holders = Holders[network];
    const slippage = undefined;

    describe('MegaSwap', () => {
      const contractMethod = ContractMethod.megaSwap;

      describe('ETH -> DAI', () => {
        const dexKeys = [
          'UniswapV3',
          'GMX',
          'TraderJoeV2.1',
          'RamsesV2',
          'CamelotV3',
          'WooFiV2',
          'BalancerV2',
        ];

        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'DAI';
        const tokenAAmount: string = '1000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            slippage,
            2000,
          );
        });
      });
    });
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokens = Tokens[network];
    const holders = Holders[network];
    const slippage = undefined;

    describe('MegaSwap', () => {
      const contractMethod = ContractMethod.megaSwap;

      describe('WAVAX -> USDC', () => {
        const dexKeys = [
          'TraderJoeV2.1',
          'PangolinSwap',
          'TraderJoe',
          'UniswapV3',
          'GMX',
          'Wombat',
        ];

        const tokenASymbol: string = 'WAVAX';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '100000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
          );
        });
      });
    });
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokens = Tokens[network];
    const holders = Holders[network];

    describe('MultiSwap', () => {
      const contractMethod = ContractMethod.multiSwap;

      describe('WMATIC -> MATIC', () => {
        const dexKeys = ['UniswapV3', 'Dfyn', 'BalancerV2'];

        const tokenASymbol: string = 'WMATIC';
        const tokenBSymbol: string = 'MATIC';
        const tokenAAmount: string = '23474666934083667923';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            undefined,
            2000,
            false,
          );
        });
      });

      describe('AAVE -> MATIC -> PSP', () => {
        const dexKeys = ['QuickSwapV3', 'QuickSwap', 'UniSwapV3'];

        const tokenASymbol: string = 'AAVE';
        const tokenBSymbol: string = 'PSP';
        const tokenAAmount: string = '2957716008182474017';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
            [
              '0xd6df932a45c0f255f85145f286ea0b292b21c90b', // AAVE
              '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // MATIC
              '0x42d61d766b85431666b39b89c43011f24451bff6', // PSP
            ],
          );
        });
      });

      describe('USDC.e -> stMatic', () => {
        const dexKeys = ['DODOV2', 'UniswapV3', 'BalancerV2'];

        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'stMATIC';
        const tokenAAmount: string = '4134000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
            [
              '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC.e
              '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // MATIC
              '0x3a58a54c066fdc0f2d55fc9c89f0415c92ebf3c4', // stMATIC
            ],
          );
        });
      });
    });

    describe('MegaSwap', () => {
      const contractMethod = ContractMethod.megaSwap;

      describe('MATIC -> USDC.e', () => {
        const dexKeys = [
          'DodoV2',
          'UniswapV3',
          'Retro',
          'QuickSwapV3',
          'WoofiV2',
        ];

        const tokenASymbol: string = 'MATIC';
        const tokenBSymbol: string = 'USDC';
        const tokenAAmount: string = '1000000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
          );
        });
      });

      describe('WBTC -> DAI', () => {
        const dexKeys = [
          'CurveV2',
          'DODOV2',
          'UniswapV3',
          'QuickSwapV3',
          'IronV2',
          'Synapse',
        ];

        const tokenASymbol: string = 'WBTC';
        const tokenBSymbol: string = 'DAI';
        const tokenAAmount: string = '1000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      describe('MATIC -> SUSHI', () => {
        const dexKeys = ['Dfyn', 'SushiSwapV3'];

        const tokenASymbol: string = 'MATIC';
        const tokenBSymbol: string = 'SUSHI';
        const tokenAAmount: string = '1000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });

      describe('MATIC -> BAL', () => {
        const dexKeys = ['Dfyn', 'BalancerV2'];

        const tokenASymbol: string = 'MATIC';
        const tokenBSymbol: string = 'BAL';
        const tokenAAmount: string = '1000000000000000000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
          );
        });
      });

      describe('USDT -> TEL', () => {
        const dexKeys = ['QuickSwapV3', 'QuickSwap', 'BalancerV2', 'UniswapV3'];

        const tokenASymbol: string = 'USDT';
        const tokenBSymbol: string = 'TEL';
        const tokenAAmount: string = '10900000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
          );
        });
      });

      describe('USDCe -> MATIC', () => {
        const dexKeys = ['CurveV2', 'UniswapV3', 'SushiSwapV3', 'SwaapV2'];

        const tokenASymbol: string = 'USDCe';
        const tokenBSymbol: string = 'MATIC';
        const tokenAAmount: string = '1978798814';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            100,
            2000,
            false,
          );
        });
      });
    });
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokens = Tokens[network];
    const holders = Holders[network];

    describe('MegaSwap', () => {
      const contractMethod = ContractMethod.megaSwap;

      describe('USDC -> GRAIN', () => {
        const dexKeys = ['UniswapV3', 'VelodromeV2', 'BeetsFi', 'Velodrome'];

        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'GRAIN';
        const tokenAAmount: string = '3538000000';

        const side = SwapSide.SELL;

        it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
          await testE2E(
            tokens[tokenASymbol],
            tokens[tokenBSymbol],
            holders[tokenASymbol],
            tokenAAmount,
            side,
            dexKeys,
            contractMethod,
            network,
            provider,
            undefined,
            undefined,
            undefined,
            300,
            2000,
            false,
          );
        });
      });
    });
  });
});
