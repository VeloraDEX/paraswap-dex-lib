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

  console.log(
    `🧪 Testing ${dexKey} on ${network}: ${tokenASymbol} <-> ${tokenBSymbol}`,
  );
  console.log(
    ` Amounts: ${tokenASymbol}=${tokenAAmount}, ${tokenBSymbol}=${tokenBAmount}, ${nativeTokenSymbol}=${nativeTokenAmount}`,
  );

  // Cover all contract methods and both sides
  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [ContractMethod.swapExactAmountIn, ContractMethod.simpleSwap],
    ],
    [
      SwapSide.BUY,
      [ContractMethod.swapExactAmountOut, ContractMethod.simpleBuy],
    ],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
              console.log(
                `🧪 Testing: ${nativeTokenSymbol} -> ${tokenASymbol}`,
              );
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
              console.log(` Testing: ${tokenASymbol} -> ${nativeTokenSymbol}`);
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
              console.log(` Testing: ${tokenASymbol} -> ${tokenBSymbol}`);
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
              console.log(` Testing: ${tokenBSymbol} -> ${tokenASymbol}`);
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

// Define standard test amounts for each token type
/**
 * Utility to convert a human-readable amount to a string representing the integer value
 * according to the token's decimals.
 *
 * @param value - The human-readable value (e.g., 1, 0.1, 10)
 * @param decimals - The number of decimals for the token (e.g., 6, 8, 18)
 * @returns The string representation of the integer value for on-chain usage
 */
const toAmount = (value: number, decimals: number): string => {
  // Use BigInt for safe integer math, avoid floating point issues
  const [whole, fraction = ''] = value.toString().split('.');
  const paddedFraction = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(paddedFraction)
  ).toString();
};

// You can now easily adjust the human-readable values here:
const AMOUNT_ERC20 = toAmount(1, 18); // 1 unit for 18-decimal tokens (e.g., KET, WINK, other memes)
const AMOUNT_USD = toAmount(1, 6); // 1 unit for 6-decimal tokens (e.g., USDC, USDT)
const AMOUNT_BTC = toAmount(0.000001, 8); // 1 unit for 8-decimal tokens (e.g., BTCb)
const AMOUNT_ERC314_BTC = toAmount(0.000001, 18); // 1 unit for 18-decimal tokens (e.g., BTCb)
const AMOUNT_ERC314 = toAmount(10, 18); // 10 units for 18-decimal tokens (e.g., APEX, aUSDC, aUSDT, BENSI)
const AMOUNT_AVAX = toAmount(0.01, 18); // 0.01 AVAX (18 decimals)

describe('ApexDefi E2E', () => {
  const network = Network.AVALANCHE;
  const dexKey = 'ApexDefi';

  // Test Suite 1: Direct AVAX Pairs
  describe('Direct AVAX Pairs', () => {
    const directPairs = [
      ['USDC', 'USDT', AMOUNT_USD, AMOUNT_USD],
      ['USDC', 'APEX', AMOUNT_USD, AMOUNT_ERC314],
      ['USDT', 'APEX', AMOUNT_USD, AMOUNT_ERC314],
    ];

    directPairs.forEach(([tokenA, tokenB, amountA, amountB]) => {
      testForNetwork(
        network,
        dexKey,
        tokenA,
        tokenB,
        amountA,
        amountB,
        AMOUNT_AVAX,
      );
    });
  });

  // Test Suite 2: Cross-Pair ERC314 Swaps
  describe('Cross-Pair ERC314 Swaps', () => {
    const crossPairs = [
      ['APEX', 'aUSDC', AMOUNT_ERC314, AMOUNT_ERC314],
      ['APEX', 'BENSI', AMOUNT_ERC314, AMOUNT_ERC314],
      ['APEX', 'awUSDT', AMOUNT_ERC314, AMOUNT_ERC314],
      ['aUSDC', 'awUSDT', AMOUNT_ERC314, AMOUNT_ERC314],
      ['aBTCb', 'awUSDT', AMOUNT_ERC314_BTC, AMOUNT_ERC314],
    ];

    crossPairs.forEach(([tokenA, tokenB, amountA, amountB]) => {
      testForNetwork(
        network,
        dexKey,
        tokenA,
        tokenB,
        amountA,
        amountB,
        AMOUNT_AVAX,
      );
    });
  });

  // Test Suite 3: Wrapper Operations
  describe('Wrapper Operations', () => {
    const wrapperPairs = [
      ['USDC', 'aUSDC', AMOUNT_USD, AMOUNT_ERC314],
      ['USDT', 'awUSDT', AMOUNT_USD, AMOUNT_ERC314],
      ['BTCb', 'aBTCb', AMOUNT_BTC, AMOUNT_ERC314_BTC],
    ];

    wrapperPairs.forEach(([tokenA, tokenB, amountA, amountB]) => {
      testForNetwork(
        network,
        dexKey,
        tokenA,
        tokenB,
        amountA,
        amountB,
        AMOUNT_AVAX,
      );
    });
  });
});
