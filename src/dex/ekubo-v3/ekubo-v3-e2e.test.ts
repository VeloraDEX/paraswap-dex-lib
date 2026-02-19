/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { Holders, Tokens } from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { DEX_KEY, EkuboSupportedNetwork } from './config';

const testConfigs: Record<
  EkuboSupportedNetwork,
  {
    tokensToTest: Array<{
      pair: [
        { symbol: string; amount: bigint },
        { symbol: string; amount: bigint },
      ];
      limitPools?: string[];
    }>;
  }
> = {
  [Network.MAINNET]: {
    tokensToTest: [
      {
        pair: [
          {
            symbol: 'USDC',
            amount: BI_POWS[5],
          },
          {
            symbol: 'USDT',
            amount: BI_POWS[5],
          },
        ],
      },
      {
        pair: [
          {
            symbol: 'USDC',
            amount: BI_POWS[6],
          },
          {
            symbol: 'EKUBO',
            amount: BI_POWS[18],
          },
        ],
        limitPools: [
          'ekubov3_0x04c46e830bb56ce22735d5d8fc9cb90309317d0f_0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48_0xd4b54d0ca6979da05f25895e6e269e678ba00f9e_184467440737095516_concentrated_19802',
        ],
      },
    ],
  },
  [Network.ARBITRUM]: {
    tokensToTest: [
      {
        pair: [
          {
            symbol: 'ETH',
            amount: BI_POWS[18],
          },
          {
            symbol: 'USDC',
            amount: BI_POWS[8],
          },
        ],
      },
    ],
  },
};

Object.entries(testConfigs).forEach(([networkStr, config]) => {
  const network = Number(networkStr);

  describe(generateConfig(network).networkName, () => {
    const tokens = Tokens[network];
    const holders = Holders[network];

    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const sideToContractMethods = new Map([
      [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
      [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
    ]);

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
                DEX_KEY,
                contractMethod,
                network,
                provider,
                poolIdentifiers && { [DEX_KEY]: poolIdentifiers },
              );
            }

            config.tokensToTest.forEach(
              ({ pair: [tokenA, tokenB], limitPools }) => {
                it(`${tokenA.symbol} -> ${tokenB.symbol}`, () =>
                  test(
                    tokenA.symbol,
                    tokenB.symbol,
                    String(
                      side === SwapSide.SELL ? tokenA.amount : tokenB.amount,
                    ),
                    side,
                    limitPools,
                  ));

                it(`${tokenB.symbol} -> ${tokenA.symbol}`, () =>
                  test(
                    tokenB.symbol,
                    tokenA.symbol,
                    String(
                      side === SwapSide.SELL ? tokenB.amount : tokenA.amount,
                    ),
                    side,
                    limitPools,
                  ));
              },
            );
          });
        });
      }),
    );
  });
});
