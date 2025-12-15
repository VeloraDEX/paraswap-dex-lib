// TODO

/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { Holders, Tokens } from '../../../tests/constants-e2e';
import { testE2E } from '../../../tests/utils-e2e';
import { generateConfig } from '../../config';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { PoolConfig, PoolKey } from './pools/utils';
import { BI_POWS } from '../../bigint-constants';
import { DEX_KEY, EKUBO_CONFIG } from './config';

describe('Mainnet', () => {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const config = EKUBO_CONFIG[DEX_KEY][network];

  const tokensToTest = [
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
    {
      pair: [
        {
          symbol: 'ETH',
          amount: '1000000000000000',
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
          new PoolConfig(BigInt(config.twamm), 9223372036854775n, 0),
        ).stringId,
      ],
    },
    {
      pair: [
        {
          symbol: 'ETH',
          amount: BI_POWS[16],
        },
        {
          symbol: 'wstETH',
          amount: BI_POWS[16],
        },
      ],
      limitPools: [
        new PoolKey(
          0n,
          BigInt(tokens['wstETH'].address),
          new PoolConfig(BigInt(config.mevCapture), 184467440737096n, 10),
        ).stringId,
      ],
    },
  ];

  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const holders = Holders[network];

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

          tokensToTest.forEach(({ pair: [tokenA, tokenB], limitPools }) => {
            it(`${tokenA.symbol} -> ${tokenB.symbol}`, () =>
              test(
                tokenA.symbol,
                tokenB.symbol,
                String(side === SwapSide.SELL ? tokenA.amount : tokenB.amount),
                side,
                limitPools,
              ));
            it(`${tokenB.symbol} -> ${tokenA.symbol}`, () =>
              test(
                tokenB.symbol,
                tokenA.symbol,
                String(side === SwapSide.SELL ? tokenB.amount : tokenA.amount),
                side,
                limitPools,
              ));
          });
        });
      });
    }),
  );
});
