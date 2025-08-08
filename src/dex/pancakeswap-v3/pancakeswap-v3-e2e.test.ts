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

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  slippage?: number | undefined,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );
  const tokens = Tokens[network];
  const holders = Holders[network];
  const nativeTokenSymbol = NativeTokenSymbols[network];

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

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
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
                undefined,
                slippage,
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
                undefined,
                slippage,
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
                undefined,
                slippage,
              );
            });
          });
        });
      }),
    );
  });
}

describe('PancakeswapV3 E2E', () => {
  const dexKey = 'PancakeswapV3';

  describe('PancakeswapV3 MAINNET', () => {
    const network = Network.MAINNET;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

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
        {
          name: 'USDT',
          sellAmount: '10000000000',
          buyAmount: '20000000000',
        },
        {
          name: 'USDC',
          sellAmount: '100000000000',
          buyAmount: '500000000',
        },
      ],
      [
        {
          name: NativeTokenSymbols[network],
          sellAmount: '20000000000000000',
          buyAmount: '100000000000',
        },
        {
          name: 'USDT',
          sellAmount: '10000000000',
          buyAmount: '1500000000000000000',
        },
      ],
      [
        {
          name: NativeTokenSymbols[network],
          sellAmount: '10000000000000000',
          buyAmount: '500000000000',
        },
        {
          name: 'USDC',
          sellAmount: '500000000000',
          buyAmount: '10000000000000000',
        },
      ],
      [
        {
          name: 'WETH',
          sellAmount: '450000000000000000',
          buyAmount: '900000000000',
        },
        {
          name: 'USDT',
          sellAmount: '20000000000',
          buyAmount: '2000000000000000000',
        },
      ],
      [
        {
          name: 'DAI',
          sellAmount: '100000000000000000000',
          buyAmount: '1000000000',
        },
        {
          name: 'USDC',
          sellAmount: '10000000000',
          buyAmount: '500000000000000000000',
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

  describe('PancakeswapV3 BSC', () => {
    const network = Network.BSC;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

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
        {
          name: NativeTokenSymbols[network],
          sellAmount: '100000000000000000000',
          buyAmount: '100000000000000000000',
        },
        {
          name: 'BUSD',
          sellAmount: '100000000000000000000',
          buyAmount: '10000000000000',
        },
      ],
      [
        {
          name: 'WBNB',
          sellAmount: '1000000000000000000',
          buyAmount: '10000000000000000000',
        },
        {
          name: 'USDT',
          sellAmount: '10000000000000000000',
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

  describe('PancakeswapV3 Arbitrum_V6', () => {
    const network = Network.ARBITRUM;
    const tokens = Tokens[network];
    const holders = Holders[network];
    const provider = new StaticJsonRpcProvider(
      generateConfig(network).privateHttpProvider,
      network,
    );

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
      // [SwapSide.BUY, [ContractMethod.simpleBuy, ContractMethod.buy]],
      [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
    ]);

    const pairs: { name: string; sellAmount: string; buyAmount: string }[][] = [
      [
        {
          name: NativeTokenSymbols[network],
          sellAmount: '2687649500000000',
          buyAmount: '5000000',
        },
        {
          name: 'USDC',
          sellAmount: '5000000',
          buyAmount: '1000000000000000',
        },
      ],
      [
        {
          name: 'USDT',
          sellAmount: '5000000',
          buyAmount: '5000000',
        },
        {
          name: 'USDC',
          sellAmount: '5000000',
          buyAmount: '5000000',
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

  describe('PancakeswapV3 Base', () => {
    const network = Network.BASE;

    const tokenASymbol: string = 'USDbC';
    const tokenBSymbol: string = 'DAI';

    const tokenAAmount: string = '11111000000';
    const tokenBAmount: string = '210000000000000000';
    const nativeTokenAmount = '110000000000000000000';

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

  describe('SwapBasedV3 Base', () => {
    const network = Network.BASE;

    const tokenASymbol: string = 'USDbC';
    const tokenBSymbol: string = 'USDC';

    const tokenAAmount: string = '11111000000';
    const tokenBAmount: string = '11111000000';
    const nativeTokenAmount = '110000000000000000000';

    testForNetwork(
      network,
      'SwapBasedV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });

  describe('OmniExchangeV3 Base', () => {
    const network = Network.BASE;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'WETH';
    const tokenAAmount: string = '10000000000';
    const tokenBAmount: string = '1000000000000000000';
    const nativeTokenAmount = '1000000000000000000';

    testForNetwork(
      network,
      'OmniExchangeV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });

  describe('OmniExchangeV3 Arbitrum', () => {
    const network = Network.ARBITRUM;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'WETH';
    const tokenAAmount: string = '10000000';
    const tokenBAmount: string = '25000000000000000';
    const nativeTokenAmount = '25000000000000000';

    testForNetwork(
      network,
      'OmniExchangeV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });

  describe('OmniExchangeV3 Optimism', () => {
    const network = Network.OPTIMISM;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'WETH';
    const tokenAAmount: string = '1000000000';
    const tokenBAmount: string = '500000000000000000';
    const nativeTokenAmount = '500000000000000000';

    testForNetwork(
      network,
      'OmniExchangeV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });

  describe('OmniExchangeV3 BSC', () => {
    const network = Network.BSC;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'WBNB';
    const tokenAAmount: string = '1000000000000000000000';
    const tokenBAmount: string = '5000000000000000000';
    const nativeTokenAmount = '5000000000000000000';

    testForNetwork(
      network,
      'OmniExchangeV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });

  describe('OmniExchangeV3 Avalanche', () => {
    const network = Network.AVALANCHE;
    const tokenASymbol: string = 'USDC';
    const tokenBSymbol: string = 'WAVAX';
    const tokenAAmount: string = '1000000000';
    const tokenBAmount: string = '50000000000000000000';
    const nativeTokenAmount = '50000000000000000000';

    testForNetwork(
      network,
      'OmniExchangeV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });

  describe('OmniExchangeV3 Sonic', () => {
    const network = Network.SONIC;
    const tokenASymbol: string = 'USDCe';
    const tokenBSymbol: string = 'WS';
    const tokenAAmount: string = '1000000000';
    const tokenBAmount: string = '100000000000000000000';
    const nativeTokenAmount = '100000000000000000000';

    testForNetwork(
      network,
      'OmniExchangeV3',
      tokenASymbol,
      tokenBSymbol,
      tokenAAmount,
      tokenBAmount,
      nativeTokenAmount,
    );
  });
});
