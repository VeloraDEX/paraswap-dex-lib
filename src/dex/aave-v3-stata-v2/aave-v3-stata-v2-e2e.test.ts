/* eslint-disable no-console */
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
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  skipBuy: boolean = false, // BUY is not supported for aToken <-> stataToken
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

  sideToContractMethods.forEach((contractMethods, side) =>
    describe(`${side}`, () => {
      contractMethods.forEach((contractMethod: ContractMethod) => {
        if (contractMethod === ContractMethod.swapExactAmountOut && skipBuy) {
          return;
        }
        describe(`${contractMethod}`, () => {
          it(`${tokenASymbol} -> ${tokenBSymbol}`, async () => {
            await testE2E(
              tokens[tokenASymbol],
              tokens[tokenBSymbol],
              holders?.[tokenASymbol],
              side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
              side,
              dexKey,
              contractMethod,
              network,
              provider,
            );
          });
          it(`${tokenBSymbol} -> ${tokenASymbol}`, async () => {
            await testE2E(
              tokens[tokenBSymbol],
              tokens[tokenASymbol],
              holders?.[tokenBSymbol],
              side === SwapSide.SELL ? tokenBAmount : tokenAAmount,
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
}

describe('AaveV3Stata E2E', () => {
  const dexKey = 'AaveV3StataV2';

  describe('Mainnet', () => {
    const network = Network.MAINNET;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'USDT',
          amount: '100000',
        },
        {
          name: 'waEthUSDT',
          amount: '100000',
        },
      ],
      [
        {
          name: 'aaveUSDT',
          amount: '100000',
          skipBuy: true,
        },
        {
          name: 'waEthUSDT',
          amount: '100000',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });

  describe('Gnosis', () => {
    const network = Network.GNOSIS;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'waGnowstETH',
          amount: '100000',
          skipBuy: true,
        },
        {
          name: 'wstETH',
          amount: '100000',
        },
      ],
      [
        {
          name: 'waGnoWETH',
          amount: '100000',
          skipBuy: true,
        },
        {
          name: 'WETH',
          amount: '100000',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });

  // polygon is not yet live
  describe.skip('Polygon', () => {
    const network = Network.POLYGON;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'USDCn',
          amount: '100000',
        },
        {
          name: 'stataUSDCn',
          amount: '100000',
        },
      ],
      [
        {
          name: 'aaveUSDCn',
          amount: '100000',
          skipBuy: true,
        },
        {
          name: 'stataUSDCn',
          amount: '100000',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });

  // TODO: No holders yet
  // describe('Avalanche', () => {
  //   const network = Network.AVALANCHE;

  //   const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
  //     [
  //       {
  //         name: 'USDT',
  //         amount: '100000',
  //       },
  //       {
  //         name: 'stataUSDT',
  //         amount: '100000',
  //       },
  //     ],
  //     [
  //       {
  //         name: 'aaveUSDT',
  //         amount: '100000',
  //         skipBuy: true,
  //       },
  //       {
  //         name: 'stataUSDT',
  //         amount: '100000',
  //       },
  //     ],
  //   ];

  //   pairs.forEach(pair => {
  //     testForNetwork(
  //       network,
  //       dexKey,
  //       pair[0].name,
  //       pair[1].name,
  //       pair[0].amount,
  //       pair[1].amount,
  //       pair[0].skipBuy,
  //     );
  //   });
  // });

  describe('Arbitrum', () => {
    const network = Network.ARBITRUM;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'WETH',
          amount: '100000000000000',
        },
        {
          name: 'waArbWETH',
          amount: '1744566786133980',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });

  // no tokens yet deployed
  describe('Optimism', () => {
    const network = Network.OPTIMISM;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'USDC',
          amount: '100000',
        },
        {
          name: 'stataUSDC',
          amount: '100000',
        },
      ],
      [
        {
          name: 'aOptUSDCn',
          amount: '100000',
          skipBuy: true,
        },
        {
          name: 'stataUSDC', // no holders
          amount: '100000',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });

  describe('Base', () => {
    const network = Network.BASE;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'WETH',
          amount: '100000000000',
        },
        {
          name: 'waBasWETH',
          amount: '3792954988415750',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });

  // TODO: No holders yet
  // describe('Bsc', () => {
  //   const network = Network.BSC;

  //   const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
  //     [
  //       {
  //         name: 'USDT',
  //         amount: '100000',
  //       },
  //       {
  //         name: 'stataUSDT',
  //         amount: '100000',
  //       },
  //     ],
  //     [
  //       {
  //         name: 'aaveUSDT',
  //         amount: '100000',
  //         skipBuy: true,
  //       },
  //       {
  //         name: 'stataUSDT',
  //         amount: '100000',
  //       },
  //     ],
  //   ];

  //   pairs.forEach(pair => {
  //     testForNetwork(
  //       network,
  //       dexKey,
  //       pair[0].name,
  //       pair[1].name,
  //       pair[0].amount,
  //       pair[1].amount,
  //       pair[0].skipBuy,
  //     );
  //   });
  // });

  describe('Sonic', () => {
    const network = Network.SONIC;

    const pairs: { name: string; amount: string; skipBuy?: boolean }[][] = [
      [
        {
          name: 'USDCe',
          amount: '100000',
        },
        {
          name: 'waSonUSDC',
          amount: '100000',
        },
      ],
      [
        {
          name: 'aSonwS',
          amount: '1000000000000000',
        },
        {
          name: 'waSonwS',
          amount: '1000000000000000',
        },
      ],
    ];

    pairs.forEach(pair => {
      testForNetwork(
        network,
        dexKey,
        pair[0].name,
        pair[1].name,
        pair[0].amount,
        pair[1].amount,
        pair[0].skipBuy,
      );
    });
  });
});
