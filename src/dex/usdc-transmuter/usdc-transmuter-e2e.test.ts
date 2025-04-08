/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { gnosisChainUsdcTransmuterTokens } from './constants';

/*
  README
  ======

  This test script should add e2e tests for UsdcTransmuter. The tests
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
  tokenB with any two highly liquid tokens on UsdcTransmuter for the tests
  to work. If the tokens that you would like to use are not defined in
  Tokens or Holders map, you can update the './tests/constants-e2e'

  Other than the standard cases that are already added by the template
  it is highly recommended to add test cases which could be specific
  to testing UsdcTransmuter (Eg. Tests based on poolType, special tokens,
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
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  // Add test tokens to Tokens and Holders if they don't exist
  if (!Tokens[network]) {
    Tokens[network] = {};
  }

  if (!Tokens[network]['USDC']) {
    Tokens[network]['USDC'] = {
      address: gnosisChainUsdcTransmuterTokens.USDC.address,
      decimals: gnosisChainUsdcTransmuterTokens.USDC.decimals,
    };
  }

  if (!Tokens[network]['USDCe']) {
    Tokens[network]['USDCe'] = {
      address: gnosisChainUsdcTransmuterTokens.USDCe.address,
      decimals: gnosisChainUsdcTransmuterTokens.USDCe.decimals,
    };
  }

  // You'll need to add holders for these tokens in your test environment
  if (!Holders[network]) {
    Holders[network] = {};
  }

  // Make sure you have holders defined for your tokens
  if (!Holders[network]['USDC']) {
    console.warn('No holder defined for USDC on Gnosis Chain. Tests may fail.');
  }

  if (!Holders[network]['USDCe']) {
    console.warn(
      'No holder defined for USDCe on Gnosis Chain. Tests may fail.',
    );
  }

  const tokens = Tokens[network];
  const holders = Holders[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
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
                tokenAAmount,
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

describe('UsdcTransmuter E2E', () => {
  const dexKey = 'UsdcTransmuter';

  describe('Gnosis Chain', () => {
    const network = Network.GNOSIS;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDCe';
    const tokenAAmount: string = (10 * 10 ** 6).toString(); // 10 USDC

    testForNetwork(network, dexKey, tokenASymbol, tokenBSymbol, tokenAAmount);
  });
});
