import dotenv from 'dotenv';
import { testE2E } from '../../../tests/utils-e2e';
import { Holders, Tokens } from '../../../tests/constants-e2e';
import { ContractMethod, Network } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { SwapSide } from '@paraswap/core';

dotenv.config();

export function testForNetwork(
  network: Network,
  dexKey: string | string[],
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  sideToContractMethods: Map<SwapSide, ContractMethod[]> = new Map([
    [
      SwapSide.SELL,
      [
        ContractMethod.swapExactAmountIn,
        ContractMethod.swapExactAmountInOnCurveV1,
        // ContractMethod.simpleSwap,
        // ContractMethod.directCurveV1Swap,
        // ContractMethod.multiSwap,
        // ContractMethod.megaSwap,
      ],
    ],
  ]),
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network] ?? {};

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
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
                undefined,
                undefined,
                5000,
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
                undefined,
                undefined,
                5000,
              );
            });
          });
        });
      }),
    );
  });
}

describe('CurveV1Factory E2E', () => {
  const dexKey = ['CurveV1Factory'];

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    describe('USDT -> USDD', () => {
      const tokenASymbol: string = 'USDT';
      const tokenBSymbol: string = 'USDD';

      const tokenAAmount: string = '100000000';
      const tokenBAmount: string = '111000000000000000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });

    describe('GHO -> USDC', () => {
      const tokenASymbol: string = 'GHO';
      const tokenBSymbol: string = 'USDC';

      const tokenAAmount: string = '1000000000000000000';
      const tokenBAmount: string = '100000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
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
      );
    });

    describe('GHO -> USDT', () => {
      const tokenASymbol: string = 'GHO';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '10000000000000000000';
      const tokenBAmount: string = '1000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });
  describe('Mainnet Native', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'ETH';
    const tokenBSymbol: string = 'alETH';

    const tokenAAmount: string = '1000000000000000000';
    const tokenBAmount: string = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  describe('Mainnet ng pool', () => {
    const network = Network.MAINNET;

    describe('Dynamic needWrapNative', () => {
      describe('ETH -> STETH', () => {
        const tokenASymbol: string = 'ETH';
        const tokenBSymbol: string = 'STETH';

        const tokenAAmount: string = '1000000000000000000';
        const tokenBAmount: string = '1000000000000000000';

        testForNetwork(
          network,
          dexKey,
          tokenASymbol,
          tokenBSymbol,
          tokenAAmount,
          tokenBAmount,
        );
      });

      describe('WETH -> STETH', () => {
        const tokenASymbol: string = 'WETH';
        const tokenBSymbol: string = 'STETH';

        const tokenAAmount: string = '1000000000000000000';
        const tokenBAmount: string = '1000000000000000000';

        testForNetwork(
          network,
          dexKey,
          tokenASymbol,
          tokenBSymbol,
          tokenAAmount,
          tokenBAmount,
        );
      });
    });

    describe('crvUSD -> USDT', () => {
      const tokenASymbol: string = 'crvUSD';
      const tokenBSymbol: string = 'USDT';

      const tokenAAmount: string = '10000000000000000000';
      const tokenBAmount: string = '10000000';

      testForNetwork(
        network,
        dexKey,
        tokenASymbol,
        tokenBSymbol,
        tokenAAmount,
        tokenBAmount,
      );
    });
  });

  describe('Mainnet SBTC2 pool', () => {
    const network = Network.MAINNET;

    const tokenASymbol: string = 'WBTC';
    const tokenBSymbol: string = 'sBTC';

    const tokenAAmount: string = '100000000';
    const tokenBAmount: string = '1000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
  describe('Polygon_V6', () => {
    const network = Network.POLYGON;

    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'axlUSDC';

    const tokenAAmount: string = '1110000';
    const tokenBAmount: string = '1110000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
  // We don't support in current implementation working on unwrapped asset with Zap
  // describe('Polygon deUSDC', () => {
  //   const network = Network.POLYGON;

  //   const tokenASymbol: string = 'deUSDC';
  //   const tokenBSymbol: string = 'USDT';

  //   const tokenAAmount: string = '111000000';
  //   const tokenBAmount: string = '111000000';

  //   testForNetwork(
  //     network,
  //     dexKey,
  //     tokenASymbol,
  //     tokenBSymbol,
  //     tokenAAmount,
  //     tokenBAmount,
  //   );
  // });

  describe('Polygon amUSDC V6', () => {
    const network = Network.POLYGON;

    const tokenASymbol: string = 'deUSDC';
    const tokenBSymbol: string = 'amUSDC';

    const tokenAAmount: string = '1000000';
    const tokenBAmount: string = '1000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });

  // Uncomment this when add support for unwrapping lending tokens
  // describe('Polygon MAI', () => {
  //   const network = Network.POLYGON;

  //   const tokenASymbol: string = 'MAI';
  //   const tokenBSymbol: string = 'USDC';

  //   const tokenAAmount: string = '11000000000000000000';
  //   const tokenBAmount: string = '11000000';

  //   testForNetwork(
  //     network,
  //     dexKey,
  //     tokenASymbol,
  //     tokenBSymbol,
  //     tokenAAmount,
  //     tokenBAmount,
  //   );
  // });

  describe('Avalanche', () => {
    const network = Network.AVALANCHE;

    const tokenASymbol: string = 'YUSD';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '111000000000000000000';
    const tokenBAmount: string = '111000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
  describe('Fantom', () => {
    const network = Network.FANTOM;

    const tokenASymbol: string = 'TOR';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '111000000000000000000';
    const tokenBAmount: string = '111000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const tokenASymbol: string = 'VST';
    const tokenBSymbol: string = 'FRAX';

    const tokenAAmount: string = '111000000000000000000';
    const tokenBAmount: string = '111000000000000000000';

    testForNetwork(
      network,
      dexKey,
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
    );
  });
  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const tokenASymbol: string = 'sETH';
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
    );
  });
  describe('Base', () => {
    const network = Network.BASE;

    describe('USDC -> crvUSD', () => {
      const tokenASymbol: string = 'USDC';
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
      );
    });

    describe('USDM -> crvUSD', () => {
      const tokenASymbol: string = 'USDM';
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
      );
    });
  });
});
