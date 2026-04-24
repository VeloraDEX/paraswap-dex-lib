/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Tokens } from '../../../tests/constants-e2e';
import { testInsertAmounts } from '../../../tests/utils-insert-amounts';
import { ContractMethod, Network, SwapSide } from '../../constants';

const dexKey = 'FluidDexLite';
const network = Network.MAINNET;
const tokens = Tokens[network];

const tokenASymbol = 'USDC';
const tokenBSymbol = 'USDT';
const tokenAAmount = '100000000';
const tokenBAmount = '100000000';

describe(`FluidDexLite Insert Amounts [${network}]`, () => {
  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  sideToContractMethods.forEach((contractMethods, side) =>
    describe(`${side}`, () => {
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
            await testInsertAmounts({
              srcToken: tokens[tokenASymbol],
              destToken: tokens[tokenBSymbol],
              amount: side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
              side,
              dexKey,
              contractMethod,
              network,
            });
          });
        });
      });
    }),
  );
});
