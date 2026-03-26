/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Tokens } from '../../../tests/constants-e2e';
import { testInsertAmounts } from '../../../tests/utils-insert-amounts';
import { ContractMethod, Network, SwapSide } from '../../constants';

const dexKey = 'Native';

// Wait for orderbook to be fetched
const sleepMs = 2000;

const testConfigs: Partial<
  Record<
    Network,
    {
      tokensToTest: Array<{
        pair: [
          { symbol: string; amount: string },
          { symbol: string; amount: string },
        ];
      }>;
    }
  >
> = {
  [Network.MAINNET]: {
    tokensToTest: [
      {
        pair: [
          { symbol: 'USDC', amount: '100000000' },
          { symbol: 'WETH', amount: '1000000000000000' },
        ],
      },
    ],
  },
  [Network.ARBITRUM]: {
    tokensToTest: [
      {
        pair: [
          { symbol: 'USDT', amount: '100000000' },
          { symbol: 'WETH', amount: '1000000000000000' },
        ],
      },
    ],
  },
};

Object.entries(testConfigs).forEach(([networkStr, config]) => {
  const network = Number(networkStr) as Network;
  const tokens = Tokens[network];

  describe(`Native Insert Amounts [${network}]`, () => {
    // Native DEX only supports SELL side
    const sideToContractMethods = new Map([
      [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            config!.tokensToTest.forEach(({ pair: [tokenA, tokenB] }) => {
              it(`${tokenA.symbol} -> ${tokenB.symbol}`, async () => {
                await testInsertAmounts(
                  tokens[tokenA.symbol],
                  tokens[tokenB.symbol],
                  side === SwapSide.SELL ? tokenA.amount : tokenB.amount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  undefined,
                  undefined,
                  sleepMs,
                );
              });
            });
          });
        });
      }),
    );
  });
});
