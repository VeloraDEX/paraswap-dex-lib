import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

type Pairs = { name: string; sellAmount: string; buyAmount: string }[][];

function testForNetwork(network: Network, dexKey: string, pairs: Pairs) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
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

describe('Clear E2E', () => {
  const dexKey = 'Clear';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const pairs: Pairs = [
      [
        {
          name: 'USDC',
          sellAmount: '1000000000', // 1000 USDC (6 decimals)
          buyAmount: '1000000000',
        },
        {
          name: 'GHO',
          sellAmount: '1000000000000000000000', // 1000 GHO (18 decimals)
          buyAmount: '1000000000000000000000',
        },
      ],
      // Add more pairs here as new stablecoins are integrated:
      // [
      //   { name: 'USDT', sellAmount: '...', buyAmount: '...' },
      //   { name: 'GHO', sellAmount: '...', buyAmount: '...' },
      // ],
    ];

    testForNetwork(network, dexKey, pairs);
  });
});
