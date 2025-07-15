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

describe('Spark E2E', () => {
  describe('sDai', () => {
    const dexKey = 'Spark';
    const network = Network.MAINNET;

    const tokenASymbol: string = 'DAI';
    const tokenBSymbol: string = 'sDAI';

    const tokenAAmount: string = '1000000000000000000';
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

  describe('sUSDS', () => {
    const dexKey = 'sUSDS';

    describe('Mainnet', () => {
      const network = Network.MAINNET;

      const tokenASymbol: string = 'USDS';
      const tokenBSymbol: string = 'sUSDS';

      const tokenAAmount: string = '1000000000000000000';
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

  describe('SparkPsm', () => {
    const dexKey = 'SparkPsm';

    describe('Arbitrum', () => {
      const network = Network.ARBITRUM;

      describe('USDS -> sUSDS', () => {
        const tokenASymbol: string = 'USDS';
        const tokenBSymbol: string = 'sUSDS';

        const tokenAAmount: string = '1000000000000000000';
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

      describe('USDS -> USDC', () => {
        const tokenASymbol: string = 'USDS';
        const tokenBSymbol: string = 'USDC';

        const tokenAAmount: string = '1000000000000000000';
        const tokenBAmount: string = '1000000';

        testForNetwork(
          network,
          dexKey,
          tokenASymbol,
          tokenBSymbol,
          tokenAAmount,
          tokenBAmount,
        );
      });

      describe('USDC -> sUSDS', () => {
        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'sUSDS';

        const tokenAAmount: string = '1000000';
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

      describe('USDS -> sUSDS', () => {
        const tokenASymbol: string = 'USDS';
        const tokenBSymbol: string = 'sUSDS';

        const tokenAAmount: string = '1000000000000000000';
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

      describe('USDS -> USDC', () => {
        const tokenASymbol: string = 'USDS';
        const tokenBSymbol: string = 'USDC';

        const tokenAAmount: string = '1000000000000000000';
        const tokenBAmount: string = '1000000';

        testForNetwork(
          network,
          dexKey,
          tokenASymbol,
          tokenBSymbol,
          tokenAAmount,
          tokenBAmount,
        );
      });

      describe('USDC -> sUSDS', () => {
        const tokenASymbol: string = 'USDC';
        const tokenBSymbol: string = 'sUSDS';

        const tokenAAmount: string = '1000000';
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
});
