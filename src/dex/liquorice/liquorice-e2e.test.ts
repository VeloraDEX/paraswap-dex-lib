import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import {
  Holders,
  NativeTokenSymbols,
  Tokens,
} from '../../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { generateConfig } from '../../config';
import { StaticJsonRpcProvider } from '@ethersproject/providers';

// Each case fetches a live firm quote from Liquorice makers and simulates the
// swap on Tenderly.
jest.setTimeout(120_000);

// Wait for the first price book to be fetched
const sleepMs = 3000;

const dexKey = 'Liquorice';
const side = SwapSide.SELL;
const contractMethod = ContractMethod.swapExactAmountIn;

type Case = { srcSymbol: string; destSymbol: string; amount: string };

function runTestsForNetwork(network: Network, label: string, cases: Case[]) {
  describe(label, () => {
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );
    const tokens = Tokens[network];
    const holders = Holders[network];

    cases.forEach(({ srcSymbol, destSymbol, amount }) => {
      it(`${srcSymbol} -> ${destSymbol}`, async () => {
        await testE2E(
          tokens[srcSymbol],
          tokens[destSymbol],
          holders[srcSymbol],
          amount,
          side,
          dexKey,
          contractMethod,
          network,
          provider,
          undefined,
          undefined,
          undefined,
          undefined,
          sleepMs,
        );
      });
    });
  });
}

describe('Liquorice E2E', () => {
  // Pairs with live maker levels; check /prices before changing them
  runTestsForNetwork(Network.MAINNET, 'Mainnet', [
    { srcSymbol: 'USDC', destSymbol: 'USDT', amount: '1000000000' },
    { srcSymbol: 'USDC', destSymbol: 'WETH', amount: '1000000000' },
    {
      srcSymbol: 'USDC',
      destSymbol: NativeTokenSymbols[Network.MAINNET],
      amount: '1000000000',
    },
  ]);
});
