import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Holders,
  NativeTokenSymbols,
  Tokens,
} from '../../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  slippage?: number | undefined,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network] ?? {};
  const nativeTokenSymbol = NativeTokenSymbols[network];

  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        // ContractMethod.simpleSwap,
        // ContractMethod.multiSwap,
        // ContractMethod.megaSwap,
        // ContractMethod.swapExactAmountInOnUniswapV3,
        ContractMethod.swapExactAmountIn,
      ],
    ],
    [
      SwapSide.BUY,
      [
        // ContractMethod.simpleBuy,
        // ContractMethod.buy,
        // ContractMethod.directUniV3Buy,
        // ContractMethod.swapExactAmountOutOnUniswapV3,
        ContractMethod.swapExactAmountOut,
      ],
    ],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            if (tokenASymbol !== 'WETH') {
              it(`${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
                await testE2E(
                  tokens[nativeTokenSymbol],
                  tokens[tokenASymbol],
                  holders[nativeTokenSymbol],
                  side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                  side,
                  dexKey,
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
              it(`${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
                await testE2E(
                  tokens[tokenASymbol],
                  tokens[nativeTokenSymbol],
                  holders[tokenASymbol],
                  side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                  side,
                  dexKey,
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
            }
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
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
            it(`${tokenBSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[tokenBSymbol],
                tokens[tokenASymbol],
                holders[tokenBSymbol],
                side === SwapSide.SELL ? tokenBAmount : tokenAAmount,
                side,
                dexKey,
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
      }),
    );
  });
}

describe('UniswapV3 E2E', () => {
  describe('UniswapV3', () => {
    const dexKey = 'UniswapV3';

    describe('UniswapV3 MAINNET', () => {
      const network = Network.MAINNET;

      const tokenBSymbol: string = 'USDT';
      const tokenASymbol: string = 'USDC';

      const tokenAAmount: string = '1111100000';
      const tokenBAmount: string = '1100000000';
      const nativeTokenAmount = '1100000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });

    describe('UniswapV3_V6', () => {
      const network = Network.MAINNET;

      const nativeTokenAmount = '1100000000000000000';

      const pairs = [
        {
          tokenA: 'USDT',
          tokenB: 'USDC',
          tokenAAmount: '1111100000',
          tokenBAmount: '1099999999',
          nativeTokenAmount,
        },
        {
          tokenA: 'WETH',
          tokenB: 'WBTC',
          tokenAAmount: '100000000000000000',
          tokenBAmount: '100000',
          nativeTokenAmount,
        },
        // // this pair includes 2 pools
        // {
        //   tokenA: 'LINK',
        //   tokenB: 'PSP',
        //   tokenAAmount: '10000000000000000',
        //   tokenBAmount: '10000000000000000',
        //   nativeTokenAmount,
        // },
        // // this pair includes 3 pools for SELL (fails due to liquidity are expected)
        // {
        //   tokenA: 'GHO',
        //   tokenB: 'STETH',
        //   tokenAAmount: '2000287700000000000000',
        //   tokenBAmount: '882754574792216661',
        //   nativeTokenAmount,
        // },
        // // 3 pools for buy (fails due to liquidity are expected)
        // {
        //   tokenA: 'GHO',
        //   tokenB: 'BAT',
        //   tokenAAmount: '100000000000000000000000',
        //   tokenBAmount: '100000000000000000000000',
        //   nativeTokenAmount,
        // },
      ];

      pairs.forEach(pair =>
        testForNetwork(
          network,
          dexKey,
          pair.tokenA,
          pair.tokenB,
          pair.tokenAAmount,
          pair.tokenBAmount,
          pair.nativeTokenAmount,
        ),
      );
    });

    describe('UniswapV3 POLYGON', () => {
      const network = Network.POLYGON;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'WETH';
      const nativeTokenSymbol = NativeTokenSymbols[network];

      const tokenAAmount: string = '11000000';
      const tokenBAmount: string = '11000000000000000000';
      const nativeTokenAmount = '11000000000000000000';

      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.simpleSwap,
            ContractMethod.multiSwap,
            ContractMethod.megaSwap,
            ContractMethod.directUniV3Swap,
          ],
        ],
        [
          SwapSide.BUY,
          [
            ContractMethod.simpleBuy,
            ContractMethod.buy,
            ContractMethod.directUniV3Buy,
          ],
        ],
      ]);

      sideToContractMethods.forEach((contractMethods, side) =>
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${network} ${side} ${contractMethod} ${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }),
      );
    });

    describe('UniswapV3 BSC', () => {
      const network = Network.BSC;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const tokenASymbol: string = 'BUSD';
      const tokenBSymbol: string = 'WBNB';
      const nativeTokenSymbol = NativeTokenSymbols[network];

      const tokenAAmount: string = '100000000000000000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

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

      sideToContractMethods.forEach((contractMethods, side) =>
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${network} ${side} ${contractMethod} ${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }),
      );
    });

    describe('UniswapV3 Optimism', () => {
      const network = Network.OPTIMISM;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const tokenASymbol: string = 'OP';
      const tokenBSymbol: string = 'ETH';
      const nativeTokenSymbol = NativeTokenSymbols[network];

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

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

      sideToContractMethods.forEach((contractMethods, side) =>
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${network} ${side} ${contractMethod} ${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }),
      );
    });

    describe('UniswapV3 Base', () => {
      const network = Network.BASE;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const tokenASymbol: string = 'PRIME';
      const tokenBSymbol: string = 'WETH';
      const nativeTokenSymbol = NativeTokenSymbols[network];

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

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

      sideToContractMethods.forEach((contractMethods, side) =>
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${network} ${side} ${contractMethod} ${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenBSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[tokenBSymbol],
                tokens[tokenASymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenBAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }),
      );
    });

    describe('UniswapV3 Avalanche', () => {
      const network = Network.AVALANCHE;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

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

      const pairs: { name: string; sellAmount: string; buyAmount: string }[][] =
        [
          [
            {
              name: 'AVAX',
              sellAmount: '1000000000000000000',
              buyAmount: '500000',
            },
            {
              name: 'USDT',
              sellAmount: '1000000',
              buyAmount: '10000000000000000000',
            },
          ],
          [
            {
              name: 'AVAX',
              sellAmount: '1000000000000000000',
              buyAmount: '500000',
            },
            {
              name: 'USDC',
              sellAmount: '1000000',
              buyAmount: '1000000000000000000',
            },
          ],
          [
            {
              name: 'WAVAX',
              sellAmount: '1000000000000000000',
              buyAmount: '500000',
            },
            {
              name: 'USDC',
              sellAmount: '1000000',
              buyAmount: '20000000000000000',
            },
          ],
          [
            {
              name: 'WAVAX',
              sellAmount: '1000000000000000000',
              buyAmount: '10000000',
            },
            { name: 'USDT', sellAmount: '1000000', buyAmount: '2000000000000' },
          ],
          [
            { name: 'USDC', sellAmount: '1000000', buyAmount: '100000000' },
            { name: 'USDT', sellAmount: '100000000', buyAmount: '100000000' },
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

    describe('UniswapV3 Unichain', () => {
      const network = Network.UNICHAIN;

      const tokenASymbol = 'WETH';
      const tokenBSymbol = 'USDC';

      const tokenAAmount = '1000000000000000000';
      const tokenBAmount = '1000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });

  describe('RamsesV2 E2E', () => {
    const dexKey = 'RamsesV2';

    describe('Arbitrum', () => {
      const network = Network.ARBITRUM;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const tokenASymbol: string = 'USDCe';
      const tokenBSymbol: string = 'USDT';
      const nativeTokenSymbol = NativeTokenSymbols[network];

      const tokenAAmount: string = '1100000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '1100000000000';

      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.simpleSwap,
            ContractMethod.multiSwap,
            ContractMethod.megaSwap,
            ContractMethod.directUniV3Swap,
          ],
        ],
        [
          SwapSide.BUY,
          [
            ContractMethod.simpleBuy,
            ContractMethod.buy,
            ContractMethod.directUniV3Buy,
          ],
        ],
      ]);

      sideToContractMethods.forEach((contractMethods, side) =>
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${network} ${side} ${contractMethod} ${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }),
      );
    });
  });

  describe('PharaohV2', () => {
    const dexKey = 'PharaohV2';

    describe('Avalanche', () => {
      const network = Network.AVALANCHE;

      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'USDCe';

      const tokenAAmount: string = '100000';
      const tokenBAmount: string = '100000';
      const nativeTokenAmount = '11000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });

  describe('ChronosV3 E2E', () => {
    const dexKey = 'ChronosV3';
    describe('Arbitrum', () => {
      const network = Network.ARBITRUM;
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const tokenASymbol: string = 'USDCe';
      const tokenBSymbol: string = 'USDT';
      const nativeTokenSymbol = NativeTokenSymbols[network];

      const tokenAAmount: string = '2000000';
      const tokenBAmount: string = '2000000';
      const nativeTokenAmount = '100000000000000000';

      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.simpleSwap,
            ContractMethod.multiSwap,
            ContractMethod.megaSwap,
            ContractMethod.directUniV3Swap,
          ],
        ],
        [
          SwapSide.BUY,
          [
            ContractMethod.simpleBuy,
            ContractMethod.buy,
            ContractMethod.directUniV3Buy,
          ],
        ],
      ]);

      sideToContractMethods.forEach((contractMethods, side) =>
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${network} ${side} ${contractMethod} ${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenASymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[nativeTokenSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${network} ${side} ${contractMethod} ${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }),
      );
    });
  });

  // describe('SushiSwapV3 E2E', () => {
  //   const dexKey = 'SushiSwapV3';

  //   describe('MAINNET', () => {
  //     const dexKey = 'UniswapV3';

  //     const network = Network.MAINNET;

  //     const tokenASymbol: string = 'USDC';
  //     const tokenBSymbol: string = 'USDT';

  //     const tokenAAmount: string = '1000000';
  //     const tokenBAmount: string = '1100000000';
  //     const nativeTokenAmount = '1000000000000000000';

  //     testForNetwork(
  //       network,
  //       dexKey,
  //       tokenASymbol,
  //       tokenBSymbol,
  //       tokenAAmount,
  //       tokenBAmount,
  //       nativeTokenAmount,
  //     );
  //   });

  //   describe('ARBITRUM', () => {
  //     const network = Network.ARBITRUM;

  //     const tokenASymbol: string = 'USDC';
  //     const tokenBSymbol: string = 'USDCe';

  //     const tokenAAmount: string = '10000000';
  //     const tokenBAmount: string = '10000000';
  //     const nativeTokenAmount = '900000000000000';

  //     testForNetwork(
  //       network,
  //       dexKey,
  //       tokenASymbol,
  //       tokenBSymbol,
  //       tokenAAmount,
  //       tokenBAmount,
  //       nativeTokenAmount,
  //     );
  //   });

  //   describe('POLYGON', () => {
  //     const network = Network.POLYGON;

  //     const tokenASymbol: string = 'USDC';
  //     const tokenBSymbol: string = 'USDT';

  //     const tokenAAmount: string = '21111000';
  //     const tokenBAmount: string = '200000000';
  //     const nativeTokenAmount = '110000000000000000';

  //     testForNetwork(
  //       network,
  //       dexKey,
  //       tokenASymbol,
  //       tokenBSymbol,
  //       tokenAAmount,
  //       tokenBAmount,
  //       nativeTokenAmount,
  //     );
  //   });

  //   describe('BSC', () => {
  //     const network = Network.BSC;
  //     const tokens = Tokens[network];
  //     const holders = Holders[network];
  //     const provider = new StaticJsonRpcProvider(
  //       generateConfig(network).privateHttpProvider,
  //       network,
  //     );

  //     const sideToContractMethods = new Map([
  //       [
  //         SwapSide.SELL,
  //         [
  //           ContractMethod.simpleSwap,
  //           ContractMethod.multiSwap,
  //           ContractMethod.megaSwap,
  //           ContractMethod.directUniV3Swap,
  //         ],
  //       ],
  //       [
  //         SwapSide.BUY,
  //         [
  //           ContractMethod.simpleBuy,
  //           ContractMethod.buy,
  //           ContractMethod.directUniV3Buy,
  //         ],
  //       ],
  //     ]);

  //     const pairs: { name: string; sellAmount: string; buyAmount: string }[][] =
  //       [
  //         [
  //           {
  //             name: 'USDC',
  //             sellAmount: '100000000000000000000',
  //             buyAmount: '100000000000000000000',
  //           },
  //           {
  //             name: 'USDT',
  //             sellAmount: '100000000000000000000',
  //             buyAmount: '100000000000000000000',
  //           },
  //         ],
  //         [
  //           {
  //             name: 'BNB',
  //             sellAmount: '1000000000000000000',
  //             buyAmount: '10000000000000000000',
  //           },
  //           {
  //             name: 'USDT',
  //             sellAmount: '1000000000000000000000',
  //             buyAmount: '20000000000000000',
  //           },
  //         ],
  //       ];

  //     sideToContractMethods.forEach((contractMethods, side) =>
  //       describe(`${side}`, () => {
  //         contractMethods.forEach((contractMethod: ContractMethod) => {
  //           pairs.forEach(pair => {
  //             describe(`${contractMethod}`, () => {
  //               it(`${pair[0].name} -> ${pair[1].name}`, async () => {
  //                 await testE2E(
  //                   tokens[pair[0].name],
  //                   tokens[pair[1].name],
  //                   holders[pair[0].name],
  //                   side === SwapSide.SELL
  //                     ? pair[0].sellAmount
  //                     : pair[0].buyAmount,
  //                   side,
  //                   dexKey,
  //                   contractMethod,
  //                   network,
  //                   provider,
  //                 );
  //               });
  //               it(`${pair[1].name} -> ${pair[0].name}`, async () => {
  //                 await testE2E(
  //                   tokens[pair[1].name],
  //                   tokens[pair[0].name],
  //                   holders[pair[1].name],
  //                   side === SwapSide.SELL
  //                     ? pair[1].sellAmount
  //                     : pair[1].buyAmount,
  //                   side,
  //                   dexKey,
  //                   contractMethod,
  //                   network,
  //                   provider,
  //                 );
  //               });
  //             });
  //           });
  //         });
  //       }),
  //     );
  //   });

  //   describe('AVALANCHE', () => {
  //     const network = Network.AVALANCHE;

  //     const tokenASymbol: string = 'USDT';
  //     const tokenBSymbol: string = 'USDC';

  //     const tokenAAmount: string = '111110';
  //     const tokenBAmount: string = '100000';
  //     const nativeTokenAmount = '11000000000000000';

  //     testForNetwork(
  //       network,
  //       dexKey,
  //       tokenASymbol,
  //       tokenBSymbol,
  //       tokenAAmount,
  //       tokenBAmount,
  //       nativeTokenAmount,
  //     );
  //   });

  //   describe('FANTOM', () => {
  //     const network = Network.FANTOM;
  //     const tokens = Tokens[network];
  //     const holders = Holders[network];
  //     const provider = new StaticJsonRpcProvider(
  //       generateConfig(network).privateHttpProvider,
  //       network,
  //     );

  //     const sideToContractMethods = new Map([
  //       [
  //         SwapSide.SELL,
  //         [
  //           ContractMethod.simpleSwap,
  //           ContractMethod.multiSwap,
  //           ContractMethod.megaSwap,
  //           ContractMethod.directUniV3Swap,
  //         ],
  //       ],
  //       [
  //         SwapSide.BUY,
  //         [
  //           ContractMethod.simpleBuy,
  //           ContractMethod.buy,
  //           ContractMethod.directUniV3Buy,
  //         ],
  //       ],
  //     ]);

  //     const pairs: { name: string; sellAmount: string; buyAmount: string }[][] =
  //       [
  //         [
  //           {
  //             name: 'FTM',
  //             sellAmount: '100000000000000000',
  //             buyAmount: '100000000',
  //           },
  //           {
  //             name: 'USDC',
  //             sellAmount: '100000000',
  //             buyAmount: '100000000000000000',
  //           },
  //         ],
  //         [
  //           {
  //             name: 'WFTM',
  //             sellAmount: '100000000000000',
  //             buyAmount: '1000000000000000',
  //           },
  //           {
  //             name: 'WETH',
  //             sellAmount: '1000000000000000',
  //             buyAmount: '100000000000000',
  //           },
  //         ],
  //       ];

  //     sideToContractMethods.forEach((contractMethods, side) =>
  //       describe(`${side}`, () => {
  //         contractMethods.forEach((contractMethod: ContractMethod) => {
  //           pairs.forEach(pair => {
  //             describe(`${contractMethod}`, () => {
  //               it(`${pair[0].name} -> ${pair[1].name}`, async () => {
  //                 await testE2E(
  //                   tokens[pair[0].name],
  //                   tokens[pair[1].name],
  //                   holders[pair[0].name],
  //                   side === SwapSide.SELL
  //                     ? pair[0].sellAmount
  //                     : pair[0].buyAmount,
  //                   side,
  //                   dexKey,
  //                   contractMethod,
  //                   network,
  //                   provider,
  //                 );
  //               });
  //               it(`${pair[1].name} -> ${pair[0].name}`, async () => {
  //                 await testE2E(
  //                   tokens[pair[1].name],
  //                   tokens[pair[0].name],
  //                   holders[pair[1].name],
  //                   side === SwapSide.SELL
  //                     ? pair[1].sellAmount
  //                     : pair[1].buyAmount,
  //                   side,
  //                   dexKey,
  //                   contractMethod,
  //                   network,
  //                   provider,
  //                 );
  //               });
  //             });
  //           });
  //         });
  //       }),
  //     );
  //   });

  //   describe('OPTIMISM', () => {
  //     const network = Network.OPTIMISM;

  //     const tokenASymbol: string = 'USDC';
  //     const tokenBSymbol: string = 'USDT';

  //     const tokenAAmount: string = '111110000';
  //     const tokenBAmount: string = '10000000';
  //     const nativeTokenAmount = '11000000000000000';

  //     testForNetwork(
  //       network,
  //       dexKey,
  //       tokenASymbol,
  //       tokenBSymbol,
  //       tokenAAmount,
  //       tokenBAmount,
  //       nativeTokenAmount,
  //     );
  //   });

  describe('Wagmi E2E', () => {
    const dexKey = 'Wagmi';

    describe('Sonic', function () {
      const network = Network.SONIC;

      const tokenASymbol: string = 'WS';
      const tokenBSymbol: string = 'WAGMI';

      const tokenAAmount: string = '110000000000000000';
      const tokenBAmount: string = '110000000000000000';
      const nativeTokenAmount = '1100000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });

  describe('Retro E2E', () => {
    const dexKey = 'Retro';

    describe('POLYGON', () => {
      const network = Network.POLYGON;

      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '1000000000';
      const tokenBAmount: string = '100000000';
      const nativeTokenAmount = '1100000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });

  describe('BaseswapV3 E2E', () => {
    const dexKey = 'BaseswapV3';
    describe('Base', () => {
      const network = Network.BASE;

      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'USDbC';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '1000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });

  describe('Slipstream', () => {
    describe('VelodromeSlipstreamNewFactory', () => {
      const dexKey = 'VelodromeSlipstreamNewFactory';

      describe('Optimism', () => {
        const network = Network.OPTIMISM;

        describe('PSTAKE -> USDC', () => {
          const tokenASymbol: string = 'PSTAKE';
          const tokenBSymbol: string = 'USDC';

          const tokenAAmount: string = '1000000000000000000';
          const tokenBAmount: string = '1000000';
          const nativeTokenAmount: string = '1000000000000000000';

          testForNetwork(
            network,
            dexKey,
            tokenASymbol,
            tokenBSymbol,
            tokenAAmount,
            tokenBAmount,
            nativeTokenAmount,
          );
        });
      });
    });

    describe('VelodromeSlipstream', () => {
      const dexKey = 'VelodromeSlipstream';

      describe('Unichain', () => {
        const network = Network.UNICHAIN;

        describe('WETH -> USDC', () => {
          const tokenASymbol: string = 'WETH';
          const tokenBSymbol: string = 'USDC';

          const tokenAAmount: string = '1000000000000000000';
          const tokenBAmount: string = '1000000';
          const nativeTokenAmount = '1000000000000000000';

          testForNetwork(
            network,
            dexKey,
            tokenASymbol,
            tokenBSymbol,
            tokenAAmount,
            tokenBAmount,
            nativeTokenAmount,
          );
        });

        describe('WETH -> USDT0', () => {
          const tokenASymbol: string = 'WETH';
          const tokenBSymbol: string = 'USD₮0';

          const tokenAAmount: string = '1000000000000000000';
          const tokenBAmount: string = '1000000';
          const nativeTokenAmount = '1000000000000000000';

          testForNetwork(
            network,
            dexKey,
            tokenASymbol,
            tokenBSymbol,
            tokenAAmount,
            tokenBAmount,
            nativeTokenAmount,
          );
        });

        describe('USDC -> USDT0', () => {
          const tokenASymbol: string = 'USDC';
          const tokenBSymbol: string = 'USD₮0';

          const tokenAAmount: string = '1000000';
          const tokenBAmount: string = '1000000';
          const nativeTokenAmount = '1000000000000000000';

          testForNetwork(
            network,
            dexKey,
            tokenASymbol,
            tokenBSymbol,
            tokenAAmount,
            tokenBAmount,
            nativeTokenAmount,
          );
        });
      });
    });

    describe('AerodromeSlipstream', () => {
      const dexKey = 'AerodromeSlipstream';
      describe('Base', () => {
        const network = Network.BASE;

        const tokenASymbol: string = 'DOG';
        const tokenBSymbol: string = 'WETH';

        const tokenAAmount: string = '1100000000000000000';
        const tokenBAmount: string = '1100000000000000000';
        const nativeTokenAmount = '2100000000000000000';

        testForNetwork(
          network,
          dexKey,
          tokenASymbol,
          tokenBSymbol,
          tokenAAmount,
          tokenBAmount,
          nativeTokenAmount,
        );
      });
    });
  });

  describe('OkuTradeV3 E2E', () => {
    const dexKey = 'OkuTradeV3';
    describe('Gnosis', () => {
      const network = Network.GNOSIS;

      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'sDAI';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });

  describe('PangolinV3', () => {
    const dexKey = 'PangolinV3';

    describe('Avalanche', () => {
      const network = Network.AVALANCHE;

      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '100000';
      const tokenBAmount: string = '100000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });
});
