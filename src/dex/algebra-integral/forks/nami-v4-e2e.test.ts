/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

// Nami pools sit below Velora's production TVL floor while liquidity is being
// seeded, so lower it here only, to exercise pricing against real pools.
jest.mock('../constants', () => ({
  ...jest.requireActual('../constants'),
  MIN_USD_TVL_FOR_PRICING: 0,
}));

import { testE2E } from '../../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../../config';

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

// Amounts are kept small on purpose: the pools are freshly seeded and a
// large trade would run out of range.
describe('NamiV4 E2E', () => {
  const dexKey = 'NamiV4';

  describe('Base', () => {
    testForNetwork(
      Network.BASE,
      dexKey,
      'USDC',
      'WETH',
      '1000000',
      '100000000000000',
      '100000000000000',
    );
  });

  describe('Mainnet', () => {
    testForNetwork(
      Network.MAINNET,
      dexKey,
      'USDC',
      'WETH',
      '1000000',
      '100000000000000',
      '100000000000000',
    );
  });

  describe('Robinhood', () => {
    testForNetwork(
      Network.ROBINHOOD,
      dexKey,
      'USDG',
      'WETH',
      '1000000',
      '100000000000000',
      '100000000000000',
    );
  });
});
