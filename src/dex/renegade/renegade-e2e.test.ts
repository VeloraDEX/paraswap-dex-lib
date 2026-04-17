import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { RENEGADE_NAME } from './constants';

/** Pause test after `initializePricing` */
const SLEEP_MS = 1000;

/** Slippage in BPS */
const SLIPPAGE = 3;

function testForNetwork(
  network: Network,
  dexKey: string,
  quoteSymbol: string,
  baseSymbol: string,
  quoteAmount: string,
  baseAmount: string,
  nativeTokenAmount: string,
) {
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
                tokens[quoteSymbol],
                tokens[baseSymbol],
                holders[quoteSymbol],
                side === SwapSide.SELL ? quoteAmount : baseAmount,
                side,
                dexKey,
                contractMethod,
                network,
                undefined, // provider
                undefined, // poolIdentifiers
                undefined, // limitOrderProvider
                undefined, // transferFees
                SLIPPAGE,
                SLEEP_MS,
              );
            });
            it(`${baseSymbol} -> ${quoteSymbol}`, async () => {
              await testE2E(
                tokens[baseSymbol],
                tokens[quoteSymbol],
                holders[baseSymbol],
                side === SwapSide.SELL ? baseAmount : quoteAmount,
                side,
                dexKey,
                contractMethod,
                network,
                undefined, // provider
                undefined, // poolIdentifiers
                undefined, // limitOrderProvider
                undefined, // transferFees
                SLIPPAGE,
                SLEEP_MS,
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
  });

  describe('Base', () => {
    const network = Network.BASE;

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
  });
});
