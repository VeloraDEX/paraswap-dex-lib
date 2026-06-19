import { SwapSide } from '@paraswap/core';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../constants';
import { UniswapV4 } from './uniswap-v4';
import { Pool, PoolState } from './types';
import { BASE_USDC, BuffetHookConfig } from './hooks/buffet/config';
import { queryAvailablePoolsForToken } from './subgraph';

jest.mock('./subgraph', () => ({
  queryAvailablePoolsForToken: jest.fn(),
}));

jest.mock('./liquidity', () => ({
  calculateTotalPoolLiquidity: jest.fn(() => ({
    totalAmount0: 100n,
    totalAmount1: 200n,
  })),
}));

const WETH = '0x4200000000000000000000000000000000000006';
const POOL_ID = BuffetHookConfig[Network.BASE].poolId;

function makeUniswapV4(overrides: Record<string, any> = {}) {
  return Object.assign(Object.create(UniswapV4.prototype), {
    network: Network.BASE,
    dexKey: 'UniswapV4',
    routerAddress: '0x0000000000000000000000000000000000000001',
    poolManagerAddress: '0x0000000000000000000000000000000000000002',
    wethAddress: WETH,
    logger: {
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    ...overrides,
  }) as UniswapV4;
}

describe('UniswapV4 hook integration', () => {
  it('drops hook BUY prices when the largest requested tier is unavailable', async () => {
    const pool: Pool = {
      id: POOL_ID,
      key: {
        currency0: NULL_ADDRESS,
        currency1: BASE_USDC,
        fee: '100',
        tickSpacing: 1,
        hooks: BuffetHookConfig[Network.BASE].hookAddress,
      },
    };
    const getPricesVolume = jest.fn().mockResolvedValue([0n, 10n, 0n]);
    const uniswapV4 = makeUniswapV4({
      poolManager: {
        getAvailablePoolsForPair: jest.fn().mockResolvedValue([pool]),
        getEventPool: jest.fn().mockResolvedValue({
          hook: { getPricesVolume },
          getState: jest.fn().mockResolvedValue(null),
        }),
      },
    });

    const prices = await uniswapV4.getPricesVolume(
      { address: BASE_USDC, decimals: 6 },
      { address: ETHER_ADDRESS, decimals: 18 },
      [0n, 1n, 2n],
      SwapSide.BUY,
      1,
    );

    expect(prices).toEqual([]);
  });

  it('prefers hook top-pool liquidity over duplicate subgraph liquidity', async () => {
    const hookPool = {
      exchange: 'UniswapV4',
      address: POOL_ID,
      poolIdentifier: POOL_ID,
      liquidityUSD: 999,
      connectorTokens: [
        {
          address: BASE_USDC,
          decimals: 6,
          liquidityUSD: 999,
        },
      ],
    };
    const poolState: PoolState = {
      id: POOL_ID,
      token0: NULL_ADDRESS,
      token1: BASE_USDC,
      fee: '100',
      hooks: BuffetHookConfig[Network.BASE].hookAddress,
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
      liquidity: 0n,
      slot0: {
        sqrtPriceX96: 1n,
        tick: 0n,
        protocolFee: 0n,
        lpFee: 0n,
      },
      tickSpacing: 1,
      ticks: {},
      tickBitmap: {},
      isValid: true,
    };

    (queryAvailablePoolsForToken as jest.Mock).mockResolvedValue({
      pools0: [
        {
          id: POOL_ID,
          fee: '100',
          volumeUSD: '1',
          tickSpacing: '1',
          hooks: BuffetHookConfig[Network.BASE].hookAddress,
          token0: { address: NULL_ADDRESS, decimals: '18' },
          token1: { address: BASE_USDC, decimals: '6' },
        },
      ],
      pools1: [],
    });

    const uniswapV4 = makeUniswapV4({
      dexHelper: {
        provider: {
          getBlockNumber: jest.fn().mockResolvedValue(1),
        },
        getUsdTokenAmounts: jest.fn().mockResolvedValue([1, 2]),
      },
      supportedHooks: [
        {
          address: BuffetHookConfig[Network.BASE].hookAddress,
          getTopPoolsForToken: jest.fn().mockResolvedValue([hookPool]),
        },
      ],
      poolManager: {
        generateMultiplePoolStates: jest.fn().mockResolvedValue([poolState]),
      },
    });

    const pools = await uniswapV4.getTopPoolsForToken(ETHER_ADDRESS, 10);

    expect(pools).toHaveLength(1);
    expect(pools[0]).toBe(hookPool);
  });
});
