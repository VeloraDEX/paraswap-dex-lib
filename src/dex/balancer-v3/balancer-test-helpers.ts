/* eslint-disable no-console */
import { Token } from '../../types';

// Note - this is currently needed because queries won't work with multicall but should be updated in future
export async function checkOnChainPricingNonMulti(
  network: number,
  side: SwapSide,
  balancerV3: BalancerV3,
  blockNumber: number,
  prices: ExchangePrices<BalancerV3Data>,
  amounts: bigint[],
) {
  // test match for each returned price
  for (const price of prices) {
    let expectedPrices: bigint[] = [];
    if (price.data.steps.length === 1 && !price.data.steps[0].isBuffer)
      expectedPrices = await querySinglePathPrices(
        network,
        side,
        balancerV3,
        blockNumber,
        price,
        amounts,
      );
    else
      expectedPrices = await queryMultiPathPrices(
        network,
        side,
        balancerV3,
        blockNumber,
        price,
        amounts,
      );
    expect(price.prices).toEqual(expectedPrices);
  }
}

async function querySinglePathPrices(
  network: number,
  side: SwapSide,
  balancerV3: BalancerV3,
  blockNumber: number,
  price: PoolPrices<BalancerV3Data>,
  amounts: bigint[],
) {
  const balancerRouter = new Interface(balancerRouterAbi);
  const readerCallData = getQuerySwapSingleTokenCalldata(
    BalancerV3Config.BalancerV3[network].balancerRouterAddress,
    balancerRouter,
    amounts,
    price.data.steps[0],
    side,
  );

  const expectedPrices = [0n];
  for (const call of readerCallData) {
    try {
      const result = await balancerV3.dexHelper.provider.call(
        {
          to: call.target,
          data: call.callData,
        },
        blockNumber,
      );
      const parsed = balancerRouter.decodeFunctionResult(
        side === SwapSide.SELL
          ? `querySwapSingleTokenExactIn`
          : `querySwapSingleTokenExactOut`,
        result,
      );
      expectedPrices.push(BigInt(parsed[0]._hex));
    } catch (error) {
      console.log('Error in querySinglePathPrices', error);
      expectedPrices.push(0n);
    }
  }
  return expectedPrices;
}

async function queryMultiPathPrices(
  network: number,
  side: SwapSide,
  balancerV3: BalancerV3,
  blockNumber: number,
  price: PoolPrices<BalancerV3Data>,
  amounts: bigint[],
) {
  const balancerBatchRouter = new Interface(balancerBatchRouterAbi);
  const readerCallData = getQuerySwapMultiTokenCalldata(
    BalancerV3Config.BalancerV3[network].balancerBatchRouterAddress,
    balancerBatchRouter,
    amounts,
    price.data.steps,
    side,
  );

  const expectedPrices = [0n];
  for (const call of readerCallData) {
    try {
      const result = await balancerV3.dexHelper.provider.call(
        {
          to: call.target,
          data: call.callData,
        },
        blockNumber,
      );
      const parsed = balancerBatchRouter.decodeFunctionResult(
        side === SwapSide.SELL ? `querySwapExactIn` : `querySwapExactOut`,
        result,
      );
      expectedPrices.push(BigInt(parsed[2][0]._hex));
    } catch (error) {
      console.log('Error in queryMultiPathPrices', error);
      expectedPrices.push(0n);
    }
  }
  return expectedPrices;
}

function getQuerySwapSingleTokenCalldata(
  routerAddress: Address,
  routerInterface: Interface,
  amounts: bigint[],
  step: Step,
  side: SwapSide,
) {
  return amounts
    .filter(amount => amount !== 0n)
    .map(amount => {
      return {
        target: routerAddress,
        callData: routerInterface.encodeFunctionData(
          side === SwapSide.SELL
            ? `querySwapSingleTokenExactIn`
            : `querySwapSingleTokenExactOut`,
          [
            step.pool,
            step.swapInput.tokenIn,
            step.swapInput.tokenOut,
            amount,
            NULL_ADDRESS,
            '0x',
          ],
        ),
      };
    });
}
/* eslint-disable no-console */
import { Interface } from '@ethersproject/abi';
import { NULL_ADDRESS, SwapSide } from '../../constants';
import { BalancerV3 } from './balancer-v3';
import { BalancerV3Config } from './config';
import { BalancerV3Data, Step } from './types';
import { Address, ExchangePrices, PoolPrices } from '../../types';
import balancerBatchRouterAbi from '../../abi/balancer-v3/batch-router.json';
import balancerRouterAbi from '../../abi/balancer-v3/router.json';

function getQuerySwapMultiTokenCalldata(
  routerAddress: Address,
  routerInterface: Interface,
  amounts: bigint[],
  steps: Step[],
  side: SwapSide,
) {
  const tokenIn = steps[0].swapInput.tokenIn;
  const stepsNew = steps.map(s => ({
    pool: s.pool,
    tokenOut: s.swapInput.tokenOut,
    isBuffer: s.isBuffer,
  }));
  return amounts
    .filter(amount => amount !== 0n)
    .map(amount => {
      let args: any[] = [];
      if (side === SwapSide.SELL)
        args = [
          {
            tokenIn,
            steps: stepsNew,
            exactAmountIn: amount,
            minAmountOut: 0n,
          },
        ];
      else
        args = [
          {
            tokenIn,
            steps: stepsNew,
            exactAmountOut: amount,
            maxAmountIn: 0n,
          },
        ];
      return {
        target: routerAddress,
        callData: routerInterface.encodeFunctionData(
          side === SwapSide.SELL ? `querySwapExactIn` : `querySwapExactOut`,
          [args, NULL_ADDRESS, '0x'],
        ),
      };
    });
}

export function allPricesAreZero(arr: { prices: bigint[] }[]): boolean {
  // Check if the array is empty first
  if (arr.length === 0) return false;

  // Iterate through each object in the array
  for (const obj of arr) {
    // Check if this object has any non-zero price
    const hasNonZeroPrice = obj.prices.some(price => price !== 0n);

    // If we found even one non-zero price, return false
    if (hasNonZeroPrice) {
      return false;
    }
  }

  // If we got here, all prices in all objects are 0n
  return true;
}

export async function testPricesVsOnchain(
  balancerV3: BalancerV3,
  network: number,
  amounts: bigint[],
  srcToken: Token,
  dstToken: Token,
  side: SwapSide,
  blockNumber: number,
  limitPools: string[],
) {
  const prices = await balancerV3.getPricesVolume(
    srcToken,
    dstToken,
    amounts,
    side,
    blockNumber,
    limitPools,
  );
  expect(prices).not.toBeNull();
  expect(prices?.length).toBeGreaterThan(0);
  expect(allPricesAreZero(prices!)).toBe(false);
  await checkOnChainPricingNonMulti(
    network,
    side,
    balancerV3,
    blockNumber,
    prices as ExchangePrices<BalancerV3Data>,
    amounts,
  );
}
