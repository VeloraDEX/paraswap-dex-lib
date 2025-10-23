import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';

describe('UniswapV2 E2E Arbitrum', () => {
  const network = Network.ARBITRUM;
  const tokens = Tokens[network];
  const holders = Holders[network];
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  describe('SushiSwap', () => {
    const dexKey = 'SushiSwap';

    describe('Simpleswap', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.DAI,
          tokens.ETH,
          holders.DAI,
          '700000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.simpleSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.WETH,
          tokens.USDC,
          holders.WETH,
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
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.DAI,
          tokens.ETH,
          holders.DAI,
          '7000000000000000000',
          SwapSide.SELL,
          dexKey,
          ContractMethod.multiSwap,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WETH,
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

    describe('SimpleBuy', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '700000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.DAI,
          tokens.ETH,
          holders.DAI,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WETH,
          holders.DAI,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.simpleBuy,
          network,
          provider,
        );
      });
    });

    describe('BuyMethod', () => {
      it('SushiSwap ETH -> TOKEN', async () => {
        await testE2E(
          tokens.ETH,
          tokens.USDC,
          holders.ETH,
          '700000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> ETH', async () => {
        await testE2E(
          tokens.DAI,
          tokens.ETH,
          holders.DAI,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
      it('SushiSwap TOKEN -> TOKEN', async () => {
        await testE2E(
          tokens.DAI,
          tokens.WETH,
          holders.DAI,
          '7000000000000000000',
          SwapSide.BUY,
          dexKey,
          ContractMethod.buy,
          network,
          provider,
        );
      });
    });
  });

  describe(`Zyberswap`, () => {
    const dexKey = 'Zyberswap';

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
        { name: 'WETH', sellAmount: '700000000000', buyAmount: '1000' },
        { name: 'USDC', sellAmount: '100000', buyAmount: '4000' },
      ],
      [
        { name: 'USDC', sellAmount: '100000', buyAmount: '1000' },
        { name: 'WBTC', sellAmount: '10', buyAmount: '400000' },
      ],
      [
        {
          name: 'WETH',
          sellAmount: '10000000000',
          buyAmount: '10000000',
        },
        {
          name: 'ZYB',
          sellAmount: '1000000',
          buyAmount: '1000000000000000',
        },
      ],
      [
        { name: 'WETH', sellAmount: '700000000000', buyAmount: '1000' },
        { name: 'WBTC', sellAmount: '10', buyAmount: '400000' },
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
        { name: 'WETH', sellAmount: '700000000000', buyAmount: '1000' },
        { name: 'USDC', sellAmount: '100000', buyAmount: '4000' },
      ],
      [
        { name: 'WETH', sellAmount: '700000000000', buyAmount: '10000' },
        { name: 'USDT', sellAmount: '100000', buyAmount: '40000' },
      ],
      [
        { name: 'WETH', sellAmount: '700000000000', buyAmount: '10000' },
        { name: 'DAI', sellAmount: '1000000000000', buyAmount: '40000000' },
      ],
      [
        { name: 'POPS', sellAmount: '1000000000000000000', buyAmount: '10000' },
        { name: 'USDC', sellAmount: '10000', buyAmount: '40000' },
      ],
      [
        {
          name: 'WETH',
          sellAmount: '1000000000000000000',
          buyAmount: '10000000',
        },
        {
          name: 'POPS',
          sellAmount: '1000000000000000000',
          buyAmount: '1000000000000000000',
        },
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

  describe('OmniExchangeV2', () => {
    const dexKey = 'OmniExchangeV2';

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

    const pairs: { name: string; sellAmount: string }[][] = [
      [
        { name: 'WETH', sellAmount: '1000000000000000' },
        { name: 'USDC', sellAmount: '10000000' },
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
                  pair[0].sellAmount,
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
                  pair[1].sellAmount,
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

  describe('PancakeSwapV2', () => {
    const dexKey = 'PancakeSwapV2';

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
        { name: 'ETH', sellAmount: '505000000000000', buyAmount: '940617' },
        { name: 'USDC', sellAmount: '940617', buyAmount: '505000000000000' },
      ],
      [
        {
          name: 'ETH',
          sellAmount: '631955000000000',
          buyAmount: '1000000000000000000',
        },
        {
          name: 'ARB',
          sellAmount: '1000000000000000000',
          buyAmount: '631955000000000',
        },
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
