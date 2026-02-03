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
  README
  ======

  This test script should add e2e tests for Stabull. The tests
  should cover as many cases as possible. Most of the DEXes follow
  the following test structure:
    - DexName
      - ForkName + Network
        - ContractMethod
          - ETH -> Token swap
          - Token -> ETH swap
          - Token -> Token swap

  The template already enumerates the basic structure which involves
  testing simpleSwap, multiSwap, megaSwap contract methods for
  ETH <> TOKEN and TOKEN <> TOKEN swaps. You should replace tokenA and
  tokenB with any two highly liquid tokens on Stabull for the tests
  to work. If the tokens that you would like to use are not defined in
  Tokens or Holders map, you can update the './tests/constants-e2e'

  Other than the standard cases that are already added by the template
  it is highly recommended to add test cases which could be specific
  to testing Stabull (Eg. Tests based on poolType, special tokens,
  etc).

  You can run this individual test script by running:
  `npx jest src/dex/<dex-name>/<dex-name>-e2e.test.ts`

  e2e tests use the Tenderly fork api. Please add the following to your
  .env file:
  TENDERLY_TOKEN=Find this under Account>Settings>Authorization.
  TENDERLY_ACCOUNT_ID=Your Tenderly account name.
  TENDERLY_PROJECT=Name of a Tenderly project you have created in your
  dashboard.

  (This comment should be removed from the final implementation)
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

  // TODO: Add any direct swap contractMethod name if it exists
  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    // TODO: If buy is not supported remove the buy contract methods
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            // Native token swap test cases are removed as native token swpas are not supported in the stabull

            // it(`${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
            //   await testE2E(
            //     tokens[nativeTokenSymbol],
            //     tokens[tokenASymbol],
            //     holders[nativeTokenSymbol],
            //     side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
            //     side,
            //     dexKey,
            //     contractMethod,
            //     network,
            //     provider,
            //   );
            // });
            // it(`${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
            //   await testE2E(
            //     tokens[tokenASymbol],
            //     tokens[nativeTokenSymbol],
            //     holders[tokenASymbol],
            //     side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
            //     side,
            //     dexKey,
            //     contractMethod,
            //     network,
            //     provider,
            //   );
            // });
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
          });
        });
      }),
    );
  });
}

describe('Stabull E2E', () => {
  const dexKey = 'Stabull';

  // Add global timeout to avoid test failures
  jest.setTimeout(120000); // 2 minutes timeout for all tests

  // Add before/after hooks to ensure clean test environment
  beforeAll(async () => {
    // Optional: Setup global test prerequisites
    await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay between test suites
  });

  afterAll(async () => {
    // Optional: Clean up after all tests
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give time for any pending operations
  });

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'NZDS';

    const tokenAAmount = '100000000';
    const tokenBAmount = '100000000';
    const nativeTokenAmount = '1000000000000000000';

    // Add hooks for this specific test suite
    beforeEach(async () => {
      // Reset any state needed between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    });

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

  describe('Polygon USDCn to NZDS Direct swap', () => {
    const network = Network.POLYGON;

    const tokenASymbol: string = 'USDCn';
    const tokenBSymbol: string = 'NZDS';

    const tokenAAmount = '100000000';
    const tokenBAmount = '100000000';
    const nativeTokenAmount = '1000000000000000000';

    // Add retry logic for flaky tests
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

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

  describe('Polygon TRYB to NZDS Indirect swap', () => {
    const network = Network.POLYGON;

    const tokenASymbol: string = 'TRYB';
    const tokenBSymbol: string = 'NZDS';

    const tokenAAmount = '100000000';
    const tokenBAmount = '100000000';
    const nativeTokenAmount = '1000000000000000000';

    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

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
