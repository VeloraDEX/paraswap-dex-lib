/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { testE2E } from '../../../tests/utils-e2e';
import { Network, ContractMethod, SwapSide } from '../../constants';
import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { generateConfig } from '../../config';
import { ERC4626Config } from './config';
import { BI_POWS } from '../../bigint-constants';
import { Token } from '../../types';

function testForNetwork(
  network: Network,
  dexKey: string,
  tokenA: Token,
  tokenB: Token,
  tokenAAmount: string,
  tokenBAmount: string,
  skipTokenAToTokenBForSell = false,
  skipTokenAToTokenBForBuy = false,
) {
  const provider = new StaticJsonRpcProvider(
    generateConfig(network).privateHttpProvider,
    network,
  );

  const sideToContractMethods = new Map([
    [SwapSide.SELL, [ContractMethod.swapExactAmountIn]],
    [SwapSide.BUY, [ContractMethod.swapExactAmountOut]],
  ]);

  describe(`${network}`, () => {
    sideToContractMethods.forEach((contractMethods, side) =>
      describe(`${side}: ${dexKey}`, () => {
        contractMethods.forEach((contractMethod: ContractMethod) => {
          describe(`${contractMethod}`, () => {
            if (
              !(skipTokenAToTokenBForSell && side === SwapSide.SELL) &&
              !(skipTokenAToTokenBForBuy && side === SwapSide.BUY)
            ) {
              it(`${tokenA.address} -> ${tokenB.address}`, async () => {
                await testE2E(
                  tokenA,
                  tokenB,
                  '',
                  side === SwapSide.SELL ? tokenAAmount : tokenBAmount,
                  side,
                  dexKey,
                  contractMethod,
                  network,
                  provider,
                );
              });
            }
            it(`${tokenB.address} -> ${tokenA.address}`, async () => {
              await testE2E(
                tokenB,
                tokenA,
                '',
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
  });
}

const config = ERC4626Config;

for (const dexKey of Object.keys(ERC4626Config)) {
  for (const net of Object.keys(ERC4626Config[dexKey])) {
    const network = Number(net) as Network;
    const { vault, asset, cooldownEnabled, withdrawDisabled, decimals } =
      config[dexKey][network];

    const tokenA = { address: vault, decimals: decimals ?? 18 };
    const tokenB = { address: asset, decimals: decimals ?? 18 };

    testForNetwork(
      network,
      dexKey,
      tokenA,
      tokenB,
      BI_POWS[tokenA.decimals].toString(),
      BI_POWS[tokenB.decimals].toString(),
      // if cooldown is enabled, we skip withdrawal swaps (vault -> asset)
      !!cooldownEnabled,
      !!cooldownEnabled || withdrawDisabled,
    );
  }
}
