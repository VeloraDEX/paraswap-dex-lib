import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('ETHx', () => {
  const network = Network.MAINNET;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const dexKey = 'Stader';

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
  ]);

  const pairs: { name: string; sellAmount: string; buyAmount: string }[][] = [
    [
      {
        name: 'ETH',
        sellAmount: '1000000000000000000',
        buyAmount: '1000000000000000000',
      },
      {
        name: 'ETHx',
        sellAmount: '1000000000000000000',
        buyAmount: '1000000000000000000',
      },
    ],
    [
      {
        name: 'WETH',
        sellAmount: '1000000000000000000',
        buyAmount: '1000000000000000000',
      },
      {
        name: 'ETHx',
        sellAmount: '1000000000000000000',
        buyAmount: '1000000000000000000',
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
          });
        });
      });
    }),
  );
});
