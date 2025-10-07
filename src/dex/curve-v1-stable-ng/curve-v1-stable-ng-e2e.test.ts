import dotenv from 'dotenv';
import { ContractMethod, Network } from '../../constants';
import { testForNetwork } from '../curve-v1-factory/curve-v1-factory-e2e.test';
import { SwapSide } from '@paraswap/core';

dotenv.config();

describe('CurveV1StableNG E2E', () => {
  const dexKey = 'CurveV1StableNg';

  const sidesToContractMethods = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        ContractMethod.swapExactAmountInOnCurveV1,
      ],
    ],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    describe('GHO -> USDe', () => {
      const tokenASymbol: string = 'GHO';
      const tokenBSymbol: string = 'USDe';

      const tokenAAmount: string = '100000000';
      const tokenBAmount: string = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        sidesToContractMethods,
      );
    });

    describe('weETH -> ETH', () => {
      const tokenASymbol: string = 'weETH';
      const tokenBSymbol: string = 'ETH';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        sidesToContractMethods,
      );
    });

    describe('GHO -> crvUSD', () => {
      const tokenASymbol: string = 'GHO';
      const tokenBSymbol: string = 'crvUSD';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        sidesToContractMethods,
      );
    });
  });

  describe('Polygon', () => {
    const network = Network.POLYGON;

    describe('crvUSD -> USDT', () => {
      const tokenASymbol: string = 'crvUSD';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        sidesToContractMethods,
      );
    });

    describe('USDC.e -> crvUSD', () => {
      const tokenASymbol: string = 'USDCe';
      const tokenBSymbol: string = 'crvUSD';

      const tokenAAmount: string = '10000000';
      const tokenBAmount: string = '1000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
        sidesToContractMethods,
      );
    });
  });

  describe('Sonic', () => {
    const network = Network.SONIC;

    const tokenASymbol: string = 'USDCe';
    const tokenBSymbol: string = 'USDT';

    const tokenAAmount: string = '10000000';
    const tokenBAmount: string = '10000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      sidesToContractMethods,
    );
  });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const tokenASymbol: string = 'crvUSD';
    const tokenBSymbol: string = 'USDCe';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '10000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      sidesToContractMethods,
    );
  });

  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const tokenASymbol: string = 'crvUSD';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '10000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      sidesToContractMethods,
    );
  });

  describe('Base', () => {
    const network = Network.BASE;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'USDM';

    const tokenAAmount: string = '11100000';
    const tokenBAmount: string = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      sidesToContractMethods,
    );
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;

    const tokenASymbol: string = 'sDAI';
    const tokenBSymbol: string = 'crvUSD';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      sidesToContractMethods,
    );
  });
});
