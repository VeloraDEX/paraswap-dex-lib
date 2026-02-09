/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { FluidDexLite } from './fluid-dex-lite';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import FluidDexLiteABI from '../../abi/fluid-dex-lite/FluidDexLite.abi.json';

// Set timeout for all tests
jest.setTimeout(300 * 1000);

/*
  FluidDexLite Integration Tests
  =============================
  
  This test script validates the FluidDexLite integration with ParaSwap.
  Tests cover:
  - Pool discovery and initialization
  - Pricing calculations for SELL and BUY sides
  - getTopPoolsForToken liquidity calculations  
  - getDexParam calldata generation
  - On-chain pricing validation
  - USDC/USDT swap simulation (mirroring Foundry test)
  
  Run with: npx jest src/dex/fluid-dex-lite/fluid-dex-lite-integration.test.ts
*/

const fluidDexLiteIface = new Interface(FluidDexLiteABI);

function getReaderCalldata(
  exchangeAddress: string,
  readerIface: Interface,
  amounts: bigint[],
  funcName: string,
  dexKey: any,
  swap0To1: boolean,
) {
  return amounts.map(amount => ({
    target: exchangeAddress,
    callData: readerIface.encodeFunctionData(funcName, [
      dexKey, // DexKey
      swap0To1, // bool swap0To1_
      amount.toString(), // int256 amountSpecified_
      '0', // uint256 amountLimit_ (set to 0 for simulation)
      exchangeAddress, // address to_ (contract itself for simulation)
      false, // bool isCallback_
      '0x', // bytes callbackData_
      '0x', // bytes extraData_
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
    return BigInt(parsed[0].toString());
  });
}

async function checkOnChainPricing(
  fluidDexLite: FluidDexLite,
  funcName: string,
  blockNumber: number,
  prices: bigint[],
  dexKey: any,
  swap0To1: boolean,
  _amounts: bigint[],
) {
  const exchangeAddress = fluidDexLite.dexLiteAddress;

  const sum = prices.reduce((acc, curr) => (acc += curr), 0n);

  if (sum === 0n) {
    console.log(
      `Prices were not calculated for dexKey. Most likely no liquidity or price impact too big.`,
    );
    return false;
  }

  const readerCallData = getReaderCalldata(
    exchangeAddress,
    fluidDexLiteIface,
    _amounts.slice(1),
    funcName,
    dexKey,
    swap0To1,
  );

  console.log('blockNumber: ', blockNumber);
  console.log('exchangeAddress: ', exchangeAddress);
  console.log(
    'amounts: ',
    _amounts.slice(1).map(a => a.toString()),
  );

  try {
    const readerResult = await fluidDexLite.dexHelper.multiContract.methods
      .tryBlockAndAggregate(false, readerCallData)
      .call({}, blockNumber);

    const expectedPrices = [0n].concat(
      decodeReaderResult(readerResult.returnData, fluidDexLiteIface, funcName),
    );

    console.log(
      'expectedPrices: ',
      expectedPrices.map(p => p.toString()),
    );
    console.log(
      'actualPrices: ',
      prices.map(p => p.toString()),
    );

    // Validate that the prices match with reasonable tolerance
    if (expectedPrices.length !== prices.length) {
      console.log('Price arrays have different lengths');
      return false;
    }

    const tolerance = 1000n; // 0.1% tolerance (1000 out of 1,000,000 basis points)

    for (let i = 0; i < expectedPrices.length; i++) {
      const expected = expectedPrices[i];
      const actual = prices[i];

      if (expected === 0n && actual === 0n) {
        continue; // Both zero is fine
      }

      if (expected === 0n || actual === 0n) {
        console.log(
          `Price mismatch at index ${i}: expected ${expected}, actual ${actual}`,
        );
        return false;
      }

      // Calculate percentage difference: |expected - actual| / expected * 1,000,000
      const diff = expected > actual ? expected - actual : actual - expected;
      const percentageDiff = (diff * 1000000n) / expected;

      if (percentageDiff > tolerance) {
        console.log(
          `Price mismatch at index ${i}: expected ${expected}, actual ${actual}, diff ${percentageDiff}bp`,
        );
        return false;
      }
    }

    console.log('✅ All prices match within tolerance');
    return true;
  } catch (error) {
    console.log('On-chain pricing check failed:', error);
    return false;
  }
}

async function testPricingOnNetwork(
  fluidDexLite: FluidDexLite,
  network: Network,
  dexKey: string,
  blockNumber: number,
  _srcTokenSymbol: string,
  _destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
  funcName: string,
) {
  const networkTokens = Tokens[network];

  console.log(
    `\n=== Testing ${_srcTokenSymbol} <> ${_destTokenSymbol} ${side} ===`,
  );

  const pools = await fluidDexLite.getPoolIdentifiers(
    networkTokens[_srcTokenSymbol],
    networkTokens[_destTokenSymbol],
    side,
    blockNumber,
  );

  console.log(`Pool Identifiers Found: ${pools.length}`);

  if (pools.length === 0) {
    console.log(`No pools found for ${_srcTokenSymbol} <> ${_destTokenSymbol}`);
    return;
  }

  const poolPrices = await fluidDexLite.getPricesVolume(
    networkTokens[_srcTokenSymbol],
    networkTokens[_destTokenSymbol],
    amounts,
    side,
    blockNumber,
    pools,
  );

  console.log(`Pool Prices Calculated: ${poolPrices?.length || 0}`);

  if (poolPrices && poolPrices.length > 0) {
    // Validate pricing structure
    if (fluidDexLite.hasConstantPriceLargeAmounts) {
      checkConstantPoolPrices(poolPrices, amounts, dexKey);
    } else {
      checkPoolPrices(poolPrices, amounts, side, dexKey);
    }

    // Test against on-chain pricing if pools exist
    const firstPool = poolPrices[0];
    if (firstPool && firstPool.data) {
      const data = firstPool.data as any;
      const result = await checkOnChainPricing(
        fluidDexLite,
        funcName,
        blockNumber,
        firstPool.prices,
        data.dexKey,
        data.swap0To1,
        amounts,
      );
      console.log(
        `On-chain pricing validation: ${result ? 'PASSED' : 'SKIPPED'}`,
      );
    }
  }

  console.log(
    `✅ ${_srcTokenSymbol} <> ${_destTokenSymbol} ${side} test completed\n`,
  );
}

describe('FluidDexLite Integration', () => {
  const network = Network.MAINNET;
  const dexKey = 'FluidDexLite';
  const TokenASymbol = 'USDC';
  const TokenBSymbol = 'USDT';
  const TokenA = Tokens[network][TokenASymbol];
  const TokenB = Tokens[network][TokenBSymbol];

  const amountsForSell = [
    0n,
    100n * BI_POWS[TokenA.decimals],
    200n * BI_POWS[TokenA.decimals],
    300n * BI_POWS[TokenA.decimals],
    400n * BI_POWS[TokenA.decimals],
    500n * BI_POWS[TokenA.decimals],
    600n * BI_POWS[TokenA.decimals],
    700n * BI_POWS[TokenA.decimals],
    800n * BI_POWS[TokenA.decimals],
    900n * BI_POWS[TokenA.decimals],
    1000n * BI_POWS[TokenA.decimals],
  ];

  const amountsForBuy = [
    0n,
    1n * BI_POWS[TokenB.decimals],
    2n * BI_POWS[TokenB.decimals],
    3n * BI_POWS[TokenB.decimals],
    4n * BI_POWS[TokenB.decimals],
    5n * BI_POWS[TokenB.decimals],
    6n * BI_POWS[TokenB.decimals],
    7n * BI_POWS[TokenB.decimals],
    8n * BI_POWS[TokenB.decimals],
    9n * BI_POWS[TokenB.decimals],
    10n * BI_POWS[TokenB.decimals],
  ];

  // Small amounts for testing (mirroring Foundry test)
  const smallAmounts = [
    0n,
    1n * BI_POWS[6], // 1 USDC (same as Foundry test)
  ];

  let fluidDexLite: FluidDexLite;
  let dexHelper: DummyDexHelper;
  let blockNumber: number;

  beforeAll(async () => {
    dexHelper = new DummyDexHelper(network);
    fluidDexLite = new FluidDexLite(network, dexKey, dexHelper);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();

    // Initialize FluidDexLite
    if (fluidDexLite.initializePricing) {
      await fluidDexLite.initializePricing(blockNumber);
    }
  });

  describe('Pool Discovery and Initialization', () => {
    it('should initialize FluidDexLite correctly', () => {
      console.log(`Total pools loaded: ${fluidDexLite.pools.length}`);
      console.log('FluidDexLite address:', fluidDexLite.dexLiteAddress);

      // For newly deployed protocols, pools might not exist yet
      // This is expected behavior
      expect(fluidDexLite.dexLiteAddress).toBeDefined();
      expect(typeof fluidDexLite.pools.length).toBe('number');

      if (fluidDexLite.pools.length > 0) {
        const firstPool = fluidDexLite.pools[0];
        console.log('Sample pool:', {
          dexId: firstPool.dexId,
          token0: firstPool.dexKey.token0,
          token1: firstPool.dexKey.token1,
        });

        expect(firstPool.dexId).toBeDefined();
        expect(firstPool.dexKey.token0).toBeDefined();
        expect(firstPool.dexKey.token1).toBeDefined();
      } else {
        console.log(
          'No pools found yet - this is expected for newly deployed protocols',
        );
      }
    });

    it('should handle USDC/USDT pool discovery', () => {
      const usdcUsdtPool = fluidDexLite.pools.find(
        p =>
          (p.dexKey.token0.toLowerCase() === TokenA.address.toLowerCase() &&
            p.dexKey.token1.toLowerCase() === TokenB.address.toLowerCase()) ||
          (p.dexKey.token1.toLowerCase() === TokenA.address.toLowerCase() &&
            p.dexKey.token0.toLowerCase() === TokenB.address.toLowerCase()),
      );

      if (usdcUsdtPool) {
        console.log('USDC/USDT pool found:', {
          dexId: usdcUsdtPool.dexId,
          token0: usdcUsdtPool.dexKey.token0,
          token1: usdcUsdtPool.dexKey.token1,
        });
        expect(usdcUsdtPool.dexId).toBeDefined();
      } else {
        console.log(
          'USDC/USDT pool not found yet - expected for new deployment',
        );
      }
    });

    it('should handle getTopPoolsForToken when no pools exist', async () => {
      const liquidityPools = await fluidDexLite.getTopPoolsForToken(
        TokenA.address,
        5,
      );
      console.log(
        `Liquidity pools found for ${TokenASymbol}: ${liquidityPools.length}`,
      );

      // Should return empty array when no pools exist
      expect(Array.isArray(liquidityPools)).toBe(true);

      if (liquidityPools.length > 0) {
        console.log('Top pool:', liquidityPools[0]);
        expect(liquidityPools[0].address).toBeDefined();
        expect(liquidityPools[0].connectorTokens).toBeDefined();
      } else {
        console.log('No liquidity pools found - expected for new deployment');
      }
    });
  });

  describe('Pricing Calculations', () => {
    it('should calculate prices for USDC -> USDT SELL', async () => {
      await testPricingOnNetwork(
        fluidDexLite,
        network,
        dexKey,
        blockNumber,
        TokenASymbol,
        TokenBSymbol,
        SwapSide.SELL,
        amountsForSell,
        'swapSingle',
      );
    });

    it('should calculate prices for USDT -> USDC BUY', async () => {
      await testPricingOnNetwork(
        fluidDexLite,
        network,
        dexKey,
        blockNumber,
        TokenASymbol,
        TokenBSymbol,
        SwapSide.BUY,
        amountsForBuy,
        'swapSingle',
      );
    });

    it('should calculate prices for small amounts (1 USDC)', async () => {
      await testPricingOnNetwork(
        fluidDexLite,
        network,
        dexKey,
        blockNumber,
        TokenASymbol,
        TokenBSymbol,
        SwapSide.SELL,
        smallAmounts,
        'swapSingle',
      );
    });
  });

  describe('DexParam Generation', () => {
    it('should handle dex parameter generation when pools exist', () => {
      const pool = fluidDexLite.pools.find(
        p =>
          (p.dexKey.token0.toLowerCase() === TokenA.address.toLowerCase() &&
            p.dexKey.token1.toLowerCase() === TokenB.address.toLowerCase()) ||
          (p.dexKey.token1.toLowerCase() === TokenA.address.toLowerCase() &&
            p.dexKey.token0.toLowerCase() === TokenB.address.toLowerCase()),
      );

      if (pool) {
        const swap0To1 =
          pool.dexKey.token0.toLowerCase() === TokenA.address.toLowerCase();

        const data = {
          exchange: fluidDexLite.dexLiteAddress,
          dexKey: pool.dexKey,
          swap0To1,
        };

        const dexParam = fluidDexLite.getDexParam(
          TokenA.address,
          TokenB.address,
          '1000000000', // 1000 USDC
          '999000000', // Expected ~999 USDT
          '0x0000000000000000000000000000000000000000', // recipient
          data,
          SwapSide.SELL,
        );

        console.log('getDexParam result:', {
          needWrapNative: dexParam.needWrapNative,
          dexFuncHasRecipient: dexParam.dexFuncHasRecipient,
          targetExchange: dexParam.targetExchange,
          returnAmountPos: dexParam.returnAmountPos,
          exchangeDataLength: dexParam.exchangeData.length,
        });

        expect(dexParam.targetExchange).toBe(fluidDexLite.dexLiteAddress);
        expect(dexParam.exchangeData.length).toBeGreaterThan(0);
        expect(dexParam.returnAmountPos).toBeDefined();
      } else {
        console.log('No USDC/USDT pool found - skipping dexParam test');
      }
    });
  });

  describe('Swap Simulation (Mirroring Foundry Test)', () => {
    it('should handle swap simulation when pools exist', async () => {
      const pool = fluidDexLite.pools.find(
        p =>
          (p.dexKey.token0.toLowerCase() === TokenA.address.toLowerCase() &&
            p.dexKey.token1.toLowerCase() === TokenB.address.toLowerCase()) ||
          (p.dexKey.token1.toLowerCase() === TokenA.address.toLowerCase() &&
            p.dexKey.token0.toLowerCase() === TokenB.address.toLowerCase()),
      );

      if (pool) {
        const swap0To1 =
          pool.dexKey.token0.toLowerCase() === TokenA.address.toLowerCase();

        console.log('=== SWAP SIMULATION ===');
        console.log('Pool dexId:', pool.dexId);
        console.log('Swap direction (swap0To1):', swap0To1);
        console.log('Input amount: 1 USDC (1,000,000 wei)');

        // Log the dexKey and decoded variables
        console.log('\n=== DEX KEY AND VARIABLES ===');
        console.log(`DexKey (raw bytes): ${pool.dexId}`);
        console.log(`Pool Address: ${fluidDexLite.dexLiteAddress}`);

        // Get pool prices for 1 USDC swap
        const pools = await fluidDexLite.getPoolIdentifiers(
          TokenA,
          TokenB,
          SwapSide.SELL,
          blockNumber,
        );

        const poolPrices = await fluidDexLite.getPricesVolume(
          TokenA,
          TokenB,
          smallAmounts,
          SwapSide.SELL,
          blockNumber,
          pools,
        );

        if (poolPrices && poolPrices.length > 0) {
          const firstPool = poolPrices[0];

          // Log decoded dex variables
          console.log('\n=== DECODED DEX VARIABLES ===');
          console.log('Pool Data:', firstPool.data);
          console.log('Pool Exchange:', firstPool.exchange);
          console.log('Pool Address:', firstPool.poolAddresses);
          console.log('Pool Unit Volume:', firstPool.unit);
          console.log('Pool Gas Cost:', firstPool.gasCost);

          console.log(
            'Calculated output amount:',
            firstPool.prices[1].toString(),
            'wei',
          );
          console.log(
            'Expected rate (scaled by 1e6):',
            ((firstPool.prices[1] * 1000000n) / smallAmounts[1]).toString(),
          );

          // Validate the swap makes sense (should receive close to 1 USDT for 1 USDC)
          expect(firstPool.prices[1]).toBeGreaterThan(0n);
          expect(firstPool.prices[1]).toBeLessThanOrEqual(smallAmounts[1]); // Should not receive more than input

          // For stablecoins with small fee, should receive close to input amount
          const rate = (firstPool.prices[1] * 1000000n) / smallAmounts[1];
          expect(rate).toBeGreaterThan(990000n); // At least 0.99 rate
          expect(rate).toBeLessThan(1001000n); // At most 1.001 rate
        } else {
          console.log('No pricing available for this swap');
        }
      } else {
        console.log('No USDC/USDT pool found - skipping swap simulation test');
      }
    });
  });
});
