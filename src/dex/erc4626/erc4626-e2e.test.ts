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

describe('MountainProtocol E2E', () => {
  const dexKey = 'wUSDM';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'wUSDM';
    const tokenBSymbol: string = 'USDM';

    const tokenAAmount: string = '500';
    const tokenBAmount: string = '500';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const tokenASymbol: string = 'wUSDM';
    const tokenBSymbol: string = 'USDM';

    const tokenAAmount: string = '500';
    const tokenBAmount: string = '500';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const tokenASymbol: string = 'wUSDM';
    const tokenBSymbol: string = 'USDM';

    const tokenAAmount: string = '500';
    const tokenBAmount: string = '500';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Base', () => {
    const network = Network.BASE;

    const tokenASymbol: string = 'wUSDM';
    const tokenBSymbol: string = 'USDM';

    const tokenAAmount: string = '500';
    const tokenBAmount: string = '500';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;

    const tokenASymbol: string = 'wUSDM';
    const tokenBSymbol: string = 'USDM';

    const tokenAAmount: string = '500';
    const tokenBAmount: string = '500';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;

    const tokenASymbol: string = 'sDAI';
    const tokenBSymbol: string = 'WXDAI';

    const tokenAAmount: string = '500000000000000000';
    const tokenBAmount: string = '500000000000000000';

    testForNetwork(
      network,
      'sDAI',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Gnosis with Native', () => {
    const network = Network.GNOSIS;

    const tokenASymbol: string = 'sDAI';
    const tokenBSymbol: string = 'XDAI';

    const tokenAAmount: string = '500000000000000000';
    const tokenBAmount: string = '500000000000000000';

    testForNetwork(
      network,
      'sDAI',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('wUSDL', () => {
    const network = Network.MAINNET;
    const dexKey = 'wUSDL';

    const tokenASymbol: string = 'wUSDL';
    const tokenBSymbol: string = 'USDL';

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
