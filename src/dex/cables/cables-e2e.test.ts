import dotenv from 'dotenv';
dotenv.config();
import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

const sleepMs: number = 10000;
const slippage: number = 100;

describe('Cables E2E', () => {
  const dexKey = 'Cables';

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    // [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );
    const tokens = Tokens[network];
    const holders = Holders[network];

    const pairs: { name: string; sellAmount: string; buyAmount: string }[][] = [
      [
        {
          name: 'USDC',
          sellAmount: '50000000000000',
          buyAmount: '700000',
        },
        {
          name: 'USDT',
          sellAmount: '600000',
          buyAmount: '850000',
        },
      ],
      // [
      //   {
      //     name: 'WETH',
      //     sellAmount: '100000000000000000',
      //     buyAmount: '200000000000000000',
      //   },
      //   {
      //     name: 'USDT',
      //     sellAmount: '6000000',
      //     buyAmount: '8000000',
      //   },
      // ],
    ];

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          pairs.forEach(pair => {
            describe(`${contractMethod}`, () => {
              it(`${pair[0].name} -> ${pair[1].name}`, async () => {
                await testE2E(
                  side === SwapSide.SELL
                    ? tokens[pair[0].name]
                    : tokens[pair[1].name],
                  side === SwapSide.SELL
                    ? tokens[pair[1].name]
                    : tokens[pair[0].name],
                  side === SwapSide.SELL
                    ? holders[pair[0].name]
                    : holders[pair[1].name],
                  side === SwapSide.SELL
                    ? pair[0].sellAmount
                    : pair[0].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  undefined,
                  undefined,
                  undefined,
                  slippage,
                  sleepMs,
                );
              });
              // it(`${pair[1].name} -> ${pair[0].name}`, async () => {
              //   await testE2E(
              //     side === SwapSide.SELL
              //       ? tokens[pair[1].name]
              //       : tokens[pair[0].name],
              //     side === SwapSide.SELL
              //       ? tokens[pair[0].name]
              //       : tokens[pair[1].name],
              //     side === SwapSide.SELL
              //       ? holders[pair[1].name]
              //       : holders[pair[0].name],
              //     side === SwapSide.SELL
              //       ? pair[1].sellAmount
              //       : pair[1].buyAmount,
              //     side,
              //     dexKey,
              //     contractMethod,
              //     network,
              //     provider,
              //     undefined,
              //     undefined,
              //     undefined,
              //     slippage,
              //     sleepMs,
              //   );
              // });
            });
          });
        });
      }),
    );
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );
    const tokens = Tokens[network];
    const holders = Holders[network];

    const pairs: { name: string; sellAmount: string; buyAmount: string }[][] = [
      [
        {
          name: 'USDC',
          sellAmount: '1000000',
          buyAmount: '700000',
        },
        {
          name: 'USDT',
          sellAmount: '1000000',
          buyAmount: '850000',
        },
      ],
    ];

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          pairs.forEach(pair => {
            describe(`${contractMethod}`, () => {
              it(`${pair[0].name} -> ${pair[1].name}`, async () => {
                await testE2E(
                  side === SwapSide.SELL
                    ? tokens[pair[0].name]
                    : tokens[pair[1].name],
                  side === SwapSide.SELL
                    ? tokens[pair[1].name]
                    : tokens[pair[0].name],
                  side === SwapSide.SELL
                    ? holders[pair[0].name]
                    : holders[pair[1].name],
                  side === SwapSide.SELL
                    ? pair[0].sellAmount
                    : pair[0].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  undefined,
                  undefined,
                  undefined,
                  slippage,
                  sleepMs,
                );
              });
              it(`${pair[1].name} -> ${pair[0].name}`, async () => {
                await testE2E(
                  side === SwapSide.SELL
                    ? tokens[pair[1].name]
                    : tokens[pair[0].name],
                  side === SwapSide.SELL
                    ? tokens[pair[0].name]
                    : tokens[pair[1].name],
                  side === SwapSide.SELL
                    ? holders[pair[1].name]
                    : holders[pair[0].name],
                  side === SwapSide.SELL
                    ? pair[1].sellAmount
                    : pair[1].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  undefined,
                  undefined,
                  undefined,
                  slippage,
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
