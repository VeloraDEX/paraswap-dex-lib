/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { ERC4626 } from './erc4626';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { ERC4626Config } from './config';

describe('ERC4626 Integration Tests', function () {
  for (const dexKey of Object.keys(ERC4626Config)) {
    describe(`${dexKey}`, function () {
      for (const net of Object.keys(ERC4626Config[dexKey])) {
        const network = Number(net) as Network;
        const { vault, asset, cooldownEnabled, withdrawDisabled, decimals } =
          ERC4626Config[dexKey][network];

        describe(`${Network[network]}`, () => {
          const vaultToken = { address: vault, decimals: decimals ?? 18 };
          const assetToken = { address: asset, decimals: decimals ?? 18 };
          const amounts = [
            0n,
            BI_POWS[vaultToken.decimals],
            2n * BI_POWS[vaultToken.decimals],
          ];

          let dexHelper: DummyDexHelper;
          let blocknumber: number;
          let erc4626: ERC4626;

          beforeAll(async () => {
            dexHelper = new DummyDexHelper(network);
            blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
            erc4626 = new ERC4626(network, dexKey, dexHelper);
            if (erc4626.initializePricing) {
              await erc4626.initializePricing(blocknumber);
            }
          });

          it(`getPoolIdentifiers and getPricesVolume ${asset} -> ${vault} SELL`, async function () {
            const pools = await erc4626.getPoolIdentifiers(
              assetToken,
              vaultToken,
              SwapSide.SELL,
              blocknumber,
            );
            console.log(`${asset} <> ${vault} Pool Identifiers: `, pools);

            expect(pools.length).toBeGreaterThan(0);

            const poolPrices = await erc4626.getPricesVolume(
              assetToken,
              vaultToken,
              amounts,
              SwapSide.SELL,
              blocknumber,
              pools,
            );
            console.log(`${asset} <> ${vault} Pool Prices: `, poolPrices);

            expect(poolPrices).not.toBeNull();
            checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
          });

          if (!cooldownEnabled && !withdrawDisabled) {
            it(`getPoolIdentifiers and getPricesVolume ${vault} -> ${asset} SELL`, async function () {
              const pools = await erc4626.getPoolIdentifiers(
                vaultToken,
                assetToken,
                SwapSide.SELL,
                blocknumber,
              );
              console.log(`${vault} <> ${asset} Pool Identifiers: `, pools);

              expect(pools.length).toBeGreaterThan(0);

              const poolPrices = await erc4626.getPricesVolume(
                vaultToken,
                assetToken,
                amounts,
                SwapSide.SELL,
                blocknumber,
                pools,
              );
              console.log(`${vault} <> ${asset} Pool Prices: `, poolPrices);

              expect(poolPrices).not.toBeNull();
              checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
            });
          }

          it(`getPoolIdentifiers and getPricesVolume ${asset} -> ${vault} BUY`, async function () {
            const pools = await erc4626.getPoolIdentifiers(
              assetToken,
              vaultToken,
              SwapSide.BUY,
              blocknumber,
            );
            console.log(`${asset} <> ${vault} Pool Identifiers: `, pools);

            expect(pools.length).toBeGreaterThan(0);

            const poolPrices = await erc4626.getPricesVolume(
              assetToken,
              vaultToken,
              amounts,
              SwapSide.BUY,
              blocknumber,
              pools,
            );
            console.log(`${asset} <> ${vault} Pool Prices: `, poolPrices);

            expect(poolPrices).not.toBeNull();
            checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
          });

          if (!cooldownEnabled && !withdrawDisabled) {
            it(`getPoolIdentifiers and getPricesVolume ${vault} -> ${asset} BUY`, async function () {
              const pools = await erc4626.getPoolIdentifiers(
                vaultToken,
                assetToken,
                SwapSide.BUY,
                blocknumber,
              );
              console.log(`${vault} <> ${asset} Pool Identifiers: `, pools);

              expect(pools.length).toBeGreaterThan(0);

              const poolPrices = await erc4626.getPricesVolume(
                vaultToken,
                assetToken,
                amounts,
                SwapSide.BUY,
                blocknumber,
                pools,
              );
              console.log(`${vault} <> ${asset} Pool Prices: `, poolPrices);

              expect(poolPrices).not.toBeNull();
              checkPoolPrices(poolPrices!, amounts, SwapSide.BUY, dexKey);
            });
          }

          it(`${asset} getTopPoolsForToken`, async function () {
            const poolLiquidity = await erc4626.getTopPoolsForToken(
              assetToken.address,
              10,
            );
            console.log(`${asset} Top Pools:`, poolLiquidity);

            checkPoolsLiquidity(poolLiquidity, assetToken.address, dexKey);
          });

          it(`${vault} getTopPoolsForToken`, async function () {
            const poolLiquidity = await erc4626.getTopPoolsForToken(
              vaultToken.address,
              10,
            );
            console.log(`${vault} Top Pools:`, poolLiquidity);

            checkPoolsLiquidity(poolLiquidity, vaultToken.address, dexKey);
          });
        });
      }
    });
  }
});
