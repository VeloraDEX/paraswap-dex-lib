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
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
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
            });
          });
        });
      }),
    );
  });
}


describe('WETH->ETH0 E2E', () => {
  const dexKey = 'Eth0MintZap';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'ETH0';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
});

describe('stETH->ETH0 E2E', () => {
  const dexKey = 'Eth0MintZap';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'STETH';
    const tokenBSymbol: string = 'ETH0';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
});

describe('wstETH->ETH0 E2E', () => {
  const dexKey = 'Eth0MintZap';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'wstETH';
    const tokenBSymbol: string = 'ETH0';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
});