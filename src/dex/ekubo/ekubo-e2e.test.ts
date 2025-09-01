/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import {
  Holders,
  NativeTokenSymbols,
  Tokens,
} from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { PoolConfig, PoolKey } from './pools/utils';

function testForNetwork(
  network: Network,
  dexKey: string,
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

  const tokensToTest = [
    {
      pair: [
        {
          symbol: 'WBTC',
          amount: '100000000',
        },
        {
          symbol: 'cbBTC',
          amount: '100000000',
        },
      ],
    },
    {
      pair: [
        {
          symbol: nativeTokenSymbol,
          amount: nativeTokenAmount,
        },
        {
          symbol: 'USDC',
          amount: '10000000',
        },
      ],
      // ETH/USDC 0.05% fee TWAMM pool
      limitPools: [
        new PoolKey(
          0n,
          0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n,
          new PoolConfig(
            0,
            9223372036854775n,
            0xd4279c050da1f5c5b2830558c7a08e57e12b54ecn,
          ),
        ).string_id,
      ],
    },
    {
      pair: [
        {
          symbol: 'USDC',
          amount: '10000000',
        },
        {
          symbol: 'USDT',
          amount: '10000000',
        },
      ],
    },
  ];

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            function test(
              srcTokenSymbol: string,
              destTokenSymbol: string,
              amount: string,
              side: SwapSide,
              poolIdentifiers?: string[],
            ) {
              return testE2E(
                tokens[srcTokenSymbol],
                tokens[destTokenSymbol],
                holders[srcTokenSymbol],
                amount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                poolIdentifiers && { [dexKey]: poolIdentifiers },
              );
            }

            tokensToTest.forEach(({ pair: [tokenA, tokenB], limitPools }) => {
              it(`${tokenA.symbol} -> ${tokenB.symbol}`, () =>
                test(
                  tokenA.symbol,
                  tokenB.symbol,
                  side === SwapSide.SELL ? tokenA.amount : tokenB.amount,
                  side,
                  limitPools,
                ));
              it(`${tokenB.symbol} -> ${tokenA.symbol}`, () =>
                test(
                  tokenB.symbol,
                  tokenA.symbol,
                  side === SwapSide.SELL ? tokenB.amount : tokenA.amount,
                  side,
                  limitPools,
                ));
            });
          });
        });
      }),
    );
  });
}

describe('Ekubo E2E', () => {
  const dexKey = 'Ekubo';

  describe('Mainnet', () => {
    const network = Network.MAINNET;
    const nativeTokenAmount = '1000000000000000';

    testForNetwork(network, dexKey, nativeTokenAmount);
  });
});
