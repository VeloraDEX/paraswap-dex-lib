/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { Holders, Tokens } from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { DEX_KEY } from './config';

describe('Mainnet', () => {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const holders = Holders[network];

  const pairsToTest = [
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
  ];

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

          pairsToTest.forEach(({ pair: [tokenA, tokenB] }) => {
            it(`${tokenA.symbol} -> ${tokenB.symbol}`, () =>
              test(
                tokenA.symbol,
                tokenB.symbol,
                String(side === SwapSide.SELL ? tokenA.amount : tokenB.amount),
                side,
              ));
            it(`${tokenB.symbol} -> ${tokenA.symbol}`, () =>
              test(
                tokenB.symbol,
                tokenA.symbol,
                String(side === SwapSide.SELL ? tokenB.amount : tokenA.amount),
                side,
              ));
          });
        });
      });
    }),
  );
});
