/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { getBigIntPow } from '../../utils';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { Address } from '../../types';
import { OSwap } from './oswap';
import { OSwapPool, OSwapPoolState } from './types';

async function getOnchainState(
  oswap: OSwap,
  pool: OSwapPool,
  blockNumber: number,
): Promise<OSwapPoolState> {
  const eventPool = oswap.eventPools[pool.id];
  if (!eventPool) {
    throw new Error(`No EventPool found for pool ${pool.id}`);
  }
  return eventPool.generateState(blockNumber);
}

function hasEnoughLiquidity(
  pool: OSwapPool,
  state: OSwapPoolState,
  from: Address,
  amount: bigint,
  needed: bigint,
  side: SwapSide,
): boolean {
  const outstandingWithdrawals =
    BigInt(state.withdrawsQueued) - BigInt(state.withdrawsClaimed);

  if (outstandingWithdrawals > 0n) {
    if (needed + outstandingWithdrawals > BigInt(state.balance0)) {
      return false;
    }
  }

  if (side === SwapSide.SELL) {
    return from.toLowerCase() === pool.token0
      ? needed <= BigInt(state.balance1)
      : needed <= BigInt(state.balance0);
  }

  return from.toLowerCase() === pool.token0
    ? amount <= BigInt(state.balance1)
    : amount <= BigInt(state.balance0);
}

function calcPriceFromState(
  oswap: OSwap,
  pool: OSwapPool,
  state: OSwapPoolState,
  from: Address,
  amount: bigint,
  side: SwapSide,
): bigint {
  let convertedAmount: bigint;
  if (side === SwapSide.BUY && pool.erc4626) {
    const assetToken = pool.erc4626.assetToken.toLowerCase();
    const vaultToken = pool.erc4626.vaultToken.toLowerCase();
    const tokenToConvert =
      from.toLowerCase() === assetToken ? vaultToken : assetToken;

    convertedAmount = oswap.convertAmount(pool, tokenToConvert, amount, state);
  } else {
    convertedAmount = oswap.convertAmount(pool, from, amount, state);
  }

  const rate =
    from.toLowerCase() === pool.token0
      ? BigInt(state.traderate0)
      : BigInt(state.traderate1);

  const price =
    side === SwapSide.SELL
      ? (convertedAmount * rate) / getBigIntPow(36)
      : convertedAmount === 0n
      ? 0n
      : (convertedAmount * getBigIntPow(36)) / rate + 3n;

  if (!hasEnoughLiquidity(pool, state, from, amount, price, side)) {
    return 0n;
  }

  return price;
}

// Check prices passed as arguments against prices calculated from on-chain data.
async function checkOnChainPricing(
  oswap: OSwap,
  pool: OSwapPool,
  blockNumber: number,
  prices: bigint[],
  side: SwapSide,
  srcAddress: Address,
  amounts: bigint[],
) {
  const state = await getOnchainState(oswap, pool, blockNumber);
  const expectedPrices = amounts.map(amount =>
    calcPriceFromState(oswap, pool, state, srcAddress, amount, side),
  );
  expect(prices).toEqual(expectedPrices);
}

async function testPricingOnNetwork(
  oswap: OSwap,
  network: Network,
  dexKey: string,
  blockNumber: number,
  srcTokenSymbol: string,
  destTokenSymbol: string,
  side: SwapSide,
  amounts: bigint[],
) {
  const networkTokens = Tokens[network];
  const srcToken = networkTokens[srcTokenSymbol];
  const destToken = networkTokens[destTokenSymbol];

  const poolIds = await oswap.getPoolIdentifiers(
    srcToken,
    destToken,
    side,
    blockNumber,
  );
  console.log(
    `${srcTokenSymbol} <> ${destTokenSymbol} Pool Identifiers: ${poolIds}`,
  );

  expect(poolIds.length).toBeGreaterThan(0);

  // Get calculated prices based on the stored state.
  const poolPrices = await oswap.getPricesVolume(
    srcToken,
    destToken,
    amounts,
    side,
    blockNumber,
    poolIds,
  );
  console.log(
    `${side} ${srcTokenSymbol} <> ${destTokenSymbol} Pool Prices: `,
    poolPrices,
  );

  expect(poolPrices).not.toBeNull();
  if (oswap.hasConstantPriceLargeAmounts) {
    checkConstantPoolPrices(poolPrices!, amounts, dexKey);
  } else {
    checkPoolPrices(poolPrices!, amounts, side, dexKey);
  }

  // Check that the prices calculated from onchain data match with the ones calculated from the stored state.
  const pool = oswap.getPoolById(poolIds[0]);
  expect(pool).not.toBeNull();
  await checkOnChainPricing(
    oswap,
    pool as OSwapPool,
    blockNumber,
    poolPrices![0].prices,
    side,
    srcToken.address,
    amounts,
  );
}

describe('OSwap', function () {
  const dexKey = 'OSwap';
  let blockNumber: number;
  let oswap: OSwap;

  describe('Mainnet - WETH/STETH Pool', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'STETH';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals],
      2n * BI_POWS[tokens[destTokenSymbol].decimals],
      3n * BI_POWS[tokens[destTokenSymbol].decimals],
      4n * BI_POWS[tokens[destTokenSymbol].decimals],
      5n * BI_POWS[tokens[destTokenSymbol].decimals],
      6n * BI_POWS[tokens[destTokenSymbol].decimals],
      7n * BI_POWS[tokens[destTokenSymbol].decimals],
      8n * BI_POWS[tokens[destTokenSymbol].decimals],
      9n * BI_POWS[tokens[destTokenSymbol].decimals],
      10n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    // Return a blockNumber to use for the tests.
    // Check that the pool has enough liquidity to run the tests at the current blockNumber.
    // If not, fallback to a known blockNumber in the past with
    // high enough liquidity - the on-chain queries will just be a bit slower to execute.
    async function getBlockNumberForTesting(oswap: OSwap): Promise<number> {
      const DEFAULT_BLOCK_NUMBER = 18888241;

      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const srcToken = Tokens[network][srcTokenSymbol];
      const destToken = Tokens[network][destTokenSymbol];

      // Get the pool and its state for the given test pair.
      const pool = oswap.getPoolByTokenPair(srcToken, destToken);
      if (!pool)
        throw new Error(
          `No pool found for pair ${srcTokenSymbol}-${destTokenSymbol}`,
        );

      const eventPool = oswap.eventPools[pool.id];
      const state = await eventPool.getStateOrGenerate(blockNumber, true);

      const minBalance =
        state.balance0 < state.balance1 ? state.balance0 : state.balance1;
      const maxAmount = [...amountsForSell, ...amountsForBuy].reduce(
        (max, amount) => (amount > max ? amount : max),
      );
      const hasEnoughLiquidity = BigInt(minBalance) > maxAmount;

      if (!hasEnoughLiquidity) {
        return DEFAULT_BLOCK_NUMBER;
      }
      return blockNumber;
    }

    beforeAll(async () => {
      oswap = new OSwap(network, dexKey, dexHelper);

      blockNumber = await getBlockNumberForTesting(oswap);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it(`getTopPoolsForToken ${srcTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );

      console.log(`${srcTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken ${destTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );

      console.log(`${destTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Sonic - WS/OS Pool', () => {
    const network = Network.SONIC;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WS';
    const destTokenSymbol = 'OS';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals],
      2n * BI_POWS[tokens[destTokenSymbol].decimals],
      3n * BI_POWS[tokens[destTokenSymbol].decimals],
      4n * BI_POWS[tokens[destTokenSymbol].decimals],
      5n * BI_POWS[tokens[destTokenSymbol].decimals],
      6n * BI_POWS[tokens[destTokenSymbol].decimals],
      7n * BI_POWS[tokens[destTokenSymbol].decimals],
      8n * BI_POWS[tokens[destTokenSymbol].decimals],
      9n * BI_POWS[tokens[destTokenSymbol].decimals],
      10n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    // Return a blockNumber to use for the tests.
    // Check that the pool has enough liquidity to run the tests at the current blockNumber.
    // If not, fallback to a known blockNumber in the past with
    // high enough liquidity - the on-chain queries will just be a bit slower to execute.
    async function getBlockNumberForTesting(oswap: OSwap): Promise<number> {
      const DEFAULT_BLOCK_NUMBER = 41000000;

      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const srcToken = Tokens[network][srcTokenSymbol];
      const destToken = Tokens[network][destTokenSymbol];

      // Get the pool and its state for the given test pair.
      const pool = oswap.getPoolByTokenPair(srcToken, destToken);
      if (!pool)
        throw new Error(
          `No pool found for pair ${srcTokenSymbol}-${destTokenSymbol}`,
        );

      const eventPool = oswap.eventPools[pool.id];
      const state = await eventPool.getStateOrGenerate(blockNumber, true);

      const minBalance =
        state.balance0 < state.balance1 ? state.balance0 : state.balance1;
      const maxAmount = [...amountsForSell, ...amountsForBuy].reduce(
        (max, amount) => (amount > max ? amount : max),
      );
      const hasEnoughLiquidity = BigInt(minBalance) > maxAmount;

      if (!hasEnoughLiquidity) {
        return DEFAULT_BLOCK_NUMBER;
      }
      return blockNumber;
    }

    beforeAll(async () => {
      oswap = new OSwap(network, dexKey, dexHelper);

      blockNumber = await getBlockNumberForTesting(oswap);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it(`getTopPoolsForToken ${srcTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );

      console.log(`${srcTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken ${destTokenSymbol}`, async function () {
      // We have to check without calling initializePricing, because
      // pool-tracker is not calling that function
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );

      console.log(`${destTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Mainnet - USDe/sUSDe Pool', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'USDE';
    const destTokenSymbol = 'SUSDE';

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals],
      2n * BI_POWS[tokens[destTokenSymbol].decimals],
      3n * BI_POWS[tokens[destTokenSymbol].decimals],
      4n * BI_POWS[tokens[destTokenSymbol].decimals],
      5n * BI_POWS[tokens[destTokenSymbol].decimals],
      6n * BI_POWS[tokens[destTokenSymbol].decimals],
      7n * BI_POWS[tokens[destTokenSymbol].decimals],
      8n * BI_POWS[tokens[destTokenSymbol].decimals],
      9n * BI_POWS[tokens[destTokenSymbol].decimals],
    ];

    async function getBlockNumberForTesting(oswap: OSwap): Promise<number> {
      const DEFAULT_BLOCK_NUMBER = 24174745;

      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      const srcToken = Tokens[network][srcTokenSymbol];
      const destToken = Tokens[network][destTokenSymbol];

      const pool = oswap.getPoolByTokenPair(srcToken, destToken);
      if (!pool)
        throw new Error(
          `No pool found for pair ${srcTokenSymbol}-${destTokenSymbol}`,
        );

      const eventPool = oswap.eventPools[pool.id];
      const state = await eventPool.getStateOrGenerate(blockNumber, true);

      const minBalance =
        state.balance0 < state.balance1 ? state.balance0 : state.balance1;
      const maxAmount = [...amountsForSell, ...amountsForBuy].reduce(
        (max, amount) => (amount > max ? amount : max),
      );
      const hasEnoughLiquidity = BigInt(minBalance) > maxAmount;

      if (!hasEnoughLiquidity) {
        return DEFAULT_BLOCK_NUMBER;
      }
      return blockNumber;
    }

    beforeAll(async () => {
      oswap = new OSwap(network, dexKey, dexHelper);

      blockNumber = await getBlockNumberForTesting(oswap);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it(`getTopPoolsForToken ${srcTokenSymbol}`, async function () {
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );

      console.log(`${srcTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken ${destTokenSymbol}`, async function () {
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );

      console.log(`${destTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });

  describe('Mainnet - WETH/eETH Pool', () => {
    const network = Network.MAINNET;
    const dexHelper = new DummyDexHelper(network);

    const tokens = Tokens[network];

    const srcTokenSymbol = 'WETH';
    const destTokenSymbol = 'eETH';

    let blockNumber: number;
    let oswap: OSwap;

    const amountsForSell = [
      0n,
      1n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      2n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      3n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      4n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      5n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      6n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      7n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      8n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      9n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
      10n * BI_POWS[tokens[srcTokenSymbol].decimals - 3],
    ];

    const amountsForBuy = [
      0n,
      1n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      2n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      3n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      4n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      5n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      6n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      7n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      8n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      9n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
      10n * BI_POWS[tokens[destTokenSymbol].decimals - 3],
    ];

    async function getBlockNumberForTesting(oswap: OSwap): Promise<number> {
      const DEFAULT_BLOCK_NUMBER = 24174745;

      const currentBlockNumber =
        await dexHelper.web3Provider.eth.getBlockNumber();
      const srcToken = Tokens[network][srcTokenSymbol];
      const destToken = Tokens[network][destTokenSymbol];

      const pool = oswap.getPoolByTokenPair(srcToken, destToken);
      if (!pool)
        throw new Error(
          `No pool found for pair ${srcTokenSymbol}-${destTokenSymbol}`,
        );

      const eventPool = oswap.eventPools[pool.id];
      const state = await eventPool.getStateOrGenerate(
        currentBlockNumber,
        true,
      );

      const minBalance =
        state.balance0 < state.balance1 ? state.balance0 : state.balance1;
      const maxAmount = [...amountsForSell, ...amountsForBuy].reduce(
        (max, amount) => (amount > max ? amount : max),
      );
      const hasEnoughLiquidity = BigInt(minBalance) > maxAmount;

      if (!hasEnoughLiquidity) {
        return DEFAULT_BLOCK_NUMBER;
      }
      return currentBlockNumber;
    }

    beforeAll(async () => {
      oswap = new OSwap(network, dexKey, dexHelper);

      blockNumber = await getBlockNumberForTesting(oswap);
    });

    it('getPoolIdentifiers and getPricesVolume SELL', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.SELL,
        amountsForSell,
      );
    });

    it('getPoolIdentifiers and getPricesVolume BUY', async function () {
      await testPricingOnNetwork(
        oswap,
        network,
        dexKey,
        blockNumber,
        srcTokenSymbol,
        destTokenSymbol,
        SwapSide.BUY,
        amountsForBuy,
      );
    });

    it(`getTopPoolsForToken ${srcTokenSymbol}`, async function () {
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[srcTokenSymbol].address,
        10,
      );

      console.log(`${srcTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][srcTokenSymbol].address,
          dexKey,
        );
      }
    });

    it(`getTopPoolsForToken ${destTokenSymbol}`, async function () {
      const newOSwap = new OSwap(network, dexKey, dexHelper);
      await newOSwap.updatePoolState?.();

      const poolLiquidity = await newOSwap.getTopPoolsForToken(
        tokens[destTokenSymbol].address,
        10,
      );

      console.log(`${destTokenSymbol} top pools:`, poolLiquidity);

      if (!newOSwap.hasConstantPriceLargeAmounts) {
        checkPoolsLiquidity(
          poolLiquidity,
          Tokens[network][destTokenSymbol].address,
          dexKey,
        );
      }
    });
  });
});
