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
import { TransferFeeParams } from '../../types';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  transferFees: TransferFeeParams = {
    srcFee: 0,
    destFee: 0,
    srcDexFee: 0,
    destDexFee: 0,
  },
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            // if src token is tax token and BUY side, then should fail (skip)
            if (!!transferFees?.srcDexFee && side === SwapSide.BUY) return;
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
                undefined,
                undefined,
                {
                  ...transferFees,
                  srcDexFee: transferFees.destDexFee,
                  destDexFee: transferFees.srcDexFee,
                } as any,
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
                undefined,
                undefined,
                transferFees as any,
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
                undefined,
                undefined,
                transferFees as any,
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
                undefined,
                undefined,
                transferFees as any,
              );
            });
          });
        });
      }),
    );
  });
}

describe('QuickSwapV4 E2E', () => {
  const dexKey = 'QuickSwapV4';

  describe('Polygon', () => {
    const network = Network.POLYGON;

    describe('USDCn -> WMATIC', () => {
      const tokenASymbol: string = 'USDCn';
      const tokenBSymbol: string = 'WMATIC';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });

    describe('WOLF -> WMATIC', () => {
      const tokenASymbol: string = 'WOLF';
      const tokenBSymbol: string = 'WMATIC';

      const tokenAAmount: string = '10000000000';
      const tokenBAmount: string = '100000000000000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
        {
          srcFee: 0,
          destFee: 0,
          srcDexFee: 200,
          destDexFee: 0,
        } as any,
      );
    });
  });

  describe('Base', () => {
    const network = Network.BASE;

    describe('USDC -> WETH', () => {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'WETH';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '100000000000000000';
      const nativeTokenAmount = '100000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });
});

describe('BlackholeCL E2E', () => {
  const dexKey = 'BlackholeCL';

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    describe('USDC -> WAVAX', () => {
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'WAVAX';

      const tokenAAmount: string = '1000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });

    describe('BTCb -> WAVAX', () => {
      const tokenASymbol: string = 'BTCb';
      const tokenBSymbol: string = 'WAVAX';

      const tokenAAmount: string = '100000000';
      const tokenBAmount: string = '1000000000000000000';
      const nativeTokenAmount = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        nativeTokenAmount,
      );
    });
  });
});
