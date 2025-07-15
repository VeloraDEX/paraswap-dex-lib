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
import { TransferFeeParamsForRoute } from '../../types';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  // To be tested against E2E endpoint
  transferFees: TransferFeeParamsForRoute = {
    srcTokenTransferFee: 0,
    destTokenTransferFee: 0,
    srcTokenDexTransferFee: 0,
    destTokenDexTransferFee: 0,
  },
  // transferFees: TransferFeeParams = {
  //   srcFee: 0,
  //   destFee: 0,
  //   srcDexFee: 0,
  //   destDexFee: 0,
  // },
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

  // TODO: Add any direct swap contractMethod name if it exists
  const sideToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        // ContractMethod.simpleSwap,
        // ContractMethod.multiSwap,
        // ContractMethod.megaSwap,
      ],
    ],
    // TODO: If buy is not supported remove the buy contract methods
    // [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            // if src token is tax token and BUY side, then should fail (skip)
            if (!!transferFees?.srcTokenTransferFee && side === SwapSide.BUY)
              return;

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
                // switch src and dest fee when tax token is dest token
                {
                  ...transferFees,
                  srcTokenDexTransferFee: transferFees.destTokenDexTransferFee,
                  destTokenDexTransferFee: transferFees.srcTokenDexTransferFee,
                } as any,
              );
            });
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
                // switch src and dest fee when tax token is dest token
                {
                  ...transferFees,
                  srcTokenDexTransferFee: transferFees.destTokenDexTransferFee,
                  destTokenDexTransferFee: transferFees.srcTokenDexTransferFee,
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
          });
        });
      }),
    );
  });
}

describe('Algebra', () => {
  describe('QuickSwapV3 E2E', () => {
    const dexKey = 'QuickSwapV3';

    describe('Polygon_V6', () => {
      const network = Network.POLYGON;
      const tokenASymbol: string = 'USDT';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '1000000000';
      const tokenBAmount: string = '1000000000';
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

  describe('ZyberSwapV3', () => {
    const dexKey = 'ZyberSwapV3';

    describe('Arbitrum', () => {
      const network = Network.ARBITRUM;
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'DAI';

      const tokenAAmount: string = '1000000000';
      const tokenBAmount: string = '1000000000000000000000';
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

    describe('Optimism', () => {
      const network = Network.OPTIMISM;
      const tokenASymbol: string = 'USDC';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '100000000';
      const tokenBAmount: string = '50000';
      const nativeTokenAmount = '100000000000000';

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

  describe('CamelotV3_V6', () => {
    const dexKey = 'CamelotV3';
    const network = Network.ARBITRUM;

    describe('Arbitrum: TaxTokens', () => {
      const tokenASymbol: string = 'RDPX';
      const tokenBSymbol: string = 'WETH';

      const tokenAAmount: string = '100000000000000000000';
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
          srcTokenTransferFee: 0,
          destTokenTransferFee: 0,
          srcTokenDexTransferFee: 1000,
          destTokenDexTransferFee: 0,
        } as any,
      );
    });

    describe('Arbitrum: Non-Tax tokens', () => {
      const tokenASymbol: string = 'USDT';
      const tokenBSymbol: string = 'USDCe';

      const tokenAAmount: string = '1000000000';
      const tokenBAmount: string = '1000000000';
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

  describe('SwapBasedV3', () => {
    const dexKey = 'SwapBasedV3';
    const network = Network.BASE;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'WETH';

    const tokenAAmount: string = '1000000000';
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

  describe('SwaprV3', () => {
    const dexKey = 'SwaprV3';
    const network = Network.GNOSIS;

    const tokenASymbol: string = 'WXDAI';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '100000000';
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
