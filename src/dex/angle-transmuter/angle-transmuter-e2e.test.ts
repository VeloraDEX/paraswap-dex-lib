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
import { Collateral } from './angle-transmuter-integration.test';
import { BI_POWS } from '../../bigint-constants';
import { Token } from '../../types';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenASymbol: string,
  tokenBSymbol: string,
  tokenAAmount: string,
  tokenBAmount: string,
  nativeTokenAmount: string,
  isKYC: boolean,
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
              );
            });
            if (!isKYC) {
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
                );
              });
            }
          });
        });
      }),
    );
  });
}

describe('AngleTransmuter E2E', () => {
  const dexKey = 'AngleTransmuter';

  const networks = [Network.MAINNET, Network.ARBITRUM, Network.BASE];
  const stablesPerNetwork: { [network: number]: Token[] } = {
    [Network.MAINNET]: [
      Tokens[Network.MAINNET].EURA,
      Tokens[Network.MAINNET].USDA,
    ],
    [Network.ARBITRUM]: [Tokens[Network.ARBITRUM].USDA],
    [Network.BASE]: [Tokens[Network.BASE].USDA],
  };
  const collateralsPerNetwork: {
    [network: number]: { [stable: string]: Token[] };
  } = {
    [Network.MAINNET]: {
      USDA: [
        Tokens[Network.MAINNET].bIB01,
        Tokens[Network.MAINNET].USDC,
        Tokens[Network.MAINNET].steakUSDC,
      ],
      EURA: [
        Tokens[Network.MAINNET].EUROC,
        Tokens[Network.MAINNET].bC3M,
        Tokens[Network.MAINNET].bERNX,
      ],
    },
    [Network.ARBITRUM]: {
      USDA: [Tokens[Network.ARBITRUM].USDC],
    },
    [Network.BASE]: {
      USDA: [Tokens[Network.BASE].USDC],
    },
  };

  networks.forEach(network =>
    describe('Mainnet', () => {
      const tokens = Tokens[network];

      const stables = stablesPerNetwork[network];
      const collaterals = collateralsPerNetwork[network];

      const isKYC: { [token: string]: boolean } = {};
      if (network === Network.MAINNET) {
        isKYC[tokens.bIB01.symbol!] = true;
        isKYC[tokens.bC3M.symbol!] = true;
        isKYC[tokens.bERNX.symbol!] = true;
      }

      stables.forEach(stable =>
        collaterals[stable.symbol! as keyof Collateral].forEach(collateral =>
          describe(`${stable.symbol}/${collateral.symbol}`, () => {
            const stableAmount: string = (
              1n * BI_POWS[stable.decimals]
            ).toString();
            const collateralAmount: string = (
              1n * BI_POWS[collateral.decimals]
            ).toString();
            const nativeTokenAmount = '1000000000000000000';

            testForNetwork(
              network,
              dexKey,
              collateral.symbol!,
              stable.symbol!,
              collateralAmount,
              stableAmount,
              nativeTokenAmount,
              isKYC[collateral.symbol!],
            );
          }),
        ),
      );
    }),
  );
});
