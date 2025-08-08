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
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
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
            it(`${tokenBSymbol} -> ${tokenASymbol}`, async () => {
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
            });
          });
        });
      }),
    );
  });
}

describe('UniswapV2 Base E2E', () => {
  const network = Network.BASE;

  describe('Alien', () => {
    const dexKey = 'Alien';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('RocketSwap', () => {
    const dexKey = 'RocketSwap';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('SoSwap', () => {
    const dexKey = 'SoSwap';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('SwapBased', () => {
    const dexKey = 'SwapBased';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('SharkSwap', () => {
    const dexKey = 'SharkSwap';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('DackieSwap', () => {
    const dexKey = 'DackieSwap';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDbC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('QuickSwap', () => {
    const dexKey = 'QuickSwap';

    const tokenASymbol: string = 'WETH';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '10000000000000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('OmniExchangeV2', () => {
    const dexKey = 'OmniExchangeV2';
    testForNetwork(
      network,
      dexKey,
      'USDC',
      'WETH',
      '10000000',
      '1000000000000000',
    );
  });
});
