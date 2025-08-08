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
import { DIRECT_METHOD_NAME_V6 } from './constants';

describe('CurveV1 E2E', () => {
  const dexKey = 'CurveV1';

  describe('CurveV1_MAINNET', () => {
    const network = Network.MAINNET;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokensToTest = [
      // [
      //   {
      //     symbol: 'USDC',
      //     amount: (10 ** 8).toString(),
      //   },
      //   {
      //     symbol: 'DAI',
      //     amount: (10 ** 8).toString(),
      //   },
      // ],
      // [
      //   {
      //     symbol: 'CUSDC',
      //     amount: (10 ** 8).toString(),
      //   },
      //   {
      //     symbol: 'CDAI',
      //     amount: (10 ** 8).toString(),
      //   },
      // ],
      [
        {
          symbol: 'sUSD',
          amount: '76088500000000000000000',
        },
        {
          symbol: 'DAI',
          amount: (10 ** 8).toString(),
        },
      ],
    ];

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          // ContractMethod.simpleSwap,
          // ContractMethod.multiSwap,
          // ContractMethod.megaSwap,
          // ContractMethod.swapExactAmountInOnCurveV1,
          ContractMethod.swapExactAmountIn,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: string) => {
        tokensToTest.forEach(pair => {
          describe(`${contractMethod}`, () => {
            it(`${pair[0].symbol} -> ${pair[1].symbol}`, async () => {
              await testE2E(
                tokens[pair[0].symbol],
                tokens[pair[1].symbol],
                holders[pair[0].symbol],
                side === SwapSide.SELL ? pair[0].amount : pair[1].amount,
                side,
                dexKey,
                contractMethod as any,
                network,
                provider,
              );
            });
          });
        });
      }),
    );
    // it('simpleSwap DAI -> USDT', async () => {
    //   await testE2E(
    //     tokens['DAI'],
    //     tokens['USDT'],
    //     holders['DAI'],
    //     '100000000000000000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //   );
    // });

    // it('USDC -> USDT', async () => {
    //   await testE2E(
    //     tokens['USDC'],
    //     tokens['USDT'],
    //     holders['USDC'],
    //     '100000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //   );
    // });

    // it('DAI -> GUSD', async () => {
    //   await testE2E(
    //     tokens['DAI'],
    //     tokens['GUSD'],
    //     holders['DAI'],
    //     '100000000000000000000',
    //     SwapSide.SELL,
    //     dexKey,
    //     ContractMethod.simpleSwap,
    //     network,
    //     provider,
    //     null,
    //     undefined,
    //     undefined,
    //     1000,
    //   );
    // });

    // describe('FeeOnTransfer', () => {
    //   describe('sell', () => {
    //     const contractMethod = ContractMethod.megaSwap;
    //     describe('megaSwap', () => {
    //       it('stETH -> ETH', async () => {
    //         await testE2E(
    //           tokens['STETH'],
    //           tokens['ETH'],
    //           holders['STETH'],
    //           '1000000000000000000',
    //           SwapSide.SELL,
    //           dexKey,
    //           contractMethod,
    //           network,
    //           provider,
    //           undefined,
    //           undefined,
    //           { srcFee: 1, destFee: 0, srcDexFee: 1, destDexFee: 0 },
    //         );
    //       });

    //       it('ETH -> stETH', async () => {
    //         await testE2E(
    //           tokens['ETH'],
    //           tokens['STETH'],
    //           holders['ETH'],
    //           '1000000000000000000',
    //           SwapSide.SELL,
    //           dexKey,
    //           contractMethod,
    //           network,
    //           provider,
    //           undefined,
    //           undefined,
    //           { srcFee: 0, destFee: 1, srcDexFee: 0, destDexFee: 1 },
    //         );
    //       });
    //     });
    //   });
    // });
  });

  describe('CurveV1 POLYGON_V6', () => {
    const network = Network.POLYGON;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokensToTest = [
      [
        {
          symbol: 'USDT',
          amount: (10 ** 8).toString(),
        },
        {
          symbol: 'DAI',
          amount: (10 ** 8).toString(),
        },
      ],
      [
        {
          symbol: 'ETH',
          amount: (10 ** 16).toString(),
        },
        {
          symbol: 'DAI',
          amount: (10 ** 8).toString(),
        },
      ],
    ];

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          // ContractMethod.simpleSwap,
          // ContractMethod.multiSwap,
          // ContractMethod.megaSwap,
          // ContractMethod.directCurveV1Swap,
          ContractMethod.swapExactAmountIn,
          ContractMethod.swapExactAmountInOnCurveV1,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        tokensToTest.forEach(pair => {
          describe(`${contractMethod}`, () => {
            it(`${pair[0].symbol} -> ${pair[1].symbol}`, async () => {
              await testE2E(
                tokens[pair[0].symbol],
                tokens[pair[1].symbol],
                holders[pair[0].symbol],
                side === SwapSide.SELL ? pair[0].amount : pair[1].amount,
                side,
                dexKey,
                contractMethod,
                network,
                provider,
              );
            });
            it(`${pair[1].symbol} -> ${pair[0].symbol}`, async () => {
              await testE2E(
                tokens[pair[1].symbol],
                tokens[pair[0].symbol],
                holders[pair[1].symbol],
                side === SwapSide.SELL ? pair[1].amount : pair[0].amount,
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
  });

  describe('GNOSIS', () => {
    const network = Network.GNOSIS;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokensToTest = [
      [
        {
          symbol: 'WXDAI',
          amount: (10 ** 18).toString(),
        },
        {
          symbol: 'USDC',
          amount: (10 ** 6).toString(),
        },
      ],
      [
        {
          symbol: 'WXDAI',
          amount: (10 ** 18).toString(),
        },
        {
          symbol: 'USDT',
          amount: (10 ** 6).toString(),
        },
      ],
      [
        {
          symbol: 'USDC',
          amount: (10 ** 6).toString(),
        },
        {
          symbol: 'USDT',
          amount: (10 ** 6).toString(),
        },
      ],
    ];

    const sideToContractMethods = new Map([
      [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        tokensToTest.forEach(pair => {
          describe(`${contractMethod}`, () => {
            it(`${pair[0].symbol} -> ${pair[1].symbol}`, async () => {
              await testE2E(
                tokens[pair[0].symbol],
                tokens[pair[1].symbol],
                holders[pair[0].symbol],
                side === SwapSide.SELL ? pair[0].amount : pair[1].amount,
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
  });
});

describe('Acryptos E2E', () => {
  const dexKey = 'Acryptos';

  describe('Acryptos BSC', () => {
    const network = Network.BSC;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokenASymbol: string = 'USDT';
    const tokenBSymbol: string = 'DAI';

    const tokenAAmount: string = (1 * 10 ** 8).toString();
    const tokenBAmount: string = (1 * 10 ** 8).toString();

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.simpleSwap,
          ContractMethod.multiSwap,
          ContractMethod.megaSwap,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it('TOKEN -> TOKEN', async () => {
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
            );
          });
        });
      }),
    );
  });
});

describe('Ellipsis E2E', () => {
  const dexKey = 'Ellipsis';

  describe('Ellipsis BSC', () => {
    const network = Network.BSC;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokenASymbol: string = 'BUSD';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = (1 * 10 ** 8).toString();
    const tokenBAmount: string = (1 * 10 ** 8).toString();

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.simpleSwap,
          ContractMethod.multiSwap,
          ContractMethod.megaSwap,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it('TOKEN -> TOKEN', async () => {
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
            );
          });
        });
      }),
    );
    it('SELL BUSD -> axlUSD', async () => {
      await testE2E(
        tokens['BUSD'],
        tokens['axlUSD'],
        holders['BUSD'],
        '1000000000000000000',
        SwapSide.SELL,
        dexKey,
        ContractMethod.simpleSwap,
        network,
        provider,
      );
    });
  });
});

describe('Swerve E2E', () => {
  const dexKey = 'Swerve';

  describe('Swerve Mainnet', () => {
    const network = Network.MAINNET;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

    const tokenASymbol: string = 'USDT';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = (1 * 10 ** 8).toString();
    const tokenBAmount: string = (1 * 10 ** 8).toString();

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.simpleSwap,
          ContractMethod.multiSwap,
          ContractMethod.megaSwap,
        ],
      ],
    ]);

    sideToContractMethods.forEach((contractMethods, side) =>
      contractMethods.forEach((contractMethod: ContractMethod) => {
        describe(`${contractMethod}`, () => {
          it('TOKEN -> TOKEN', async () => {
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
            );
          });
        });
      }),
    );
  });
});
