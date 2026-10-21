/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  skipAToB = false,
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

  describe.only(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            (skipAToB ? it.skip : it)(
              `${tokenASymbol} -> ${tokenBSymbol}`,
              async () => {
                await testE2E(
                  tokens[tokenASymbol],
                  tokens[tokenBSymbol],
                  holders[tokenASymbol],
                  side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              },
            );
            // tokenA is GHO, and BUY into GHO is not supported
            (side === SwapSide.BUY ? it.skip : it)(
              `${tokenBSymbol} -> ${tokenASymbol}`,
              async () => {
                await testE2E(
                  tokens[tokenBSymbol],
                  tokens[tokenASymbol],
                  holders[tokenBSymbol],
                  side === SwapSide.SELL ? tokenBAmount : tokenAAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              },
            );
          });
        });
      }),
    );
  });
}

describe('AaveGsm E2E', () => {
  const dexKey = 'AaveGsm';

  describe('Mainnet GHO -> waEthUSDT', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'GHO';
    const tokenBSymbol: string = 'waEthUSDT';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '47166262';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Mainnet GHO -> waEthUSDC', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'GHO';
    const tokenBSymbol: string = 'waEthUSDC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    // The USDC GSM is drained (~0.03 USDC), so only waEthUSDC -> GHO routes
    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      true,
    );
  });
});
