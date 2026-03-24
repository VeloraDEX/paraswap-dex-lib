/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Tokens } from '../../../tests/constants-e2e';
import { testInsertAmounts } from '../../../tests/utils-insert-amounts';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { DEX_KEY, EkuboSupportedNetwork } from './config';

const testConfigs: Partial<
  Record<
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
  >
> = {
  [Network.MAINNET]: {
    tokensToTest: [
      {
        pair: [
          { symbol: 'USDC', amount: BI_POWS[5] },
          { symbol: 'USDT', amount: BI_POWS[5] },
        ],
      },
    ],
  },
};

Object.entries(testConfigs).forEach(([networkStr, config]) => {
  const network = Number(networkStr) as Network;
  const tokens = Tokens[network];

  describe(`EkuboV3 Insert Amounts [${network}]`, () => {
    const sideToContractMethods = new Map([
      // [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
      [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            config.tokensToTest.forEach(
              ({ pair: [tokenA, tokenB], limitPools }) => {
                it(`${tokenA.symbol} -> ${tokenB.symbol}`, async () => {
                  await testInsertAmounts(
                    tokens[tokenA.symbol],
                    tokens[tokenB.symbol],
                    String(
                      side === SwapSide.SELL ? tokenA.amount : tokenB.amount,
                    ),
                    side,
                    DEX_KEY,
                    contractMethod,
                    network,
                    limitPools && { [DEX_KEY]: limitPools },
                  );
                });

                it.skip(`${tokenB.symbol} -> ${tokenA.symbol}`, async () => {
                  await testInsertAmounts(
                    tokens[tokenB.symbol],
                    tokens[tokenA.symbol],
                    String(
                      side === SwapSide.SELL ? tokenB.amount : tokenA.amount,
                    ),
                    side,
                    DEX_KEY,
                    contractMethod,
                    network,
                    limitPools && { [DEX_KEY]: limitPools },
                  );
                });
              },
            );
          });
        });
      }),
    );
  });
});
