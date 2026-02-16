import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Holders,
  NativeTokenSymbols,
  Tokens,
} from '../../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

jest.setTimeout(50 * 1000);

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  excludeNativeTokenTests: boolean = false,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        ContractMethod.swapExactAmountInOnBalancerV2,
      ],
    ],
    [
      SwapSide.BUY,
      [
        ContractMethod.swapExactAmountOut,
        ContractMethod.swapExactAmountOutOnBalancerV2,
      ],
    ],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            if (!excludeNativeTokenTests) {
              it(`${nativeTokenSymbol} -> ${tokenASymbol}`, async () => {
                await testE2E(
                  tokens[nativeTokenSymbol],
                  tokens[tokenASymbol],
                  holders[nativeTokenSymbol],
                  side === SwapSide.SELL ? nativeTokenAmount : tokenAAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
              it(`${tokenASymbol} -> ${nativeTokenSymbol}`, async () => {
                await testE2E(
                  tokens[tokenASymbol],
                  tokens[nativeTokenSymbol],
                  holders[tokenASymbol],
                  side === SwapSide.SELL ? tokenAAmount : nativeTokenAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
            }
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

describe('BalancerV2 E2E', () => {
  describe('Mainnet', () => {
    const dexKey = 'BalancerV2';
    const network = Network.MAINNET;

    testForNetwork(
      network,
      dexKey,
      'GHO',
      'USDT',
      '1000000000000000000000',
      '1000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'WETH',
      'PSP',
      '20000000000',
      '200000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'BAL',
      'WETH',
      '100000',
      '200000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'OHM',
      'DAI',
      '20000000000',
      '200000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'OHM',
      'WETH',
      '20000000000',
      '200000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'WETH',
      'AURA',
      '20000000000',
      '200000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'wstETH',
      '111000000',
      '100000000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'USDT',
      '100000000',
      '1000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'WETH',
      '100000000',
      '70000000000000',
      '2000000000000',
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'DAI',
      '10000000000',
      '200000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'wstETH',
      'WETH',
      '3000000000000000000',
      '200000000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'WETH',
      'WBTC',
      '200000000000000000',
      '200000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'dUSDC',
      '1000000000',
      '100000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'GYD',
      'sDAI',
      '10000000000000000000',
      '10000000000000000000',
      '1000000000000000000',
      true,
    );
  });

  describe('Polygon', () => {
    const dexKey = 'BalancerV2';
    const network = Network.POLYGON;

    testForNetwork(
      network,
      dexKey,
      'stMATIC',
      'WMATIC',
      '1000000000000000000',
      '1000000000000000000',
      '1000000000000000000',
    );

    testForNetwork(
      network,
      dexKey,
      'WMATIC',
      'USDC',
      '20000000000000',
      '200000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'WBTC',
      'USDC',
      '10000000',
      '200000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'USDT',
      '10000000',
      '10000000',
      '1000000000000000000',
      true,
    );
  });

  describe('Arbitrum', () => {
    const dexKey = 'BalancerV2';
    const network = Network.ARBITRUM;

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'WETH',
      '2000000000',
      '7000000000000000000',
      '7000000000000000000',
    );

    testForNetwork(
      network,
      dexKey,
      'RDNT',
      'WETH',
      '100000000000000000',
      '100000000000000',
      '7000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'OHM',
      '10000',
      '1000',
      '7000000000000000000',
      true,
    );
  });

  describe('Sonic', () => {
    const dexKey = 'BeetsFi';
    const network = Network.SONIC;

    testForNetwork(
      network,
      dexKey,
      'S',
      'stS',
      '1000000000000000000',
      '1000000000000000000',
      '1000000000000000000',
      true,
    );
  });

  describe('Optimism', () => {
    const dexKey = 'BeetsFi';
    const network = Network.OPTIMISM;

    testForNetwork(
      network,
      dexKey,
      'PSP',
      'OP',
      '1000000000000000000',
      '1000000000000000000',
      '1000000000000000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'PSP',
      'WETH',
      '1000000000000000000',
      '100000000000000000',
      '1000000000000000000',
      true,
    );
  });

  describe('Avalanche', () => {
    const dexKey = 'BalancerV2';
    const network = Network.AVALANCHE;

    testForNetwork(
      network,
      dexKey,
      'sAVAX',
      'AVAX',
      '20000000000000',
      '200000000',
      '200000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'USDT',
      'USDC',
      '20000000',
      '200000000',
      '200000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'BETS',
      'sAVAX',
      '20000000000000',
      '200000000',
      '200000000',
      true,
    );

    testForNetwork(
      network,
      dexKey,
      'HATCHY',
      'AVAX',
      '20000000000000',
      '200000000',
      '200000000',
      true,
    );
  });

  describe('Base', () => {
    const dexKey = 'BalancerV2';
    const network = Network.BASE;

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'GOLD',
      '11110010',
      '210000000000000000000',
      '1000000000000000000',
    );

    testForNetwork(
      network,
      dexKey,
      'WETH',
      'USDC',
      '300000000000000',
      '1000000',
      '1000000000000000000',
      true,
    );
  });

  describe('Gnosis', () => {
    const dexKey = 'BalancerV2';
    const network = Network.GNOSIS;

    testForNetwork(
      network,
      dexKey,
      'USDC',
      'USDT',
      '11110010',
      '21000000',
      '100000000000000000',
    );

    testForNetwork(
      network,
      dexKey,
      'WETH',
      'WXDAI',
      '1000000000000000000',
      '1000000000000000000',
      '1000000000000000000',
    );
  });
});
