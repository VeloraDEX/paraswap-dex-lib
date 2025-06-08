import axios from 'axios';
import {
  apiUrl,
  BalancerV3Config,
  disabledPoolIds,
  SUPPORTED_POOLS,
} from './config';
import { CommonImmutablePoolState, ImmutablePoolStateMap } from './types';
import { parseUnits } from 'ethers';
import { HooksConfigMap } from './hooks/balancer-hook-event-subscriber';
import { getUniqueHookNames } from './utils';
import { GyroECLPImmutableString } from './gyroECLPPool';
interface PoolToken {
  address: string;
  weight: string | null;
  canUseBufferForSwaps: boolean | null;
  underlyingToken: {
    address: string;
  } | null;
}

type Pool = {
  id: string;
  type: string;
  poolTokens: PoolToken[];
  hook: {
    address: string;
  } | null;
} & GyroECLPImmutableString;

interface QueryResponse {
  data: {
    aggregatorPools: Pool[];
  };
}

function createQuery(
  networkId: number,
  poolTypes: SUPPORTED_POOLS[],
  hooks: string,
  timestamp?: number,
): string {
  const poolTypesString = poolTypes.map(type => `${type}`).join(', ');
  const networkString = BalancerV3Config.BalancerV3[networkId].apiNetworkName;
  const disabledPoolIdsString = disabledPoolIds.BalancerV3[networkId]
    ?.map(p => `"${p}"`)
    .join(', ');

  // Build the where clause conditionally
  const whereClause = {
    chainIn: networkString,
    protocolVersionIn: 3,
    poolTypeIn: `[${poolTypesString}]`,
    ...(timestamp && { createTime: `{lt: ${timestamp}}` }),
    ...(disabledPoolIdsString && { idNotIn: `[${disabledPoolIdsString}]` }),
    includeHooks: `[${hooks}]`,
  };

  // Convert where clause to string, filtering out undefined values
  const whereString = Object.entries(whereClause)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
  return `
    query MyQuery {
      aggregatorPools(
        where: {${whereString}}
      ) {
        id
        type
        poolTokens {
          address
          weight
          canUseBufferForSwaps
          underlyingToken {
            address
          }
        }
        hook {
          address
        }
        alpha
        beta
        c
        s
        lambda
        tauAlphaX
        tauAlphaY
        tauBetaX
        tauBetaY
        u
        v
        w
        z
        dSq
      }
    }
  `;
}

function toImmutablePoolStateMap(
  pools: Pool[],
  hooksConfigMap: HooksConfigMap,
): ImmutablePoolStateMap {
  return (
    pools
      // First filter out pools with hooks that aren't in hooksMap
      .filter(
        pool =>
          !pool.hook ||
          (pool.hook && pool.hook.address.toLowerCase() in hooksConfigMap),
      )
      .reduce((map, pool) => {
        const immutablePoolState: CommonImmutablePoolState = {
          poolAddress: pool.id,
          tokens: pool.poolTokens.map(t => t.address),
          tokensUnderlying: pool.poolTokens.map(t =>
            t.underlyingToken && t.canUseBufferForSwaps
              ? t.underlyingToken.address
              : null,
          ),
          weights: pool.poolTokens.map(t => scaleOrDefault(t.weight, 18, 0n)),
          poolType: pool.type,
          hookAddress: pool.hook ? pool.hook.address.toLowerCase() : undefined,
          hookType: pool.hook
            ? hooksConfigMap[pool.hook.address.toLowerCase()].type
            : undefined,
          supportsUnbalancedLiquidity: true, // can default to true as only required for add/remove maths which we don't use
          // GyroECLP
          // Parameters to configure the E-CLP pool, with 18 decimals
          paramsAlpha: scaleOrDefault(pool.alpha, 18, 0n),
          paramsBeta: scaleOrDefault(pool.beta, 18, 0n),
          paramsC: scaleOrDefault(pool.c, 18, 0n),
          paramsS: scaleOrDefault(pool.s, 18, 0n),
          paramsLambda: scaleOrDefault(pool.lambda, 18, 0n),
          // Parameters calculated off-chain based on eclpParams. 38 decimals for higher precision
          tauAlphaX: scaleOrDefault(pool.tauAlphaX, 38, 0n),
          tauAlphaY: scaleOrDefault(pool.tauAlphaY, 38, 0n),
          tauBetaX: scaleOrDefault(pool.tauBetaX, 38, 0n),
          tauBetaY: scaleOrDefault(pool.tauBetaY, 38, 0n),
          u: scaleOrDefault(pool.u, 38, 0n),
          v: scaleOrDefault(pool.v, 38, 0n),
          w: scaleOrDefault(pool.w, 38, 0n),
          z: scaleOrDefault(pool.z, 38, 0n),
          dSq: scaleOrDefault(pool.dSq, 38, 0n),
        };
        map[pool.id] = immutablePoolState;
        return map;
      }, {} as ImmutablePoolStateMap)
  );
}

function scaleOrDefault(
  original: string | null,
  decimals: number,
  defaultValue: bigint,
): bigint {
  return original ? parseUnits(original, decimals) : defaultValue;
}

// Any data from API will be immutable. Mutable data such as balances, etc will be fetched via onchain/event state.
export async function getPoolsApi(
  network: number,
  hooksConfigMap: HooksConfigMap,
  timestamp?: number,
): Promise<ImmutablePoolStateMap> {
  try {
    const query = createQuery(
      network,
      Object.values(SUPPORTED_POOLS),
      getUniqueHookNames(hooksConfigMap),
      timestamp,
    );
    const response = await axios.post<QueryResponse>(
      apiUrl,
      {
        query,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const pools = response.data.data.aggregatorPools;
    return toImmutablePoolStateMap(pools, hooksConfigMap);
  } catch (error) {
    // console.error('Error executing GraphQL query:', error);
    throw error;
  }
}
