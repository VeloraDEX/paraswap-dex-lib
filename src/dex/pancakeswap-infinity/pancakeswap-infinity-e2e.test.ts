import dotenv from 'dotenv';
dotenv.config();

import { Network, SwapSide, ContractMethod } from '../../constants';
import { OptimalRate } from '../../types';
import { ParaSwapVersion } from '@paraswap/core';
import { generateConfig } from '../../config';
import { Pool } from './types';
import { testPriceRoute } from '../../../tests/utils-e2e';

const network = Network.BSC;
const dexKey = 'pancakeswapinfinity';
const config = generateConfig(network);

type TestRoute = {
  name: string;
  srcToken: string;
  destToken: string;
  srcDecimals: number;
  destDecimals: number;
  srcAmount: string;
  destAmount: string;
  blockNumber: number;
  side: SwapSide;
  zeroForOne: boolean;
  pool: Pool;
};

// NOTE: pools whose `hooks` address registers callbacks (non-zero hooks
// registration bitmap, lower 16 bits of the on-chain `parameters` bytes32)
// cannot be round-tripped through this encoder yet — see `encodeParameters`
// in ./encoder.ts. The `parameters` it produces will not match the pool's
// on-chain value, so `poolId = keccak256(poolKey)` mismatches and swaps
// revert. Only add test routes for pools with `hooks = address(0)` (or hook
// contracts that register no callbacks) until that's fixed.
const testRoutes: TestRoute[] = [
  {
    // CAKE -> BNB via CLPool (no hooks)
    name: 'CAKE -> BNB (zeroForOne=false, no hooks)',
    srcToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    destToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    srcDecimals: 18,
    destDecimals: 18,
    srcAmount: '100000000000000000',
    destAmount: '245941671201085',
    blockNumber: 91350721,
    side: SwapSide.SELL,
    zeroForOne: false,
    pool: {
      id: '0x0000000000000000000000000000000000000000000000000000000000000002',
      key: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
        hooks: '0x0000000000000000000000000000000000000000',
        poolManager: '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b',
        fee: '335',
        tickSpacing: 100,
      },
    },
  },
  {
    // CAKE -> WBNB via CLPool (no hooks)
    name: 'CAKE -> WBNB (zeroForOne=false, no hooks, native pool)',
    srcToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    destToken: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    srcDecimals: 18,
    destDecimals: 18,
    srcAmount: '100000000000000000',
    destAmount: '245941671201085',
    blockNumber: 91350721,
    side: SwapSide.SELL,
    zeroForOne: false,
    pool: {
      id: '0x0000000000000000000000000000000000000000000000000000000000000003',
      key: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
        hooks: '0x0000000000000000000000000000000000000000',
        poolManager: '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b',
        fee: '335',
        tickSpacing: 100,
      },
    },
  },
  {
    // BNB -> CAKE via CLPool (no hooks, zeroForOne=true, tickSpacing=1)
    name: 'BNB -> CAKE (zeroForOne=true, no hooks, tickSpacing=1)',
    srcToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    destToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    srcDecimals: 18,
    destDecimals: 18,
    srcAmount: '100000000000000000',
    destAmount: '39284658135310027224',
    blockNumber: 91356408,
    side: SwapSide.SELL,
    zeroForOne: true,
    pool: {
      id: '0x0000000000000000000000000000000000000000000000000000000000000004',
      key: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
        hooks: '0x0000000000000000000000000000000000000000',
        poolManager: '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b',
        fee: '335',
        tickSpacing: 1,
      },
    },
  },
  {
    // WBNB -> CAKE via CLPool (no hooks, zeroForOne=true, tickSpacing=1)
    name: 'WBNB -> CAKE (zeroForOne=true, no hooks, native pool, tickSpacing=1)',
    srcToken: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
    destToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    srcDecimals: 18,
    destDecimals: 18,
    srcAmount: '100000000000000000',
    destAmount: '39284658135310027224',
    blockNumber: 91356408,
    side: SwapSide.SELL,
    zeroForOne: true,
    pool: {
      id: '0x0000000000000000000000000000000000000000000000000000000000000005',
      key: {
        currency0: '0x0000000000000000000000000000000000000000',
        currency1: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
        hooks: '0x0000000000000000000000000000000000000000',
        poolManager: '0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b',
        fee: '335',
        tickSpacing: 1,
      },
    },
  },
];

function buildPriceRoute(route: TestRoute): OptimalRate {
  return {
    blockNumber: route.blockNumber,
    network,
    srcToken: route.srcToken,
    srcDecimals: route.srcDecimals,
    srcAmount: route.srcAmount,
    srcUSD: '0',
    destToken: route.destToken,
    destDecimals: route.destDecimals,
    destAmount: route.destAmount,
    destUSD: '0',
    bestRoute: [
      {
        percent: 100,
        swaps: [
          {
            srcToken: route.srcToken,
            srcDecimals: route.srcDecimals,
            destToken: route.destToken,
            destDecimals: route.destDecimals,
            swapExchanges: [
              {
                exchange: dexKey,
                srcAmount: route.srcAmount,
                destAmount: route.destAmount,
                percent: 100,
                data: {
                  path: [
                    {
                      pool: route.pool,
                      tokenIn: route.srcToken,
                      tokenOut: route.destToken,
                      zeroForOne: route.zeroForOne,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
    gasCostUSD: '0',
    gasCost: '200000',
    side: route.side,
    contractMethod:
      route.side === SwapSide.SELL
        ? ContractMethod.swapExactAmountIn
        : ContractMethod.swapExactAmountOut,
    tokenTransferProxy: config.tokenTransferProxyAddress,
    contractAddress: config.augustusV6Address,
    partnerFee: 0,
    hmac: '',
    version: ParaSwapVersion.V6,
  };
}

describe('PancakeSwapInfinity E2E', () => {
  describe('BSC', () => {
    testRoutes.forEach(route => {
      it(`should simulate ${route.side === SwapSide.SELL ? 'SELL' : 'BUY'}: ${
        route.name
      }`, async () => {
        await testPriceRoute(buildPriceRoute(route));
      }, 120000);
    });
  });
});
