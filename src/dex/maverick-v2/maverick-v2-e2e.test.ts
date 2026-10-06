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
import { DummyDexHelper } from '../../dex-helper/index';
import { Token } from '../../types';
import { MaverickV2 } from './maverick-v2';

jest.setTimeout(120 * 1000);

/*
  README
  ======

  This test script should add e2e tests for MaverickV2. The tests
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
  tokenB with any two highly liquid tokens on MaverickV2 for the tests
  to work. If the tokens that you would like to use are not defined in
  Tokens or Holders map, you can update the './tests/constants-e2e'

  Other than the standard cases that are already added by the template
  it is highly recommended to add test cases which could be specific
  to testing MaverickV2 (Eg. Tests based on poolType, special tokens,
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

// One initialised dex per network, shared by every test case on that network
const dexByNetwork = new Map<
  Network,
  Promise<{ dex: MaverickV2; blockNumber: number }>
>();

function getInitializedDex(network: Network, dexKey: string) {
  let initialized = dexByNetwork.get(network);
  if (!initialized) {
    initialized = (async () => {
      const dexHelper = new DummyDexHelper(network);
      const dex = new MaverickV2(network, dexKey, dexHelper);
      const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      await dex.initializePricing(blockNumber);
      return { dex, blockNumber };
    })();
    dexByNetwork.set(network, initialized);
  }
  return initialized;
}

// The local SDK prices the first pool of the pair, and pools that can't fill
// the amount price it as 0, so pin the pool with the best full fill
async function bestPoolIdentifiers(
  dex: MaverickV2,
  blockNumber: number,
  srcToken: Token,
  destToken: Token,
  amount: string,
  side: SwapSide,
): Promise<{ [dexKey: string]: string[] }> {
  const poolPrices = await dex.getPricesVolume(
    srcToken,
    destToken,
    [0n, BigInt(amount)],
    side,
    blockNumber,
  );
  const filled = (poolPrices || []).filter(p => p.prices[1] !== 0n);
  expect(filled.length).toBeGreaterThan(0);

  filled.sort((a, b) => {
    const aBetter =
      side === SwapSide.SELL
        ? a.prices[1] > b.prices[1]
        : a.prices[1] < b.prices[1];
    return aBetter ? -1 : 1;
  });

  return { [dex.dexKey]: filled[0].poolIdentifiers! };
}

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
    let dex: MaverickV2;
    let blockNumber: number;

    beforeAll(async () => {
      ({ dex, blockNumber } = await getInitializedDex(network, dexKey));
    });

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
              const amount =
                side === SwapSide.SELL ? tokenAAmount : tokenBAmount;
              const poolIdentifiers = await bestPoolIdentifiers(
                dex,
                blockNumber,
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                amount,
                side,
              );
              await testE2E(
                tokens[tokenASymbol],
                tokens[tokenBSymbol],
                holders[tokenASymbol],
                amount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                poolIdentifiers,
              );
            });
            it(`${tokenBSymbol} -> ${tokenASymbol}`, async () => {
              const amount =
                side === SwapSide.SELL ? tokenBAmount : tokenAAmount;
              const poolIdentifiers = await bestPoolIdentifiers(
                dex,
                blockNumber,
                tokens[tokenBSymbol],
                tokens[tokenASymbol],
                amount,
                side,
              );
              await testE2E(
                tokens[tokenBSymbol],
                tokens[tokenASymbol],
                holders[tokenBSymbol],
                amount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                poolIdentifiers,
              );
            });
          });
        });
      }),
    );
  });
}

describe('MaverickV2 E2E', () => {
  const dexKey = 'MaverickV2';

  const testCases = [
    // The local SDK prices on the state at init time, so prefer pairs that
    // aren't arbitraged every block
    {
      network: Network.BASE,
      tokenASymbol: 'DAI',
      tokenBSymbol: 'USDC',
      tokenAAmount: '100000000000000000000',
      tokenBAmount: '100000000',
    },
    {
      network: Network.ARBITRUM,
      tokenASymbol: 'USDC',
      tokenBSymbol: 'ETH',
      tokenAAmount: '1000000',
      tokenBAmount: '100000000000000000',
    },
    {
      network: Network.BSC,
      tokenASymbol: 'USDC',
      tokenBSymbol: 'USDT',
      tokenAAmount: '100000000',
      tokenBAmount: '100000000',
    },
    {
      network: Network.MAINNET,
      tokenASymbol: 'USDC',
      tokenBSymbol: 'USDS',
      tokenAAmount: '1000000000',
      tokenBAmount: '1000000000000000000000',
    },
    {
      network: Network.MAINNET,
      tokenASymbol: 'ETH',
      tokenBSymbol: 'USDC',
      tokenAAmount: '1000000000000000',
      tokenBAmount: '1000000',
    },
  ];

  testCases.forEach(
    ({ network, tokenAAmount, tokenBAmount, tokenASymbol, tokenBSymbol }) => {
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
    },
  );
});
