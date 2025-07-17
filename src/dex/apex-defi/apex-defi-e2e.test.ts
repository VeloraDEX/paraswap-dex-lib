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

  // Cover all contract methods and both sides
  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        ContractMethod.simpleSwap,
        ContractMethod.multiSwap,
        ContractMethod.megaSwap,
      ],
    ],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut, ContractMethod.buy]],
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

const AMOUNT_ERC20 = '10000000'; // 10 units for 6-decimal tokens (e.g., USDC, USDT)
const AMOUNT_ERC314 = '100000000000000000000'; // 100 units for 18-decimal tokens (e.g., APEX, aUSDC, aUSDT)
const AMOUNT_AVAX = '100000000000000000'; // 0.1 AVAX (18 decimals)

describe('ApexDefi E2E', () => {
  const network = Network.AVALANCHE;
  const dexKey = 'ApexDefi';

  // Replace hardcoded values with constants
  const combos = [
    // ERC20 <-> ERC20
    ['USDC', 'USDT', AMOUNT_ERC20, AMOUNT_ERC20, AMOUNT_AVAX],
    // ERC20 <-> ERC314
    ['USDC', 'APEX', AMOUNT_ERC20, AMOUNT_ERC314, AMOUNT_AVAX],
    ['USDT', 'APEX', AMOUNT_ERC20, AMOUNT_ERC314, AMOUNT_AVAX],
    // ERC314 <-> ERC314
    ['APEX', 'aUSDC', AMOUNT_ERC314, AMOUNT_ERC314, AMOUNT_AVAX],
    ['APEX', 'aUSDT', AMOUNT_ERC314, AMOUNT_ERC314, AMOUNT_AVAX],
    ['aUSDC', 'aUSDT', AMOUNT_ERC314, AMOUNT_ERC314, AMOUNT_AVAX],
    // AVAX <-> ERC20
    ['AVAX', 'USDC', AMOUNT_AVAX, AMOUNT_ERC20, AMOUNT_AVAX],
    ['AVAX', 'USDT', AMOUNT_AVAX, AMOUNT_ERC20, AMOUNT_AVAX],
    // AVAX <-> ERC314
    ['AVAX', 'APEX', AMOUNT_AVAX, AMOUNT_ERC314, AMOUNT_AVAX],
    ['AVAX', 'aUSDC', AMOUNT_AVAX, AMOUNT_ERC314, AMOUNT_AVAX],
    ['AVAX', 'aUSDT', AMOUNT_AVAX, AMOUNT_ERC314, AMOUNT_AVAX],
  ];

  combos.forEach(
    ([tokenA, tokenB, tokenAAmount, tokenBAmount, nativeTokenAmount]) => {
      testForNetwork(
        network,
        dexKey,
        tokenA as string,
        tokenB as string,
        tokenAAmount as string,
        tokenBAmount as string,
        nativeTokenAmount as string,
      );
    },
  );
});
