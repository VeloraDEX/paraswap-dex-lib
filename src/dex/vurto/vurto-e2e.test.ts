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

/*
  e2e tests for Vurto, the ones that actually send the transaction.

  They are the real guarantee of this integration: Vurto prices over HTTP, so
  the only way to prove that the published price is the price that settles is
  to settle it. Everything else is contract checking.

  BUY is absent on purpose, not by omission. The Vurto surface quotes an exact
  input; an inverted aggregate quote would be an estimate the settlement does
  not honour, so `getPricesVolume` returns null for BUY and there is nothing
  to exercise here.

  Requires a Tenderly fork, like every other e2e in this repository:
    TENDERLY_TOKEN, TENDERLY_ACCOUNT_ID, TENDERLY_PROJECT
  plus an RPC for the network under test, e.g. HTTP_PROVIDER_8453.
*/

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  // TODO: Add any direct swap contractMethod name if it exists
  /* Só SELL: `getPricesVolume` devolve null para BUY, então um caso de BUY
     aqui testaria o roteador deles a ignorar a gente, não a nossa integração. */
  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
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

describe('Vurto E2E', () => {
  const dexKey = 'Vurto';

  /* Uma rede por família de deploy, e pares que existem de verdade nas duas.
     Rodar as nove aqui gastaria fork da Tenderly sem provar nada a mais: o
     adaptador é o MESMO código em todas, só muda o endereço do roteador, que
     `config.ts` resolve. */
  describe('Base', () => {
    testForNetwork(
      Network.BASE,
      dexKey,
      'USDC',
      'WETH',
      '1000000',            // 1 USDC
      '100000000000000',    // 0.0001 WETH
      '100000000000000',    // 0.0001 ETH
    );
  });

  describe('Mainnet', () => {
    testForNetwork(
      Network.MAINNET,
      dexKey,
      'USDC',
      'WETH',
      '1000000',
      '100000000000000',
      '100000000000000',
    );
  });

  describe('Arbitrum', () => {
    testForNetwork(
      Network.ARBITRUM,
      dexKey,
      'USDC',
      'WETH',
      '1000000',
      '100000000000000',
      '100000000000000',
    );
  });
});
