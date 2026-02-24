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
});
