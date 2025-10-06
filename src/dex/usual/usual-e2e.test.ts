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
          });
        });
      }),
    );
  });
}

describe('UsualBond E2E', () => {
  const dexKey = 'UsualBond';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'USD0';
    const tokenBSymbol: string = 'USD0++';

    const tokenAAmount: string = '100000';
    const tokenBAmount: string = '100000';

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

describe('UsdcUsualUSDC E2E', () => {
  const dexKey = 'UsdcUsualUSDC';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'UsualUSDC';

    const tokenAAmount: string = '100000';
    const tokenBAmount: string = '100000';

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

describe('UsualUSDC<>Usd0 E2E', () => {
  const dexKey = 'UsualUSDCUsd0';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'UsualUSDC';
    const tokenBSymbol: string = 'USD0';

    const tokenAAmount: string = '1000000';
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

describe('WrappedMM E2E', () => {
  const dexKey = 'WrappedMM';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'WrappedM';
    const tokenBSymbol: string = 'M';

    const tokenAAmount: string = '1000000000';
    const tokenBAmount: string = '1000000000';

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

describe('MWrappedM E2E', () => {
  const dexKey = 'MWrappedM';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'M';
    const tokenBSymbol: string = 'WrappedM';

    const tokenAAmount: string = '1000000000';
    const tokenBAmount: string = '1000000000';

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

describe('UsualMWrappedM E2E', () => {
  const dexKey = 'UsualMWrappedM';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'WrappedM';
    const tokenBSymbol: string = 'UsualM';

    const tokenAAmount: string = '100000';
    const tokenBAmount: string = '100000';

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

describe('UsualM<>Usd0 E2E', () => {
  const dexKey = 'UsualMUsd0';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'UsualM';
    const tokenBSymbol: string = 'USD0';

    const tokenAAmount: string = '1000000';
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
});
