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
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
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
              );
            });
          });
        });
      }),
    );
  });
}

describe('UniswapV2 E2E Avalanche', () => {
  const network = Network.AVALANCHE;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  describe('PangolinSwap', () => {
    const dexKey = 'PangolinSwap';

    describe('simpleSwap', () => {
      it('AVAX -> USDT.e', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.USDTe,
          holders.AVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('USDT.e -> AVAX', async () => {
        await testE2E(
          tokens.USDTe,
          tokens.AVAX,
          holders.USDTe,
          '10000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('multiSwap', () => {
      it('AVAX -> USDTe', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.USDTe,
          holders.AVAX,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('USDTe -> AVAX', async () => {
        await testE2E(
          tokens.USDTe,
          tokens.AVAX,
          holders.USDTe,
          '100000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('megaSwap', () => {
      it('AVAX -> USDTe', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.USDTe,
          holders.AVAX,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });

      it('USDTe -> AVAX', async () => {
        await testE2E(
          tokens.USDTe,
          tokens.AVAX,
          holders.USDTe,
          '100000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });

    describe('BuyMethod', () => {
      it('AVAX -> USDT.e', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.USDTe,
          holders.AVAX,
          '100000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });

      it('USDT.e -> AVAX', async () => {
        await testE2E(
          tokens.USDTe,
          tokens.AVAX,
          holders.USDTe,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '100000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
    });
  });

  describe('ArenaDexV2', () => {
    const dexKey = 'ArenaDexV2';

    testForNetwork(
      network,
      dexKey,
      'ARENA',
      'WAVAX',
      '10000000',
      '10000000',
      '10000000',
    );
  });

  describe('TraderJoe', () => {
    const dexKey = 'TraderJoe';
    describe('TraderJoe: Fail: (Joe: K)', () => {
      // To run might need to hardcode the price route in e2e utils
      it('AVAX -> LINK.e', async () => {
        const dexKeys = ['LydiaFinance', 'PangolinSwap', 'TraderJoe'];
        await testE2E(
          tokens.WAVAX,
          tokens.LINKe,
          holders.WAVAX,
          '37000000000000000000',
          SwapSide.SELL,
          dexKeys,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
    });

    describe('simpleSwap', () => {
      it('AMPL -> MIM', async () => {
        await testE2E(
          tokens.AMPL,
          tokens.MIM,
          holders.AMPL,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('AMPL -> MIM', async () => {
        await testE2E(
          tokens.AMPL,
          tokens.MIM,
          holders.AMPL,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('MIM -> AMPL', async () => {
        await testE2E(
          tokens.MIM,
          tokens.AMPL,
          holders.MIM,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('multiSwap', () => {
      it('AVAX -> USDTe', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.USDTe,
          holders.AVAX,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('USDTe -> AVAX', async () => {
        await testE2E(
          tokens.USDTe,
          tokens.AVAX,
          holders.USDTe,
          '100000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('megaSwap', () => {
      it('AVAX -> USDTe', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.USDTe,
          holders.AVAX,
          '1000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });

      it('USDTe -> AVAX', async () => {
        await testE2E(
          tokens.USDTe,
          tokens.AVAX,
          holders.USDTe,
          '100000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDTe', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDTe,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('SushiSwap', () => {
    const dexKey = 'SushiSwap';

    describe('simpleSwap', () => {
      it('AVAX -> ETH', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.ETH,
          holders.AVAX,
          '3000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('ETH -> AVAX', async () => {
        await testE2E(
          tokens.ETH,
          tokens.AVAX,
          holders.ETH,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDT', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDT,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('multiSwap', () => {
      it('AVAX -> ETH', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.ETH,
          holders.AVAX,
          '3000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('ETH -> AVAX', async () => {
        await testE2E(
          tokens.ETH,
          tokens.AVAX,
          holders.ETH,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDT', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDT,
          holders.WAVAX,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });

    describe('megaSwap', () => {
      it('AVAX -> ETH', async () => {
        await testE2E(
          tokens.AVAX,
          tokens.ETH,
          holders.AVAX,
          '3000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });

      it('ETH -> AVAX', async () => {
        await testE2E(
          tokens.ETH,
          tokens.AVAX,
          holders.ETH,
          '30000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });

      it('WAVAX -> USDT', async () => {
        await testE2E(
          tokens.WAVAX,
          tokens.USDT,
          holders.WAVAX,
          '7000000000000000000',
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
