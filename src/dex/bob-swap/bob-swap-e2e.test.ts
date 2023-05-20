/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

/*
  README
  ======

  This test script should add e2e tests for BobSwap. The tests
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
  tokenB with any two highly liquid tokens on BobSwap for the tests
  to work. If the tokens that you would like to use are not defined in
  Tokens or Holders map, you can update the './tests/constants-e2e'

  Other than the standard cases that are already added by the template
  it is highly recommended to add test cases which could be specific
  to testing BobSwap (Eg. Tests based on poolType, special tokens,
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
  bobTokenAmount: string,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const bobTokenSymbol = 'BOB';

  // TODO: Add any direct swap contractMethod name if it exists
  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.simpleSwap,
        // ContractMethod.multiSwap,
        // ContractMethod.megaSwap,
      ],
    ],
    // TODO: If buy is not supported remove the buy contract methods
    // [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${bobTokenSymbol} -> ${tokenASymbol}`, async () => {
              await testE2E(
                tokens[bobTokenSymbol],
                tokens[tokenASymbol],
                holders[bobTokenSymbol],
                side === SwapSide.SELL ? bobTokenAmount : tokenAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            // it(`${tokenASymbol} -> ${bobTokenSymbol}`, async () => {
            //   await testE2E(
            //     tokens[tokenASymbol],
            //     tokens[bobTokenSymbol],
            //     holders[tokenASymbol],
            //     side === SwapSide.SELL ? tokenAAmount : bobTokenAmount,
            //     side,
            //     dexKey,
            //     contractMethod,
            //     network,
            //     provider,
            //   );
            // });
            // it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
            //   await testE2E(
            //     tokens[tokenASymbol],
            //     tokens[tokenBSymbol],
            //     holders[tokenASymbol],
            //     side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
            //     side,
            //     dexKey,
            //     contractMethod,
            //     network,
            //     provider,
            //   );
            // });
          });
        });
      }),
    );
  });
}

describe('BobSwap E2E', () => {
  const dexKey = 'BobSwap';

  describe('Polygon', () => {
    const network = Network.POLYGON;

    // TODO: Modify the tokenASymbol, tokenBSymbol, tokenAAmount;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '1000000000000000000000';
    const tokenBAmount: string = '1000000000000000000000';
    const bobTokenAmount = '1000000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      bobTokenAmount,
    );

    // TODO: Add any additional test cases required to test BobSwap
  });
});
