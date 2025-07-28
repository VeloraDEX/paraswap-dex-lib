/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
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
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
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
                500,
                undefined,
                undefined,
                50,
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
                500,
                undefined,
                undefined,
                50,
              );
            });
          });
        });
      }),
    );
  });
}

describe('UniswapV4 E2E', () => {
  const dexKey = 'UniswapV4';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    describe('ETH -> USDC', () => {
      const tokenASymbol: string = 'ETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '5000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('WETH -> USDC', () => {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('USDC -> DAI', () => {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'DAI';

      const tokenAAmount: string = '10000000';
      const tokenBAmount: string = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Base', () => {
    const network = Network.BASE;

    describe('ETH -> USDC', () => {
      const tokenASymbol: string = 'ETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '100000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('WETH -> USDC', () => {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('USDC -> USDbC', () => {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'USDbC';

      const tokenAAmount: string = '10000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    describe('ETH -> USDC', () => {
      const tokenASymbol: string = 'ETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('DAI -> USDT', () => {
      const tokenASymbol: string = 'DAI';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    describe('ETH -> USDC', () => {
      const tokenASymbol: string = 'ETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;

    describe('MATIC -> USDCe', () => {
      const tokenASymbol: string = 'MATIC';
      const tokenBSymbol: string = 'USDCe';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('USDCe -> USDCn', () => {
      const tokenASymbol: string = 'USDCe';
      const tokenBSymbol: string = 'USDCn';

      const tokenAAmount: string = '3195795';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    describe('AVAX -> USDC', () => {
      const tokenASymbol: string = 'AVAX';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('BSC', () => {
    const network = Network.BSC;

    describe('BNB -> USDT', () => {
      const tokenASymbol: string = 'BNB';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '100000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Unichain', () => {
    const network = Network.UNICHAIN;

    describe('ETH -> USDC', () => {
      const tokenASymbol: string = 'ETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '100000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('WETH -> USDC', () => {
      const tokenASymbol: string = 'WETH';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '10000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('USDC -> DAI', () => {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'DAI';

      const tokenAAmount: string = '10000000';
      const tokenBAmount: string = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });
});
