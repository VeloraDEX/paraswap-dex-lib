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
import { RENEGADE_NAME } from './constants';

/** Pause test after `initializePricing` */
const SLEEP_MS = 1000;

/** Slippage in BPS */
const SLIPPAGE = 1;

function testForNetwork(
  network: Network,
  dexKey: string,
  quoteSymbol: string,
  baseSymbol: string,
  quoteAmount: string,
  baseAmount: string,
  nativeTokenAmount: string,
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
            it(`${quoteSymbol} -> ${baseSymbol}`, async () => {
              await testE2E(
                tokens[quoteSymbol], // srcToken
                tokens[baseSymbol], // destToken
                holders[quoteSymbol], // senderAddress
                side === SwapSide.SELL ? quoteAmount : baseAmount, // srcToken amount
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                undefined, // poolIdentifiers
                undefined, // limitOrderProvider
                undefined, // transferFees
                SLIPPAGE, // slippage
                SLEEP_MS,
                undefined, // replaceTenderlyWithEstimateGas
                undefined, // forceRoute
                undefined, // options
              );
            });
            it(`${baseSymbol} -> ${quoteSymbol}`, async () => {
              await testE2E(
                tokens[baseSymbol], // srcToken
                tokens[quoteSymbol], // destToken
                holders[baseSymbol], // senderAddress
                side === SwapSide.SELL ? baseAmount : quoteAmount, // srcToken amount
                side,
                dexKey,
                contractMethod,
                network,
                provider,
                undefined, // poolIdentifiers
                undefined, // limitOrderProvider
                undefined, // transferFees
                SLIPPAGE, // slippage
                SLEEP_MS,
                undefined, // replaceTenderlyWithEstimateGas
                undefined, // forceRoute
                undefined, // options
              );
            });
          });
        });
      }),
    );
  });
}

describe('Renegade E2E', () => {
  const dexKey = RENEGADE_NAME;

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    // TODO: Modify the tokenASymbol, tokenBSymbol, tokenAAmount;
    const quoteSymbol: string = 'USDC';
    const baseSymbol: string = 'WETH';

    const quoteAmount: string = '10000000'; // 10 USDC
    const baseAmount: string = '10000000000000000'; // 0.01 WETH

    testForNetwork(
      network,
      dexKey,
      quoteSymbol,
      baseSymbol,
      quoteAmount,
      baseAmount,
      baseAmount,
    );

    // TODO: Add any additional test cases required to test Renegade
  });

  describe('Base', () => {
    const network = Network.BASE;

    // TODO: Modify the tokenASymbol, tokenBSymbol, tokenAAmount;
    const quoteSymbol: string = 'USDC';
    const baseSymbol: string = 'WETH';

    const quoteAmount: string = '10000000'; // 10 USDC
    const baseAmount: string = '10000000000000000'; // 0.001 WETH

    testForNetwork(
      network,
      dexKey,
      quoteSymbol,
      baseSymbol,
      quoteAmount,
      baseAmount,
      baseAmount,
    );

    // TODO: Add any additional test cases required to test Renegade
  });
});
