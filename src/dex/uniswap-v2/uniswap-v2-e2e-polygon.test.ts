import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Holders, Tokens } from '../../../tests/constants-e2e';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('UniswapV2 E2E Polygon', () => {
  const network = Network.POLYGON;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  describe('QuickSwap_V6', () => {
    const dexKey = 'QuickSwap';

    describe('SELL', () => {
      it('MATIC -> WETH', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('WETH -> MATIC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.MATIC,
          holders.WETH,
          '10000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('DAI -> USDC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('AAVE -> PSP', async () => {
        await testE2E(
          tokens.AAVE,
          tokens.PSP,
          holders.AAVE,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
    });
    describe('BUY', () => {
      it('MATIC -> WETH', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '70000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
      it('WETH -> MATIC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.MATIC,
          holders.WETH,
          '10000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '100000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.swapExactAmountOut,
          network,
          provider,
        );
      });
    });
  });
  describe('SafeSwap', () => {
    const dexKey = 'SafeSwap';

    describe('Simpleswap', () => {
      it('MATIC -> TOKEN', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> MATIC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.MATIC,
          holders.WETH,
          '10000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('Multi', () => {
      it('MATIC -> TOKEN', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> MATIC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.MATIC,
          holders.WETH,
          '10000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('Mega', () => {
      it('MATIC -> TOKEN', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> MATIC', async () => {
        await testE2E(
          tokens.WETH,
          tokens.MATIC,
          holders.WETH,
          '10000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
      it('TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('Sushiswap', () => {
    const dexKey = 'SushiSwap';

    describe('Simpleswap', () => {
      it('Sushiswap MATIC -> TOKEN', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('Sushiswap TOKEN -> MATIC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.MATIC,
          holders.DAI,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('Sushiswap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WMATIC,
          tokens.WETH,
          holders.WMATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });

    describe('Multiswap', () => {
      it('Sushiswap MATIC -> TOKEN', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('Sushiswap TOKEN -> MATIC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.MATIC,
          holders.DAI,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('Sushiswap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WMATIC,
          holders.DAI,
          '70000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('Dfyn_V6', () => {
    const dexKey = 'Dfyn';

    describe('swapExactAmountIn', () => {
      it('Dfyn MATIC -> TOKEN', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('Dfyn TOKEN -> MATIC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.MATIC,
          holders.DAI,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
      it('Dfyn TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDT,
          holders.DAI,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.swapExactAmountIn,
          network,
          provider,
        );
      });
    });

    // describe('Multiswap', () => {
    //   it('Dfyn MATIC -> TOKEN', async () => {
    //     await testE2E(
    //       tokens.MATIC,
    //       tokens.WETH,
    //       holders.MATIC,
    //       '7000000000000000000',
    //       SwapSide.SELL,
    //       dexKey,
    //       ContractMethod.multiSwap,
    //       network,
    //       provider,
    //     );
    //   });
    //   it('Dfyn TOKEN -> MATIC', async () => {
    //     await testE2E(
    //       tokens.DAI,
    //       tokens.MATIC,
    //       holders.DAI,
    //       '70000000000000000000',
    //       SwapSide.SELL,
    //       dexKey,
    //       ContractMethod.multiSwap,
    //       network,
    //       provider,
    //     );
    //   });
    //   it('Dfyn TOKEN -> TOKEN', async () => {
    //     await testE2E(
    //       tokens.DAI,
    //       tokens.USDT,
    //       holders.DAI,
    //       '70000000000000000000',
    //       SwapSide.SELL,
    //       dexKey,
    //       ContractMethod.multiSwap,
    //       network,
    //       provider,
    //     );
    //   });
    // });
  });

  describe('WaultFinance', () => {
    const dexKey = 'WaultFinance';

    describe('Simpleswap', () => {
      it('USDC -> MATIC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.MATIC,
          holders.USDC,
          '100000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('MATIC -> USDC', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.USDC,
          holders.MATIC,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('SimpleBuy', () => {
      it('USDC -> MATIC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.MATIC,
          holders.USDC,
          '100000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('MATIC -> USDC', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.USDC,
          holders.MATIC,
          '10000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });
    describe('MultiSwap', () => {
      it('USDC -> MATIC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.MATIC,
          holders.USDC,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('MATIC -> USDC', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.USDC,
          holders.MATIC,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('MegaSwap', () => {
      it('USDT -> USDC', async () => {
        await testE2E(
          tokens.USDT,
          tokens.USDC,
          holders.USDT,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe('ApeSwap', () => {
    const dexKey = 'ApeSwap';

    describe('Simpleswap', () => {
      it('MATIC -> WETH', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.WETH,
          holders.MATIC,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('DAI -> MATIC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.MATIC,
          holders.DAI,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('DAI -> USDC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
    });
    describe('SimpleBuy', () => {
      it('USDC -> MATIC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.MATIC,
          holders.USDC,
          '100000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('USDC -> DAI', async () => {
        await testE2E(
          tokens.USDC,
          tokens.DAI,
          holders.USDC,
          '100000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('MATIC -> USDC', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.USDC,
          holders.MATIC,
          '10000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });
    describe('MultiSwap', () => {
      it('USDC -> MATIC', async () => {
        await testE2E(
          tokens.USDC,
          tokens.MATIC,
          holders.USDC,
          '1000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('DAI -> USDC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('MATIC -> USDC', async () => {
        await testE2E(
          tokens.MATIC,
          tokens.USDC,
          holders.MATIC,
          '100000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
    });
    describe('MegaSwap', () => {
      it('DAI -> USDC', async () => {
        await testE2E(
          tokens.DAI,
          tokens.USDC,
          holders.DAI,
          '7000000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.megaSwap,
          network,
          provider,
        );
      });
    });
  });

  describe(`Swapsicle`, () => {
    const dexKey = 'Swapsicle';

    const sideToContractMethods = new Map([
      [
        SwapSide.SELL,
        [
          ContractMethod.simpleSwap,
          ContractMethod.multiSwap,
          ContractMethod.megaSwap,
        ],
      ],
      [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
    ]);

    const pairs: { name: string; sellAmount: string; buyAmount: string }[][] = [
      [
        { name: 'MATIC', sellAmount: '100000000000000000', buyAmount: '1000' },
        { name: 'USDC', sellAmount: '10000000', buyAmount: '1000' },
      ],
      [
        { name: 'MATIC', sellAmount: '1000000000', buyAmount: '1000' },
        { name: 'DAI', sellAmount: '50000', buyAmount: '1000000000' },
      ],
      [
        { name: 'MATIC', sellAmount: '100000000000000000', buyAmount: '1000' },
        { name: 'USDT', sellAmount: '100000000', buyAmount: '1000' },
      ],
      [
        { name: 'MATIC', sellAmount: '10000000', buyAmount: '1000' },
        { name: 'POPS', sellAmount: '8000000', buyAmount: '1000' },
      ],
    ];

    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          pairs.forEach(pair => {
            describe(`${contractMethod}`, () => {
              it(`${pair[0].name} -> ${pair[1].name}`, async () => {
                await testE2E(
                  tokens[pair[0].name],
                  tokens[pair[1].name],
                  holders[pair[0].name],
                  side === SwapSide.SELL
                    ? pair[0].sellAmount
                    : pair[0].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
              it(`${pair[1].name} -> ${pair[0].name}`, async () => {
                await testE2E(
                  tokens[pair[1].name],
                  tokens[pair[0].name],
                  holders[pair[1].name],
                  side === SwapSide.SELL
                    ? pair[1].sellAmount
                    : pair[1].buyAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
            });
          });
        });
      }),
    );
  });
});
