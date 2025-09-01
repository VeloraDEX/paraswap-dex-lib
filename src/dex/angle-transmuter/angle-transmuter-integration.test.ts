/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { AngleTransmuter } from './angle-transmuter';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address, Token } from '../../types';
import { TransmuterSubscriber } from './transmuter';
import { AngleTransmuterConfig } from './config';

export type Collateral = { [stablecoin: string]: Token[] };

/*
  README
  ======

  This test script adds tests for AngleTransmuter general integration
  with the DEX interface. The test cases below are example tests.
  It is recommended to add tests which cover AngleTransmuter specific
  logic.

  You can run this individual test script by running:
  `npx jest src/dex/angle-transmuter/angle-transmuter-integration.test.ts`

  (This comment should be removed from the final implementation)
*/

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  tokenIn: Address,
  tokenOut: Address,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      amount,
      tokenIn,
      tokenOut,
    ]),
  }));
}

function decodeReaderResult(
  results: Result,
  readerIface: Interface,
  funcName: string,
) {
  return results.map(result => {
    const parsed = readerIface.decodeFunctionResult(funcName, result);
    return BigInt(parsed[0]._hex);
  });
}

function getExchangeAddress(
  network: Network,
  srcAddress: Address,
  dstAddress: Address,
): Address {
  const config = AngleTransmuterConfig.AngleTransmuter[network];
  const transmuter =
    srcAddress.toLowerCase() === config.EUR?.stablecoin.address.toLowerCase() ||
    dstAddress.toLowerCase() === config.EUR?.stablecoin.address.toLowerCase()
      ? config.EUR?.transmuter
      : config.USD?.transmuter;
  return transmuter!;
}

async function checkOnChainPricing(
  network: Network,
  angleTransmuter: AngleTransmuter,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  amounts: bigint[],
  tokenIn: Address,
  tokenOut: Address,
) {
  const exchangeAddress = getExchangeAddress(network, tokenIn, tokenOut);
  const readerIface = TransmuterSubscriber.transmuterCrosschainInterface;

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    readerIface,
    amounts.slice(1),
    funcName,
    tokenIn,
    tokenOut,
  );

  const readerResult = (
    await angleTransmuter.dexHelper.multiContract.methods
      .aggregate(readerCallData)
      .call({}, blockNumber)
  ).returnData;

  const expectedPrices = [0n].concat(
    decodeReaderResult(readerResult, readerIface, funcName),
  );

  // No exact computation because of the bigInt approx
  for (let i = 0; i < expectedPrices.length; ++i) {
    expect(prices[i]).toBeGreaterThanOrEqual(
      (expectedPrices[i] * 99999n) / 100000n,
    );
    expect(prices[i]).toBeLessThanOrEqual(
      (expectedPrices[i] * 100001n) / 100000n,
    );
  }
}

async function testPricingOnNetwork(
  angleTransmuter: AngleTransmuter,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcNameToCheck: string,
) {
  const networkTokens = Tokens[network];

  const pools = await angleTransmuter.getPoolIdentifiers(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: `,
    pools,
  );

  expect(pools.length).toBeGreaterThan(0);

  const poolPrices = await angleTransmuter.getPricesVolume(
    networkTokens[srcTokenSymbol],
    networkTokens[destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  if (angleTransmuter.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check if onchain pricing equals to calculated ones
  await checkOnChainPricing(
    network,
    angleTransmuter,
    funcNameToCheck,
    blockNumber,
    poolPrices![0].prices,
    amounts,
    networkTokens[srcTokenSymbol].address,
    networkTokens[destTokenSymbol].address,
  );
}

describe('AngleTransmuter', () => {
  const dexKey = 'AngleTransmuter';
  let blockNumber: number;
  let angleTransmuter: AngleTransmuter;

  const networks = [Network.MAINNET, Network.ARBITRUM, Network.BASE];
  // const networks = [Network.MAINNET];
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
    describe(`${Network[network]}`, () => {
      const dexHelper = new DummyDexHelper(network);

      const tokens = Tokens[network];

      const stables = stablesPerNetwork[network];
      const collaterals = collateralsPerNetwork[network];

      const isKYC: { [token: string]: boolean } = {};
      if (network === Network.MAINNET) {
        isKYC[tokens.bIB01.symbol!] = true;
        isKYC[tokens.bC3M.symbol!] = true;
        isKYC[tokens.bERNX.symbol!] = true;
      }

      const amounts = [
        0n,
        1n * BI_POWS[tokens.USDA.decimals],
        2n * BI_POWS[tokens.USDA.decimals],
        3n * BI_POWS[tokens.USDA.decimals],
        4n * BI_POWS[tokens.USDA.decimals],
        5n * BI_POWS[tokens.USDA.decimals],
        6n * BI_POWS[tokens.USDA.decimals],
        7n * BI_POWS[tokens.USDA.decimals],
        8n * BI_POWS[tokens.USDA.decimals],
        9n * BI_POWS[tokens.USDA.decimals],
        10n * BI_POWS[tokens.USDA.decimals],
      ];

      beforeAll(async () => {
        blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        angleTransmuter = new AngleTransmuter(network, dexKey, dexHelper);
        if (angleTransmuter.initializePricing) {
          await angleTransmuter.initializePricing(blockNumber);
        }
      });

      stables.forEach(stable =>
        collaterals[stable.symbol! as keyof Collateral].forEach(collateral =>
          describe(`${stable.symbol}/${collateral.symbol}`, () => {
            const amountsCollateral = [
              0n,
              1n * BI_POWS[collateral.decimals],
              2n * BI_POWS[collateral.decimals],
              3n * BI_POWS[collateral.decimals],
              4n * BI_POWS[collateral.decimals],
              5n * BI_POWS[collateral.decimals],
              6n * BI_POWS[collateral.decimals],
              7n * BI_POWS[collateral.decimals],
              8n * BI_POWS[collateral.decimals],
              9n * BI_POWS[collateral.decimals],
              10n * BI_POWS[collateral.decimals],
            ];

            it('getTopPoolsForToken - collateral', async () => {
              // We have to check without calling initializePricing, because
              // pool-tracker is not calling that function
              const newAngleTransmuter = new AngleTransmuter(
                network,
                dexKey,
                dexHelper,
              );
              if (newAngleTransmuter.updatePoolState) {
                await newAngleTransmuter.updatePoolState();
              }
              const poolLiquidity =
                await newAngleTransmuter.getTopPoolsForToken(
                  collateral.address,
                  10,
                );
              console.log(
                `${collateral.symbol}: ${collateral.address} Top Pools:`,
                JSON.stringify(poolLiquidity, null, 2),
              );

              if (!newAngleTransmuter.hasConstantPriceLargeAmounts) {
                checkPoolsLiquidity(poolLiquidity, collateral.address, dexKey);
              }
            });

            it('getTopPoolsForToken - stablecoin', async () => {
              // We have to check without calling initializePricing, because
              // pool-tracker is not calling that function
              const newAngleTransmuter = new AngleTransmuter(
                network,
                dexKey,
                dexHelper,
              );
              if (newAngleTransmuter.updatePoolState) {
                await newAngleTransmuter.updatePoolState();
              }
              const poolLiquidity =
                await newAngleTransmuter.getTopPoolsForToken(
                  stable.address,
                  10,
                );
              console.log(
                `${stable.symbol}: ${stable.address} Top Pools:`,
                JSON.stringify(poolLiquidity, null, 2),
              );

              if (!newAngleTransmuter.hasConstantPriceLargeAmounts) {
                checkPoolsLiquidity(poolLiquidity, stable.address, dexKey);
              }
            });

            it('getPoolIdentifiers and getPricesVolume SELL - collateral', async () => {
              await testPricingOnNetwork(
                angleTransmuter,
                network,
                dexKey,
                blockNumber,
                collateral.symbol!,
                stable.symbol!,
                SwapSide.SELL,
                amountsCollateral,
                'quoteIn',
              );
            });

            it('getPoolIdentifiers and getPricesVolume BUY - collateral', async () => {
              await testPricingOnNetwork(
                angleTransmuter,
                network,
                dexKey,
                blockNumber,
                collateral.symbol!,
                stable.symbol!,
                SwapSide.BUY,
                amounts,
                'quoteOut',
              );
            });

            if (!isKYC[collateral.symbol!]) {
              it('getPoolIdentifiers and getPricesVolume SELL - stablecoin', async () => {
                await testPricingOnNetwork(
                  angleTransmuter,
                  network,
                  dexKey,
                  blockNumber,
                  stable.symbol!,
                  collateral.symbol!,
                  SwapSide.SELL,
                  amounts,
                  'quoteIn',
                );
              });

              it('getPoolIdentifiers and getPricesVolume BUY - stablecoin', async () => {
                await testPricingOnNetwork(
                  angleTransmuter,
                  network,
                  dexKey,
                  blockNumber,
                  stable.symbol!,
                  collateral.symbol!,
                  SwapSide.BUY,
                  amountsCollateral,
                  'quoteOut',
                );
              });
            }
          }),
        ),
      );
    }),
  );
});
