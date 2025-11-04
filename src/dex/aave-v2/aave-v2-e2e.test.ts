import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Tokens, Holders } from '../../../tests/constants-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { aaveV2GetToken } from './tokens';
import { generateConfig } from '../../config';

jest.setTimeout(1000 * 60 * 3);

interface TestConfig {
  tokenAKey: string;
  tokenBKey: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  holderKey: string;
  amount: string;
}

describe('AaveV2 E2E', () => {
  const dexKey = 'AaveV2';

  const testConfigs: Record<number, TestConfig[]> = {
    [Network.MAINNET]: [
      {
        tokenAKey: 'aWETH',
        tokenBKey: 'ETH',
        tokenASymbol: 'aWETH',
        tokenBSymbol: 'ETH',
        holderKey: 'aWETH',
        amount: '1000000000000000000',
      },
      {
        tokenAKey: 'aUSDT',
        tokenBKey: 'USDT',
        tokenASymbol: 'aUSDT',
        tokenBSymbol: 'USDT',
        holderKey: 'USDT',
        amount: '2000000000',
      },
      {
        tokenAKey: 'aWETH',
        tokenBKey: 'WETH',
        tokenASymbol: 'aWETH',
        tokenBSymbol: 'wETH',
        holderKey: 'aWETH',
        amount: '1000000000000000000',
      },
    ],
    [Network.POLYGON]: [
      {
        tokenAKey: 'amWMATIC',
        tokenBKey: 'MATIC',
        tokenASymbol: 'amWMATIC',
        tokenBSymbol: 'MATIC',
        holderKey: 'AMWMATIC',
        amount: '1000000000000000000',
      },
      {
        tokenAKey: 'amUSDT',
        tokenBKey: 'USDT',
        tokenASymbol: 'amUSDT',
        tokenBSymbol: 'USDT',
        holderKey: 'USDT',
        amount: '2000000000',
      },
      {
        tokenAKey: 'amWMATIC',
        tokenBKey: 'WMATIC',
        tokenASymbol: 'amWMATIC',
        tokenBSymbol: 'WMATIC',
        holderKey: 'AMWMATIC',
        amount: '1000000000000000000',
      },
    ],
    [Network.AVALANCHE]: [
      {
        tokenAKey: 'avWAVAX',
        tokenBKey: 'AVAX',
        tokenASymbol: 'avWAVAX',
        tokenBSymbol: 'AVAX',
        holderKey: 'avWAVAX',
        amount: '1000000000000000000',
      },
      {
        tokenAKey: 'avWAVAX',
        tokenBKey: 'WAVAX',
        tokenASymbol: 'avWAVAX',
        tokenBSymbol: 'WAVAX',
        holderKey: 'avWAVAX',
        amount: '1000000000000000000',
      },
    ],
  };

  const contractMethods: Record<
    number,
    { [side in SwapSide]: ContractMethod[] }
  > = {
    [Network.MAINNET]: {
      [SwapSide.SELL]: [ContractMethod.swapExactAmountIn],
      [SwapSide.BUY]: [ContractMethod.swapExactAmountOut],
    },
    [Network.POLYGON]: {
      [SwapSide.SELL]: [ContractMethod.swapExactAmountIn],
      [SwapSide.BUY]: [ContractMethod.swapExactAmountOut],
    },
    [Network.AVALANCHE]: {
      [SwapSide.SELL]: [ContractMethod.swapExactAmountIn],
      [SwapSide.BUY]: [ContractMethod.swapExactAmountOut],
    },
  };

  Object.entries(testConfigs).forEach(([networkKey, configs]) => {
    const network = Number(networkKey) as Network;
    const networkName = Network[network];

    describe(`AaveV2 ${networkName}`, () => {
      const tokens = Tokens[network];
      const holders = Holders[network];
      const provider = new StaticJsonRpcProvider(
        generateConfig(network).privateHttpProvider,
        network,
      );

      const resolvedTestConfigs = configs.map(config => {
        const tokenA = aaveV2GetToken(network, config.tokenAKey);
        const tokenB = tokens[config.tokenBKey];

        if (!tokenA) {
          console.log(
            `TokenA not found for key ${config.tokenAKey} on network ${networkName}`,
          );
        }

        expect(tokenA).not.toBe(null);
        expect(tokenB).not.toBe(null);

        return {
          tokenA: tokenA!,
          tokenB: tokenB!,
          tokenASymbol: config.tokenASymbol,
          tokenBSymbol: config.tokenBSymbol,
          holder: holders[config.holderKey],
          amount: config.amount,
        };
      });

      const methods = contractMethods[network];

      [SwapSide.SELL, SwapSide.BUY].forEach((side: SwapSide) =>
        methods[side].forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            resolvedTestConfigs.forEach(config => {
              it(`${config.tokenASymbol} -> ${config.tokenBSymbol}`, async () => {
                await testE2E(
                  config.tokenA,
                  config.tokenB,
                  config.holder,
                  config.amount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                  undefined,
                  undefined,
                  undefined,
                  0, // slippage
                );
              });
            });
          });
        }),
      );
    });
  });
});
