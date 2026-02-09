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

function testForNetwork(
  network: Network,
  dexKey: string,
  pairs: { name: string; sellAmount: string; buyAmount: string }[][],
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];

  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        // ContractMethod.simpleSwap,
        // ContractMethod.multiSwap,
        // ContractMethod.megaSwap,
      ],
    ],
    // [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  sideToContractMethods.forEach((contractMethods, side) =>
    describe(`${side}`, () => {
      contractMethods.forEach((contractMethod: ContractMethod) => {
        pairs.forEach(pair => {
          describe(`${contractMethod}`, () => {
            it(`${pair[0].name} -> ${pair[1].name}`, async () => {
              await testE2E(
                tokens[pair[0].name],
                tokens[pair[1].name],
                holders[pair[0].name],
                side === SwapSide.SELL ? pair[0].sellAmount : pair[0].buyAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${pair[1].name} -> ${pair[0].name}`, async () => {
              await testE2E(
                tokens[pair[1].name],
                tokens[pair[0].name],
                holders[pair[1].name],
                side === SwapSide.SELL ? pair[1].sellAmount : pair[1].buyAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        });
      });
    }),
  );
}

describe('SolidlyV3 E2E', () => {
  const dexKey = 'SolidlyV3';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const pairs = [
      [
        {
          name: 'ETH',
          sellAmount: '110000000000000000',
          buyAmount: '1100000000',
        },
        {
          name: 'USDC',
          sellAmount: '400000000',
          buyAmount: '4000000',
        },
      ],
      [
        {
          name: 'WETH',
          sellAmount: '1100000000000000000',
          buyAmount: '1100000000',
        },
        {
          name: 'USDC',
          sellAmount: '400000000',
          buyAmount: '4000000',
        },
      ],
      [
        {
          name: 'USDC',
          sellAmount: '4000000',
          buyAmount: '4000000',
        },
        {
          name: 'USDT',
          sellAmount: '5000000',
          buyAmount: '5000000',
        },
      ],
    ];

    testForNetwork(network, dexKey, pairs);
  });

  describe('Base', () => {
    const network = Network.BASE;

    const pairs = [
      [
        {
          name: NativeTokenSymbols[network],
          sellAmount: '100000000000000', //0.0001 ETH
          buyAmount: '100000000',
        },
        {
          name: 'USDC',
          sellAmount: '1000000', // $1
          buyAmount: '1000000', // $1
        },
      ],
      [
        {
          name: 'USDC',
          sellAmount: '100000',
          buyAmount: '100000',
        },
        {
          name: 'WETH',
          sellAmount: '100000000000000', //0.0001 ETH
          buyAmount: '100000000',
        },
      ],
      [
        {
          name: 'USDC',
          sellAmount: '100000',
          buyAmount: '100000',
        },
        {
          name: 'USDbC',
          sellAmount: '100000',
          buyAmount: '100000',
        },
      ],
    ];

    testForNetwork(network, dexKey, pairs);
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const pairs = [
      [
        {
          name: NativeTokenSymbols[network],
          sellAmount: '10000',
          buyAmount: '1000000000',
        },
        {
          name: 'wstETH',
          sellAmount: '1000000000',
          buyAmount: '1000000000',
        },
      ],
      [
        {
          name: 'USDC',
          sellAmount: '1000000000',
          buyAmount: '1000000000',
        },
        {
          name: 'USDT',
          sellAmount: '100000',
          buyAmount: '1000000000',
        },
      ],
    ];

    testForNetwork(network, dexKey, pairs);
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const pairs = [
      [
        {
          name: NativeTokenSymbols[network],
          sellAmount: '10000000000000',
          buyAmount: '1000000000',
        },
        {
          name: 'USDC',
          sellAmount: '1000000000',
          buyAmount: '1000000000',
        },
      ],
      [
        {
          name: 'USDC',
          sellAmount: '1000000000',
          buyAmount: '1000000000',
        },
        {
          name: 'USDT',
          sellAmount: '100000',
          buyAmount: '1000000000',
        },
      ],
    ];

    testForNetwork(network, dexKey, pairs);
  });
});
