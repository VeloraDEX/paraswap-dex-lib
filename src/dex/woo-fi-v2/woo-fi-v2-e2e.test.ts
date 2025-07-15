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
  tokenBaseA: string,
  tokenBaseB: string,
  tokenQuote: string,
  tokenBaseAAmount: string,
  tokenQuoteAmount: string,
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
            it(`${tokenBaseA} -> ${tokenQuote}`, async () => {
              await testE2E(
                tokens[tokenBaseA],
                tokens[tokenQuote],
                holders[tokenBaseA],
                tokenBaseAAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${tokenQuote} -> ${tokenBaseA}`, async () => {
              await testE2E(
                tokens[tokenQuote],
                tokens[tokenBaseA],
                holders[tokenQuote],
                tokenQuoteAmount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${tokenBaseA} -> ${tokenBaseB}`, async () => {
              await testE2E(
                tokens[tokenBaseA],
                tokens[tokenBaseB],
                holders[tokenBaseA],
                tokenBaseAAmount,
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

describe('WooFiV2 E2E', () => {
  const dexKey = 'WooFiV2';

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const baseATokenSymbol = 'WETH';
    const baseBTokenSymbol = 'USDT';
    const quoteTokenSymbol = 'USDC';

    const tokenBaseAAmount = '1000000000000000000';
    const tokenQuoteAmount = '1000000';

    testForNetwork(
      network,
      dexKey,
      baseATokenSymbol,
      baseBTokenSymbol,
      quoteTokenSymbol,
      tokenBaseAAmount,
      tokenQuoteAmount,
    );
  });

  describe('BSC', () => {
    const network = Network.BSC;

    const baseATokenSymbol = 'WBNB';
    const baseBTokenSymbol = 'bBTC';
    const quoteTokenSymbol = 'USDT';

    const tokenBaseAAmount = '1000000000000000000';
    const tokenQuoteAmount = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      baseATokenSymbol,
      baseBTokenSymbol,
      quoteTokenSymbol,
      tokenBaseAAmount,
      tokenQuoteAmount,
    );
  });

  describe('Polygon_V6', () => {
    const network = Network.POLYGON;

    const baseATokenSymbol = 'WMATIC';
    const baseBTokenSymbol = 'WETH';
    const quoteTokenSymbol = 'USDCe';

    const tokenBaseAAmount = '1000000000000000000';
    const tokenQuoteAmount = '1000000';

    testForNetwork(
      network,
      dexKey,
      baseATokenSymbol,
      baseBTokenSymbol,
      quoteTokenSymbol,
      tokenBaseAAmount,
      tokenQuoteAmount,
    );
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const baseATokenSymbol = 'WETH';
    const baseBTokenSymbol = 'USDC';
    const quoteTokenSymbol = 'USDT';

    const tokenBaseAAmount = '1000000000000000000';
    const tokenQuoteAmount = '1000000';

    testForNetwork(
      network,
      dexKey,
      baseATokenSymbol,
      baseBTokenSymbol,
      quoteTokenSymbol,
      tokenBaseAAmount,
      tokenQuoteAmount,
    );
  });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    const baseATokenSymbol = 'WAVAX';
    const baseBTokenSymbol = 'BTCb';
    const quoteTokenSymbol = 'USDC';

    const tokenBaseAAmount = '1000000000000000000';
    const tokenQuoteAmount = '1000000';

    testForNetwork(
      network,
      dexKey,
      baseATokenSymbol,
      baseBTokenSymbol,
      quoteTokenSymbol,
      tokenBaseAAmount,
      tokenQuoteAmount,
    );
  });

  describe('Base', () => {
    const network = Network.BASE;

    const baseATokenSymbol = 'WETH';
    const baseBTokenSymbol = 'USDbC';
    const quoteTokenSymbol = 'USDC';

    const tokenBaseAAmount = '1000000000000000000';
    const tokenBaseBAmount = '100000000';

    testForNetwork(
      network,
      dexKey,
      baseATokenSymbol,
      baseBTokenSymbol,
      quoteTokenSymbol,
      tokenBaseAAmount,
      tokenBaseBAmount,
    );
  });
});
