/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Tokens } from '../../../tests/constants-e2e';
import { testInsertAmounts } from '../../../tests/utils-insert-amounts';
import { ContractMethod, Network, SwapSide } from '../../constants';

const dexKey = 'dETH';
const network = Network.MAINNET;
const tokens = Tokens[network];

const srcTokenSymbol = 'WETH';
const destTokenSymbol = 'dETH';
const srcAmount = '100000000000000000';
const destAmount = '100000000000000000';

describe(`dETH Insert Amounts [${network}]`, () => {
  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  sideToContractMethods.forEach((contractMethods, side) =>
    describe(`${side}`, () => {
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it(`${srcTokenSymbol} -> ${destTokenSymbol}`, async () => {
            await testInsertAmounts({
              srcToken: tokens[srcTokenSymbol],
              destToken: tokens[destTokenSymbol],
              amount: side === SwapSide.SELL ? srcAmount : destAmount,
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
