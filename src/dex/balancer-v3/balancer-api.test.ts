// npx jest src/dex/balancer-v3/balancer-api.test.ts
/* eslint-disable no-console */
import { getPoolsApi } from './getPoolsApi';
import { getTopPoolsApi, Pool } from './getTopPoolsApi';
import { loadHooksConfig } from './hooks/loadHooksConfig';
import { ImmutablePoolStateMap } from './types';

const network = 1;
const rstETHLidoPoolAddr = '0x121edb0badc036f5fc610d015ee14093c142313b';
const stableSurgePoolAddr = '0x9ed5175aecb6653c1bdaa19793c16fd74fbeeb37';
const hooksConfigMap = loadHooksConfig(network);

describe('Balancer API Tests', function () {
  describe('getPoolsApi', function () {
    let pools: ImmutablePoolStateMap;

    beforeAll(async () => {
      pools = await getPoolsApi(network, hooksConfigMap);
    });

    it('should handle pool with ERC4626 not suitable for swaps', function () {
      const expectedPool = {
        poolAddress: rstETHLidoPoolAddr,
        tokens: [
          '0x775f661b0bd1739349b9a2a3ef60be277c5d2d29',
          '0x7a4effd87c2f3c55ca251080b1343b605f327e3a',
        ],
        tokensUnderlying: ['0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', null],
        weights: [0n, 0n],
        poolType: 'STABLE',
        hookAddress: undefined,
        hookType: undefined,
        supportsUnbalancedLiquidity: true,
        dSq: 0n,
        paramsAlpha: 0n,
        paramsBeta: 0n,
        paramsC: 0n,
        paramsLambda: 0n,
        paramsS: 0n,
        tauAlphaX: 0n,
        tauAlphaY: 0n,
        tauBetaX: 0n,
        tauBetaY: 0n,
        u: 0n,
        v: 0n,
        w: 0n,
        z: 0n,
      };
      expect(pools[rstETHLidoPoolAddr]).toEqual(expectedPool);
    });

    it('should fetch pool with stableSurge hook', function () {
      const expectedPool = {
        poolAddress: stableSurgePoolAddr,
        tokens: [
          '0x775f661b0bd1739349b9a2a3ef60be277c5d2d29',
          '0xd11c452fc99cf405034ee446803b6f6c1f6d5ed8',
        ],
        tokensUnderlying: ['0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', null],
        weights: [0n, 0n],
        poolType: 'STABLE',
        hookAddress: '0xb18fa0cb5de8cecb8899aae6e38b1b7ed77885da',
        hookType: 'StableSurge',
        supportsUnbalancedLiquidity: true,
        dSq: 0n,
        paramsAlpha: 0n,
        paramsBeta: 0n,
        paramsC: 0n,
        paramsLambda: 0n,
        paramsS: 0n,
        tauAlphaX: 0n,
        tauAlphaY: 0n,
        tauBetaX: 0n,
        tauBetaY: 0n,
        u: 0n,
        v: 0n,
        w: 0n,
        z: 0n,
      };
      expect(pools[stableSurgePoolAddr]).toEqual(expectedPool);
    });
  });

  describe('getTopPoolsApi', function () {
    let pools: Pool[];

    beforeAll(async () => {
      pools = await getTopPoolsApi(
        network,
        [rstETHLidoPoolAddr, stableSurgePoolAddr],
        2,
        hooksConfigMap,
      );
    });

    it('should handle pool with ERC4626 not suitable for swaps', async function () {
      const expectedPoolTokens = [
        {
          address: '0x775f661b0bd1739349b9a2a3ef60be277c5d2d29',
          decimals: 18,
          canUseBufferForSwaps: true,
          underlyingToken: {
            address: '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0',
            decimals: 18,
          },
        },
        {
          address: '0x7a4effd87c2f3c55ca251080b1343b605f327e3a',
          decimals: 18,
          canUseBufferForSwaps: false,
          underlyingToken: null,
        },
      ];
      const pool = pools.find(p => p.address === rstETHLidoPoolAddr);
      expect(pool).toBeDefined();
      expect(pool!.poolTokens).toEqual(expectedPoolTokens);
    });
    it('should fetch pool with stableSurge hook', async function () {
      expect(pools.some(p => p.address === stableSurgePoolAddr)).toBe(true);
    });
  });
});
