/* eslint-disable no-console */
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
            it(`${nativeTokenSymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenBSymbol],
                holders[nativeTokenSymbol],
                side === SwapSide.SELL ? nativeTokenAmount : tokenBAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${tokenBSymbol} -> ${nativeTokenSymbol}`, async () => {
              await testE2E(
                tokens[tokenBSymbol],
                tokens[nativeTokenSymbol],
                holders[tokenBSymbol],
                side === SwapSide.SELL ? tokenBAmount : nativeTokenAmount,
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

describe('TraderJoeV2_1 E2E', () => {
  const dexKey = 'TraderJoeV2_1';

  // describe('Mainnet', () => {
  //   const network = Network.MAINNET;

  //   const tokenASymbol: string = 'USDC';
  //   const tokenBSymbol: string = 'USDT';

  //   const tokenAAmount: string = '10000000';
  //   const tokenBAmount: string = '10000000';
  //   const nativeTokenAmount = '1000000000000000000';

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

  // describe('Arbitrum', () => {
  //   const network = Network.ARBITRUM;

  //   const tokenASymbol: string = 'USDCe';
  //   const tokenBSymbol: string = 'USDT';

  //   const tokenAAmount: string = '10000000';
  //   const tokenBAmount: string = '10000000';
  //   const nativeTokenAmount = '1000000000000000000';

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

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    const tokenASymbol: string = 'USDT';
    const tokenBSymbol: string = 'USDC';

    // const tokenAAmount: string = '10000000';
    // const tokenBAmount: string = '10000000';
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

  // describe('Bsc', () => {
  //   const network = Network.BSC;

  //   const tokenASymbol: string = 'USDT';
  //   const tokenBSymbol: string = 'BUSD';

  //   const tokenAAmount: string = '10000000';
  //   const tokenBAmount: string = '10000000';
  //   const nativeTokenAmount = '1000000000000000000';

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
});
