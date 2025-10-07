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
import { DirectMethodsV6 } from './constants';

jest.setTimeout(50 * 1000);

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  excludeNativeTokenTests: boolean = false,
) {
  const config = generateConfig(network);
  const provider = new StaticJsonRpcProvider(
    config.privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];
  const sleepMs = 10000;

  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        ContractMethod.swapExactAmountInOnBalancerV2,
        // ContractMethod.simpleSwap,
        // ContractMethod.megaSwap,
        // ContractMethod.multiSwap,
      ],
    ],
    [
      SwapSide.BUY,
      [
        ContractMethod.swapExactAmountOut,
        ContractMethod.swapExactAmountOutOnBalancerV2,
        // ContractMethod.simpleBuy,
        // ContractMethod.buy,
      ],
    ],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            if (excludeNativeTokenTests) {
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
                  undefined,
                  sleepMs,
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
                  undefined,
                  sleepMs,
                );
              });
            } else {
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
                  undefined,
                  sleepMs,
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
                  undefined,
                  sleepMs,
                );
              });
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
                  undefined,
                  sleepMs,
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
                  undefined,
                  sleepMs,
                );
              });
            }
          });
        });
      }),
    );
  });
}

describe('BalancerV2 E2E', () => {
  describe('Mainnet', () => {
    const dexKey = 'BalancerV2';
    const network = Network.MAINNET;
    const tokens = Tokens[Network.MAINNET];
    const holders = Holders[Network.MAINNET];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    describe('GHO -> USDT', () => {
      const pairs: { name: string; sellAmount: string; buyAmount: string }[][] =
        [
          [
            {
              name: 'GHO',
              sellAmount: '1000000000000000000000',
              buyAmount: '1000000000',
            },
            {
              name: 'USDT',
              sellAmount: '1000000000',
              buyAmount: '1000000000000000000000',
            },
          ],
        ];

      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.swapExactAmountIn,
            ContractMethod.swapExactAmountInOnBalancerV2,
          ],
        ],
        [
          SwapSide.BUY,
          [
            ContractMethod.swapExactAmountOut,
            ContractMethod.swapExactAmountOutOnBalancerV2,
          ],
        ],
      ]);

      sideToContractMethods.forEach((contractMethods, side) =>
        describe(`${side}`, () => {
          contractMethods.forEach((contractMethod: string) => {
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
                    contractMethod as any,
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
                    contractMethod as any,
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

    describe('Weighted Pool', () => {
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
              name: 'WETH',
              sellAmount: '20000000000',
              buyAmount: '100000000000000000000000',
            },
            {
              name: 'PSP',
              sellAmount: '200000000000000',
              buyAmount: '1871289184941469675',
            },
          ],
          [
            {
              name: 'BAL',
              sellAmount: '100000',
              buyAmount: '10000000000000',
            },
            {
              name: 'WETH',
              sellAmount: '200000000000000',
              buyAmount: '1871289184',
            },
          ],
          [
            {
              name: 'OHM',
              sellAmount: '20000000000',
              buyAmount: '1000000000000',
            },
            {
              name: 'DAI',
              sellAmount: '200000000000000',
              buyAmount: '20000000000',
            },
          ],
          [
            {
              name: 'OHM',
              sellAmount: '20000000000',
              buyAmount: '10000000000000',
            },
            {
              name: 'WETH',
              sellAmount: '200000000000000',
              buyAmount: '10000000000',
            },
          ],
          [
            {
              name: 'WETH',
              sellAmount: '20000000000',
              buyAmount: '10000000000000',
            },
            {
              name: 'AURA',
              sellAmount: '200000000000000',
              buyAmount: '10000000000',
            },
          ],
          [
            {
              name: 'USDC',
              sellAmount: '111000000',
              buyAmount: '111000000',
            },
            {
              name: 'wstETH',
              sellAmount: '100000000000000000',
              buyAmount: '100000000000000000',
            },
          ],
        ];

      sideToContractMethods.forEach((contractMethods, side) =>
        describe(`${side}`, () => {
          contractMethods.forEach((contractMethod: string) => {
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
                    contractMethod as any,
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
                    contractMethod as any,
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

    describe('Popular tokens', () => {
      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.simpleSwap,
            ContractMethod.multiSwap,
            ContractMethod.megaSwap,
          ],
        ],
        [
          SwapSide.BUY,
          [
            // Buy support is enabled only for Weighted Pools
            // ContractMethod.simpleBuy,
            // ContractMethod.buy
          ],
        ],
      ]);

      const pairs: { name: string; sellAmount: string; buyAmount: string }[][] =
        [
          [
            {
              name: 'USDC',
              sellAmount: '100000000',
              buyAmount: '100000000',
            },
            {
              name: 'USDT',
              sellAmount: '1000000000',
              buyAmount: '1000000000000',
            },
          ],
          [
            {
              name: 'USDT',
              sellAmount: '1000000000000',
              buyAmount: '1000000000000',
            },
            {
              name: 'USDC',
              sellAmount: '1000000000',
              buyAmount: '1000000000000',
            },
          ],
          [
            {
              name: 'ETH',
              sellAmount: '2000000000000',
              buyAmount: '100000000',
            },
            {
              name: 'USDC',
              sellAmount: '37690000',
              buyAmount: '20035947428035770',
            },
          ],
          [
            {
              name: 'WETH',
              sellAmount: '70000000000000',
              buyAmount: '100000000',
            },
            {
              name: 'USDC',
              sellAmount: '1000000000',
              buyAmount: '20000947428035770',
            },
          ],
          [
            {
              name: 'USDC',
              sellAmount: '10000000000',
              buyAmount: '10000000000000000000',
            },
            {
              name: 'DAI',
              sellAmount: '200000000000000',
              buyAmount: '2000000000000',
            },
          ],
          [
            {
              name: 'wstETH',
              sellAmount: '3000000000000000000',
              buyAmount: '3000000000000000000',
            },
            {
              name: 'ETH',
              sellAmount: '200000000000',
              buyAmount: '7000000000000000000',
            },
          ],
          [
            {
              name: 'WETH',
              sellAmount: '20000000000',
              buyAmount: '100000000000000000000000',
            },
            {
              name: 'PSP',
              sellAmount: '200000000000000',
              buyAmount: '1871289184941469675',
            },
          ],
          [
            {
              name: 'WETH',
              sellAmount: '200000000000000000',
              buyAmount: '20000',
            },
            {
              name: 'WBTC',
              sellAmount: '200000000',
              buyAmount: '200000000000000000',
            },
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

    describe('GearboxLinear pool', () => {
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

      const pairs: { name: string; amount: string }[][] = [
        [
          { name: 'USDC', amount: '1000000000' },
          { name: 'dUSDC', amount: '100000000000' },
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
                    pair[0].amount,
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
                    pair[1].amount,
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

    describe('GyroE pool', () => {
      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.simpleSwap,
            // ContractMethod.multiSwap,
            // ContractMethod.megaSwap,
          ],
        ],
        // [
        // SwapSide.BUY,
        // [
        //   ContractMethod.simpleBuy,
        //   ContractMethod.buy
        // ],
        // ],
      ]);

      const pairs: { name: string; amount: string }[][] = [
        [
          { name: 'GYD', amount: '10000000000000000000' },
          { name: 'sDAI', amount: '10000000000000000000' },
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
                    pair[0].amount,
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
                    pair[1].amount,
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

    //daniel: BPT swaps are currently not supported, we've refactored to focus on mainToken paths
    /*it('MAIN TOKEN -> BPT, LinearPool', async () => {
        // Linear Pools allow swaps between main token (i.e. USDT) and pools BPT
        await testE2E(
          tokens['USDT'],
          tokens['BBAUSDT'],
          holders['USDT'],
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('MAIN TOKEN -> WRAPPED TOKEN, LinearPool', async () => {
        await testE2E(
          tokens['USDT'],
          tokens['waUSDT'],
          holders['USDT'],
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });*/
    // NO HOLDERS OF waUSDT (ONLY VAULT)
    // it('WRAPPED TOKEN -> BPT, LinearPool', async () => {
    //   // Linear Pools allow swaps between wrapped token (i.e. waUSDT) and pools BPT
    //   await testE2E(
    //     tokens['waUSDT'],
    //     tokens['BBAUSDT'],
    //     holders['waUSDT'],
    //     '20000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //   );
    // });
    // NO HOLDERS OF BBADAI (ONLY VAULT)
    // it('WRAPPED TOKEN -> MAIN TOKEN, LinearPool', async () => {
    //   await testE2E(
    //     tokens['waUSDT'],
    //     tokens['BBAUSDT'],
    //     holders['waUSDT'],
    //     '20000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //   );
    // });
    // NO HOLDERS OF BBADAI (ONLY VAULT)
    // it('BPT -> MAIN TOKEN, LinearPool', async () => {
    //   // Linear Pools allow swaps between main token (i.e. USDT) and pools BPT
    //   await testE2E(
    //     tokens['BBADAI'],
    //     tokens['DAI'],
    //     holders['BBADAI'],
    //     '20000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //   );
    // });
    // it('BPT -> WRAPPED TOKEN, LinearPool', async () => {
    //   // Linear Pools allow swaps between wrapped token (i.e. waDAI) and pools BPT
    //   await testE2E(
    //     tokens['BBADAI'],
    //     tokens['waDAI'],
    //     holders['BBADAI'],
    //     '20000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //   );
    // });

    //daniel: BPT swaps are currently not supported, we've refactored to focus on mainToken paths
    /*it('BPT -> TOKEN, PhantomStablePool', async () => {
        // PhantomStable allows swaps between BPT and tokens
        await testE2E(
          tokens['BBAUSD'],
          tokens['BBADAI'],
          holders['BBAUSD'],
          '20000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('MAIN TOKEN -> BPT, ERC4626 Linear Pool', async () => {
        await testE2E(
          tokens['DAI'],
          tokens['BBFDAI'],
          holders['DAI'],
          '20000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });*/

    //daniel: BPT swaps are currently not supported, we've refactored to focus on mainToken paths
    /*
      it('MAIN TOKEN -> BPT, LinearPool', async () => {
        // Linear Pools allow swaps between main token (i.e. USDT) and pools BPT
        await testE2E(
          tokens['USDT'],
          tokens['BBAUSDT'],
          holders['USDT'],
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('MAIN TOKEN -> WRAPPED TOKEN, LinearPool', async () => {
        await testE2E(
          tokens['USDT'],
          tokens['waUSDT'],
          holders['USDT'],
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('BPT -> TOKEN, PhantomStablePool', async () => {
        // PhantomStable allows swaps between BPT and tokens
        await testE2E(
          tokens['BBAUSD'],
          tokens['BBAUSDT'],
          holders['BBAUSD'],
          '20000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('MAIN TOKEN -> BPT, ERC4626 Linear Pool', async () => {
        await testE2E(
          tokens['DAI'],
          tokens['BBFDAI'],
          holders['DAI'],
          '20000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      */
  });

  describe('Polygon_v6', () => {
    const dexKey = 'BalancerV2';
    const network = Network.POLYGON;
    const tokens = Tokens[Network.POLYGON];
    const holders = Holders[Network.POLYGON];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          // ContractMethod.simpleSwap,
          // ContractMethod.multiSwap,
          // ContractMethod.megaSwap,
          // ContractMethod.directBalancerV2GivenInSwap,
          ContractMethod.swapExactAmountIn,
          ContractMethod.swapExactAmountInOnBalancerV2,
        ],
      ],
      [
        SwapSide.BUY,
        [
          // ContractMethod.directBalancerV2GivenOutSwap,
          // ContractMethod.simpleBuy,
          // ContractMethod.buy,
          ContractMethod.swapExactAmountOut,
          ContractMethod.swapExactAmountOutOnBalancerV2,
        ],
      ],
    ]);

    const pairs: { name: string; sellAmount: string }[][] = [
      [
        { name: 'WMATIC', sellAmount: '1000000000000000000' },
        { name: 'stMATIC', sellAmount: '1000000000000000000' },
      ],
      [
        { name: 'MATIC', sellAmount: '1000000000000000000' },
        { name: 'stMATIC', sellAmount: '1000000000000000000' },
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
                  pair[0].sellAmount,
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
                  pair[1].sellAmount,
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

    it('USDC -> USDT through Gyro3', async () => {
      await testE2E(
        tokens['USDC'],
        tokens['USDT'],
        holders['USDC'],
        '10000000', // 10 * 1e6
        SwapSide.SELL,
        dexKey,
        ContractMethod.multiSwap,
        network,
        provider,
        // [`${dexKey}_0x17f1ef81707811ea15d9ee7c741179bbe2a63887`],
      );
    });

    it('USDC -> USDT through Gyro3 (BUY)', async () => {
      await testE2E(
        tokens['USDC'],
        tokens['USDT'],
        holders['USDC'],
        '10000000', // 10 * 1e6
        SwapSide.BUY,
        dexKey,
        ContractMethod.multiSwap,
        network,
        provider,
        // [`${dexKey}_0x17f1ef81707811ea15d9ee7c741179bbe2a63887`],
      );
    });
  });

  describe('Arbitrum', () => {
    const dexKey = 'BalancerV2';
    const network = Network.ARBITRUM;
    const tokens = Tokens[Network.ARBITRUM];
    const holders = Holders[Network.ARBITRUM];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    describe('Weighted Pool', () => {
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
              name: 'RDNT',
              sellAmount: '100000000000000000',
              buyAmount: '100000000000000',
            },
            {
              name: 'WETH',
              sellAmount: '100000000000000',
              buyAmount: '1871289184',
            },
          ],
          [
            {
              name: 'USDC',
              sellAmount: '10000',
              buyAmount: '2000',
            },
            {
              name: 'OHM',
              sellAmount: '1000',
              buyAmount: '1871289184',
            },
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

    describe('Simpleswap', () => {
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens['ETH'],
          tokens['USDC'],
          holders['ETH'],
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens['USDC'],
          tokens['ETH'],
          holders['USDC'],
          '2000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens['USDC'],
          tokens['WETH'],
          holders['USDC'],
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
      it('ETH -> TOKEN', async () => {
        await testE2E(
          tokens['ETH'],
          tokens['USDC'],
          holders['ETH'],
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> ETH', async () => {
        await testE2E(
          tokens['USDC'],
          tokens['ETH'],
          holders['USDC'],
          '2000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens['USDC'],
          tokens['WETH'],
          holders['USDC'],
          '20000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('Sonic', () => {
    const dexKey = 'BeetsFi';
    const network = Network.SONIC;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    [
      ContractMethod.swapExactAmountInOnBalancerV2,
      ContractMethod.swapExactAmountIn,
    ].forEach(method => {
      describe(method, () => {
        it('S -> stS', async () => {
          await testE2E(
            tokens['S'],
            tokens['stS'],
            '',
            '1000000000000000000',
            SwapSide.SELL,
            dexKey,
            method,
            network,
            provider,
          );
        });
      });
    });
  });

  describe('Polygon', () => {
    const dexKey = 'BalancerV2';
    const network = Network.POLYGON;
    const tokens = Tokens[Network.POLYGON];
    const holders = Holders[Network.POLYGON];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    describe('Weighted Pool', () => {
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
              name: 'WMATIC',
              sellAmount: '20000000000000',
              buyAmount: '200000000',
            },
            {
              name: 'USDC',
              sellAmount: '200000000',
              buyAmount: '2000000000000000',
            },
          ],
          [
            {
              name: 'WBTC',
              sellAmount: '10000000',
              buyAmount: '200000000',
            },
            {
              name: 'USDC',
              sellAmount: '200000000',
              buyAmount: '1000000',
            },
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
  });

  describe('Avalanche', () => {
    const dexKey = 'BalancerV2';
    const network = Network.AVALANCHE;
    const tokens = Tokens[Network.AVALANCHE];
    const holders = Holders[Network.AVALANCHE];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    describe('ComposableStable', () => {
      const sideToContractMethods = new Map([
        [
          SwapSide.SELL,
          [
            ContractMethod.simpleSwap,
            ContractMethod.multiSwap,
            ContractMethod.megaSwap,
          ],
        ],
      ]);

      const pairs: { name: string; sellAmount: string; buyAmount: string }[][] =
        [
          [
            {
              name: 'sAVAX',
              sellAmount: '20000000000000',
              buyAmount: '200000000',
            },
            {
              name: 'AVAX',
              sellAmount: '200000000',
              buyAmount: '2000000000000000',
            },
          ],
          [
            {
              name: 'USDT',
              sellAmount: '20000000',
              buyAmount: '200000000',
            },
            {
              name: 'USDC',
              sellAmount: '200000000',
              buyAmount: '2000000000',
            },
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

    describe('Weighted Pool', () => {
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
              name: 'BETS',
              sellAmount: '20000000000000',
              buyAmount: '200000000',
            },
            {
              name: 'sAVAX',
              sellAmount: '200000000',
              buyAmount: '2000000000000000',
            },
          ],
          [
            {
              name: 'HATCHY',
              sellAmount: '20000000000000',
              buyAmount: '200000000',
            },
            {
              name: 'AVAX',
              sellAmount: '200000000',
              buyAmount: '2000000000000000',
            },
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
  });

  describe('Base', () => {
    const dexKey = 'BalancerV2';
    const network = Network.BASE;

    describe('USDC -> GOLD', () => {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'GOLD';

      const tokenAAmount: string = '11110010';
      const tokenBAmount: string = '210000000000000000000';
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

    describe('WETH -> USDC', () => {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      // const tokenAAmount: string = '375699066125449';
      const tokenAAmount: string = '300000000000000';
      // const tokenBAmount: string = '1196427';
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
        true,
      );
    });
  });

  describe('Gnosis', () => {
    const dexKey = 'BalancerV2';
    const network = Network.GNOSIS;

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'USDT',
      '11110010',
      '21000000',
      '100000000000000000',
    );

    testForNetwork(
      network,
      dexKey,
      'WETH',
      'WXDAI',
      '1000000000000000000',
      '1000000000000000000',
      '1000000000000000000',
    );
  });
});
