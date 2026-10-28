/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

// Orbital pools hold three ERC-20 stablecoins and no native token: every case is token -> token, through
// swapExactInput (SELL) and swapExactOutput (BUY) on the pool.
function testForNetwork(
  network: Network,
  dexKey: string,
  pairs: [string, string, string, string][],
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            pairs.forEach(([src, dest, srcAmount, destAmount]) => {
              it(`${src} -> ${dest}`, async () => {
                await testE2E(
                  tokens[src],
                  tokens[dest],
                  holders[src],
                  side === SwapSide.SELL ? srcAmount : destAmount,
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
}

describe('Orbital E2E', () => {
  const dexKey = 'Orbital';

  describe('Polygon', () => {
    // [src, dest, SELL amount of src, BUY amount of dest]: 100 of each, USDC and USDT0 on 6 decimals, DAI on 18.
    testForNetwork(Network.POLYGON, dexKey, [
      ['USDCn', 'USDT', '100000000', '100000000'],
      ['USDT', 'USDCn', '100000000', '100000000'],
      ['USDCn', 'DAI', '100000000', '100000000000000000000'],
      ['DAI', 'USDT', '100000000000000000000', '100000000'],
    ]);
  });
});
