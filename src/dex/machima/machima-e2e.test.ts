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

/*
  Machima E2E (Base mainnet). Uses the Tenderly fork API; add to .env:
    TENDERLY_TOKEN, TENDERLY_ACCOUNT_ID, TENDERLY_PROJECT
    HTTP_PROVIDER_8453=https://...

  MachimaAggregatorRouter is exact-input only, so only SELL
  (swapExactAmountIn) is tested.

  NOTE: XMA -> * swaps require a funded XMA holder. Set Holders[BASE].XMA
  before running the XMA-as-source case.

  Run: npx jest src/dex/machima/machima-e2e.test.ts

  No Tenderly account? See machima-fork-e2e.test.ts — a self-contained anvil
  fork test that executes the same swaps through the real contract stack and
  asserts quoter<->execution parity, with no external services required.
*/

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
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${nativeTokenSymbol} -> ${tokenBSymbol}`, async () => {
              await testE2E(
                tokens[nativeTokenSymbol],
                tokens[tokenBSymbol],
                holders[nativeTokenSymbol],
                nativeTokenAmount,
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
                tokenAAmount,
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
                tokenBAmount,
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

describe('Machima E2E', () => {
  const dexKey = 'Machima';

  describe('Base', () => {
    const network = Network.BASE;

    // tokenA: XMA (the traded token), tokenB: WETH (counter asset).
    const tokenASymbol = 'XMA';
    const tokenBSymbol = 'WETH';

    const tokenAAmount = '1000000000000000000'; // 1 XMA
    const tokenBAmount = '50000000000000000'; // 0.05 WETH
    const nativeTokenAmount = '50000000000000000'; // 0.05 ETH

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
});
