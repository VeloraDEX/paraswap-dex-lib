import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
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
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

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

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
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
                slippage,
              );
            });
          });
        });
      }),
    );
  });
}

describe('UniswapV2 E2E BSC', () => {
  const network = Network.BSC;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  describe('PancakeSwapV2', () => {
    const dexKey = 'PancakeSwapV2';

    describe('Simpleswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.BUSD,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.BUSD,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('BuyMethod', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.BUSD,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
    });
  });

  describe('JulSwap', () => {
    const dexKey = 'JulSwap';

    describe('Simpleswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.WBNB,
          holders.BUSD,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.WBNB,
          holders.BUSD,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('ApeSwap', () => {
    const dexKey = 'ApeSwap';

    describe('Simpleswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.BUSD,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.BUSD,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('PancakeSwap', () => {
    const dexKey = 'PancakeSwap';

    describe('Simpleswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WBNB,
          holders.DAI,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WBNB,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('BakerySwap', () => {
    const dexKey = 'BakerySwap';

    describe('Bakery_V6', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BUSD,
          holders.USDT,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
    });

    // describe('Simpleswap', () => {
    //   it('Token -> TOKEN', async () => {
    //     await testE2E(
    //       tokens.USDT,
    //       tokens.BUSD,
    //       holders.USDT,
    //       '70000000000000000000',
    //       SwapSide.SELL,
    //       dexKey,
    //       ContractMethod.simpleSwap,
    //       network,
    //       provider,
    //     );
    //   });
    // });

    // describe('Multiswap', () => {
    //   it('Token -> TOKEN', async () => {
    //     await testE2E(
    //       tokens.USDT,
    //       tokens.BUSD,
    //       holders.USDT,
    //       '70000000000000000000',
    //       SwapSide.SELL,
    //       dexKey,
    //       ContractMethod.multiSwap,
    //       network,
    //       provider,
    //     );
    //   });
    // });
  });

  describe('PantherSwap', () => {
    const dexKey = 'PantherSwap';

    describe('Simpleswap', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('TOKEN -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.USDT,
          holders.BUSD,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WBNB,
          holders.DAI,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('TOKEN -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('MDEX', () => {
    const dexKey = 'MDEX';

    describe('Simpleswap', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.USDT,
          holders.BNB,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('Token -> BNB', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BNB,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('BUY', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.USDT,
          holders.BNB,
          '100000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('Token -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '10000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.USDT,
          holders.BNB,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('Token -> BNB', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BNB,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('Megapath', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('BiSwap', () => {
    const dexKey = 'BiSwap';

    describe('Simpleswap', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.USDT,
          holders.BNB,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('Token -> BNB', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BNB,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('BUY', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.USDT,
          holders.BNB,
          '100000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('Token -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '10000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('BNB -> TOKEN', async () => {
        await testE2E(
          tokens.BNB,
          tokens.USDT,
          holders.BNB,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('Token -> BNB', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BNB,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('Megapath', () => {
      it('Token -> TOKEN', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('WaultFinance', () => {
    const dexKey = 'WaultFinance';

    describe('Simpleswap', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '10000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('USDT -> BUSD', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BUSD,
          holders.USDT,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('SimpleBuy', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '10000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('USDT -> BUSD', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BUSD,
          holders.USDT,
          '100000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '10000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });
    describe('MultiSwap', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '10000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('USDT -> BUSD', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BUSD,
          holders.USDT,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('MegaSwap', () => {
      it('USDT -> BUSD', async () => {
        await testE2E(
          tokens.USDT,
          tokens.BUSD,
          holders.USDT,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('CoinSwap', () => {
    const dexKey = 'CoinSwap';

    describe('Simpleswap', () => {
      it('BUSD -> WBNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.WBNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('SimpleBuy', () => {
      it('BUSD -> WBNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.WBNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });

      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });

      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '1000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });

    describe('MultiSwap', () => {
      it('BUSD -> WBNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.WBNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('MegaSwap', () => {
      it('BUSD -> WBNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.WBNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('CheeseSwap', () => {
    const dexKey = 'CheeseSwap';

    describe('Simpleswap', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '100000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('WBNB -> BUSD', async () => {
        await testE2E(
          tokens.WBNB,
          tokens.BUSD,
          holders.WBNB,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('Multi', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('WBNB -> BUSD', async () => {
        await testE2E(
          tokens.WBNB,
          tokens.BUSD,
          holders.WBNB,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('Mega', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
    describe('SimpleBuy', () => {
      it('BNB -> BUSD', async () => {
        await testE2E(
          tokens.BNB,
          tokens.BUSD,
          holders.BNB,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('BUSD -> BNB', async () => {
        await testE2E(
          tokens.BUSD,
          tokens.BNB,
          holders.BUSD,
          '7000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('WBNB -> BUSD', async () => {
        await testE2E(
          tokens.WBNB,
          tokens.BUSD,
          holders.WBNB,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });
  });

  describe('NomiswapV2', () => {
    const dexKey = 'NomiswapV2';
    const network = Network.BSC;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDT';

    const tokenAAmount: string = '1111100000';
    const tokenBAmount: string = '1000000000';
    const nativeTokenAmount = '11000000000000';

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

  describe('OmniExchangeV2', () => {
    const dexKey = 'OmniExchangeV2';
    const network = Network.BSC;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const sideToContractMethods = new Map<SwapSide, ContractMethod[]>([
      [
        SwapSide.SELL,
        [
          ContractMethod.simpleSwap,
          ContractMethod.multiSwap,
          ContractMethod.megaSwap,
        ],
      ],
    ]);

    const pairs: { name: string; sellAmount: string }[][] = [
      [
        { name: 'BNB', sellAmount: '50000000000000000' },
        { name: 'USDC', sellAmount: '10000000000000000000' },
      ],
      [
        { name: 'BNB', sellAmount: '50000000000000000' },
        { name: 'USDT', sellAmount: '10000000000000000000' },
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
        { name: 'WBNB', sellAmount: '7000000000000000000', buyAmount: '1000' },
        { name: 'BUSD', sellAmount: '5000', buyAmount: '10000000' },
      ],
      [
        { name: 'WBNB', sellAmount: '3000000000', buyAmount: '1000' },
        { name: 'POPS', sellAmount: '800000000000', buyAmount: '800000000000' },
      ],
      [
        { name: 'WBNB', sellAmount: '7000000000000000000', buyAmount: '1000' },
        { name: 'DAI', sellAmount: '1000', buyAmount: '1000' },
      ],
      [
        { name: 'WBNB', sellAmount: '7000000000000000000', buyAmount: '1000' },
        { name: 'USDC', sellAmount: '700', buyAmount: '1000' },
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
