import dotenv from 'dotenv';
dotenv.config();

import { newTestE2E, testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { RingV2FunctionsV6 } from './types';
import { Token } from '../../types';

const network = Network.MAINNET;
const tokens = Tokens[network];
const holders = Holders[network];
const provider = new StaticJsonRpcProvider(
  generateConfig(network).privateHttpProvider,
  network,
);

describe('RingV2 E2E Mainnet', () => {
  const dexKey = 'RingV2';

  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        // ContractMethod.swapExactAmountInOnRingV2,
        ContractMethod.simpleSwap,
        ContractMethod.multiSwap,
        ContractMethod.megaSwap,
      ],
    ],
    [
      SwapSide.BUY,
      [
        ContractMethod.swapExactAmountOut,
        // ContractMethod.swapExactAmountOutOnRingV2,
        ContractMethod.simpleBuy,
        ContractMethod.buy,
      ],
    ],
  ]);

  const tokens_for_test = [
    //tokenA, tokenB, sell amount, buy amount
    [tokens.cbBTC, tokens.UNI, '1000000'],
    [tokens.UNI, tokens.WETH, '10000000'],
  ];

  sideToContractMethods.forEach((contractMethods, side) =>
    contractMethods.forEach((contractMethod: ContractMethod) => {
      console.log(`start test: contractMethod=${contractMethod}, side=${side}`);
      describe(`RingV2 ${contractMethod}`, () => {
        if (side == SwapSide.SELL) {
          tokens_for_test.forEach(token_pair => {
            const tokenA = token_pair[0] as Token;
            const tokenB = token_pair[1] as Token;
            const sellamount = token_pair[2] as string;

            console.log(`sell:a->b::${tokenA.symbol} --> ${tokenB.symbol}`);
            it(`${tokenA.symbol} --> ${tokenB.symbol}`, async () => {
              await testE2E(
                tokenA,
                tokenB,
                holders.ETH,
                sellamount,
                SwapSide.SELL,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        } //buy
        else {
          tokens_for_test.forEach(token_pair => {
            const tokenA = token_pair[0] as Token;
            const tokenB = token_pair[1] as Token;
            const buyamount = token_pair[2] as string;
            console.log(`buy:a->b::${tokenA.symbol} --> ${tokenB.symbol}`);

            it(`${tokenA.symbol} --> ${tokenB.symbol}`, async () => {
              await testE2E(
                tokenA,
                tokenB,
                holders.ETH,
                buyamount,
                SwapSide.BUY,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
          });
        }
      });
    }),
  );

  //Test sell with ETH
  describe(`RingV2 SimpleSwap`, () => {
    const tokenA = tokens.USDC;
    const tokenB = tokens.ETH;
    const sellamount = '1000000';

    console.log(`sell:a->b::${tokenA.symbol} --> ${tokenB.symbol}`);
    it(`${tokenA.symbol} --> ${tokenB.symbol}`, async () => {
      await testE2E(
        tokenA,
        tokenB,
        holders.ETH,
        sellamount,
        SwapSide.SELL,
        dexKey,
        ContractMethod.simpleSwap,
        network,
        provider,
      );
    });
  });

  //test buy with ETH
  describe(`RingV2 SimpleBuy`, () => {
    const tokenA = tokens.USDC;
    const tokenB = tokens.ETH;
    const sellamount = '1000000';

    it(`${tokenA.symbol} --> ${tokenB.symbol}`, async () => {
      await testE2E(
        tokenA,
        tokenB,
        holders.ETH,
        sellamount,
        SwapSide.BUY,
        dexKey,
        ContractMethod.simpleBuy,
        network,
        provider,
      );
    });
  });

  //ETH as src
  describe(`RingV2 swapExactAmountIn`, () => {
    const tokenA = tokens.ETH;
    const tokenB = tokens.USDT;
    const sellamount = '1000';

    console.log(`sell:a->b::${tokenA.symbol} --> ${tokenB.symbol}`);
    it(`${tokenA.symbol} --> ${tokenB.symbol}`, async () => {
      await testE2E(
        tokenA,
        tokenB,
        holders.ETH,
        sellamount,
        SwapSide.BUY,
        dexKey,
        ContractMethod.swapExactAmountOut,
        network,
        provider,
      );
    });
  });

  //ETH as src, sell
  describe(`RingV2 simpleSwap`, () => {
    const tokenA = tokens.ETH;
    const tokenB = tokens.USDT;
    const sellamount = '10000000000';

    console.log(`sell:a->b::${tokenA.symbol} --> ${tokenB.symbol}`);
    it(`${tokenA.symbol} --> ${tokenB.symbol}`, async () => {
      await testE2E(
        tokenA,
        tokenB,
        holders.ETH,
        sellamount,
        SwapSide.SELL,
        dexKey,
        ContractMethod.simpleSwap,
        network,
        provider,
      );
    });
  });
});
