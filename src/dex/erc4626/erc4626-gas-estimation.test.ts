/* eslint-disable no-console */
import 'dotenv/config';
import { testGasEstimation } from '../../../tests/utils-e2e';
import { Network, SwapSide } from '../../constants';
import { ContractMethodV6 } from '@paraswap/core';
import { ERC4626Config } from './config';
import { BI_POWS } from '../../bigint-constants';

describe('ERC4626 Gas Estimation', () => {
  for (const dexKey of Object.keys(ERC4626Config)) {
    describe(`${dexKey}`, () => {
      for (const net of Object.keys(ERC4626Config[dexKey])) {
        const network = Number(net) as Network;
        const { vault, asset, cooldownEnabled, withdrawDisabled, decimals } =
          ERC4626Config[dexKey][network];

        describe(`${Network[network]} - swapExactAmountIn`, () => {
          const vaultToken = { address: vault, decimals: decimals ?? 18 };
          const assetToken = { address: asset, decimals: decimals ?? 18 };
          const amount = BI_POWS[decimals ?? 18] / 2n; // Use half of 1 token

          it(`deposit: ${asset} -> ${vault}`, async () => {
            await testGasEstimation(
              network,
              assetToken,
              vaultToken,
              amount,
              SwapSide.SELL,
              dexKey,
              ContractMethodV6.swapExactAmountIn,
            );
          });

          // Only test redeem if withdrawals are enabled
          if (!cooldownEnabled && !withdrawDisabled) {
            it(`redeem: ${vault} -> ${asset}`, async () => {
              await testGasEstimation(
                network,
                vaultToken,
                assetToken,
                amount,
                SwapSide.SELL,
                dexKey,
                ContractMethodV6.swapExactAmountIn,
              );
            });
          }
        });
      }
    });
  }
});
