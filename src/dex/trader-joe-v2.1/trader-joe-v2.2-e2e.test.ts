import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Tokens,
  Holders,
  NativeTokenSymbols,
} from '../../../tests/constants-e2e';

import { ContractMethod, Network, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

const dexKey = 'traderjoev2.2';

const testForNetwork = (
  network: Network,
  swapMap: Map<SwapSide, ContractMethod[]>,
) => {
  const tokens = Tokens[network];
  const holders = Holders[network];

  const nativeSymbol = NativeTokenSymbols[network];

  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  const tokensToTest = [
    [
      {
        symbol: 'USDC',
        amount: (10 ** 8).toString(),
      },
      {
        symbol: 'USDT',
        amount: (10 ** 8).toString(),
      },
    ],
    [
      {
        symbol: 'USDT',
        amount: (10 ** 8).toString(),
      },
      {
        symbol: 'DAI',
        amount: (10 ** 8).toString(),
      },
    ],
  ];

  swapMap.forEach((contractMethods, side) =>
    contractMethods.forEach((contractMethod: string) => {
      tokensToTest.forEach(pair => {
        describe(`${contractMethod}`, () => {
          it(`${pair[0].symbol} -> ${pair[1].symbol}`, async () => {
            await testE2E(
              tokens[pair[0].symbol],
              tokens[pair[1].symbol],
              holders[pair[0].symbol],
              side === SwapSide.SELL ? pair[0].amount : pair[1].amount,
              side,
              dexKey,
              contractMethod as any,
              network,
              provider,
            );
          });

          it(`${nativeSymbol} -> ${pair[0].symbol}`, async () => {
            await testE2E(
              tokens[nativeSymbol],
              tokens[pair[0].symbol],
              holders[nativeSymbol],
              side === SwapSide.SELL ? '1000000000000000000' : pair[0].amount,
              side,
              dexKey,
              contractMethod as any,
              network,
              provider,
            );
          });
        });
      });
    }),
  );
};

// Ensure you have the E2E_ENDPOINT_URL env variable set.

describe('TraderJoe v2.2 E2E', () => {
  describe('Avalanche', () => {
    const swapMap = new Map<SwapSide, ContractMethod[]>([
      [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    ]);

    testForNetwork(Network.AVALANCHE, swapMap);
  });
});
