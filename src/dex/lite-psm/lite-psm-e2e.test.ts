import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('LitePsm E2E', () => {
  const dexKey = 'LitePsm';

  describe('LitePsm DAI', () => {
    const network = Network.MAINNET;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'DAI';

    const tokenAAmount: string = '10000000';
    const tokenBAmount: string = '10000000000000000';

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.swapExactAmountIn,
          ContractMethod.swapExactAmountInOutOnMakerPSM,
        ],
      ],
      [
        SwapSide.BUY,
        [
          ContractMethod.swapExactAmountOut,
          ContractMethod.swapExactAmountInOutOnMakerPSM,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it(`${side}:${tokenASymbol} -> ${tokenBSymbol}`, async () => {
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

          it(`${side}:${tokenBSymbol} -> ${tokenASymbol}`, async () => {
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
      }),
    );
  });

  describe('LitePsm USDS', () => {
    const network = Network.MAINNET;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDS';

    const tokenAAmount: string = '10000000';
    const tokenBAmount: string = '10000000000000000';

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.swapExactAmountIn,
          ContractMethod.swapExactAmountInOutOnMakerPSM,
        ],
      ],
      [
        SwapSide.BUY,
        [
          ContractMethod.swapExactAmountOut,
          ContractMethod.swapExactAmountInOutOnMakerPSM,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it(`${side}:${tokenASymbol} -> ${tokenBSymbol}`, async () => {
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

          it(`${side}:${tokenBSymbol} -> ${tokenASymbol}`, async () => {
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
      }),
    );
  });
});
