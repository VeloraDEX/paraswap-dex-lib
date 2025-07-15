import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import {
  Holders,
  NativeTokenSymbols,
  Tokens,
} from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';

// Give time for rate fetcher to fill the cache
const sleepMs = 7000;

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

describe('Hashflow E2E', () => {
  const dexKey = 'Hashflow';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    describe('USDC -> USDT', () => {
      const tokenASymbol: string = 'USDT';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '100000000';
      const tokenBAmount: string = '100000000';
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

    // describe('DAI -> USDC', () => {
    //   const tokenASymbol: string = 'DAI';
    //   const tokenBSymbol: string = 'USDC';
    //
    //   const tokenAAmount: string = '100000000000000000000';
    //   const tokenBAmount: string = '100000000';
    //   const nativeTokenAmount = '1000000000000000000';
    //
    //   testForNetwork(
    //     network,
    //     dexKey,
    //     tokenASymbol,
    //     tokenBSymbol,
    //     tokenAAmount,
    //     tokenBAmount,
    //     nativeTokenAmount,
    //   );
    // });
    //
    // describe('WETH -> USDC', () => {
    //   const tokenASymbol: string = 'WETH';
    //   const tokenBSymbol: string = 'USDC';
    //
    //   const tokenAAmount: string = '100000000000000000';
    //   const tokenBAmount: string = '1000000';
    //   const nativeTokenAmount = '100000000000000000';
    //
    //   testForNetwork(
    //     network,
    //     dexKey,
    //     tokenASymbol,
    //     tokenBSymbol,
    //     tokenAAmount,
    //     tokenBAmount,
    //     nativeTokenAmount,
    //     true,
    //   );
    // });
  });
  describe('Polygon', () => {
    const network = Network.POLYGON;

    const tokenASymbol: string = 'USDCn';
    const tokenBSymbol: string = 'TRYB';

    const tokenAAmount: string = '1000000';
    const tokenBAmount: string = '1000000';
    const nativeTokenAmount = '100000000000000000000';

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
  describe('BSC', () => {
    const network = Network.BSC;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDT';

    const tokenAAmount: string = '10000000';
    const tokenBAmount: string = '10000000';
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
  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const tokenASymbol: string = 'ETH';
    const tokenBSymbol: string = 'DAI';

    const tokenAAmount: string = '300000000000000000';
    const tokenBAmount: string = '100000000000000000000';
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
  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const tokenASymbol: string = 'OP';
    const tokenBSymbol: string = 'USDT';

    const tokenAAmount: string = '12000000000000000000';
    const tokenBAmount: string = '11000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      '0',
      true,
    );
  });
  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    const tokenASymbol: string = 'USDT';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '1100000';
    const tokenBAmount: string = '1100000';
    const nativeTokenAmount = '0';

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
  describe('Base', () => {
    const network = Network.BASE;

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '1000000000000000';
    const tokenBAmount: string = '4000000';
    const nativeTokenAmount = '0';

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
