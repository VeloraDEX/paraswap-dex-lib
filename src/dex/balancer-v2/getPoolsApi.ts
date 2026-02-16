import axios from 'axios';
import { BALANCER_API_URL, MIN_USD_LIQUIDITY_TO_FETCH } from './constants';
import { SubgraphPoolBase, ApiV3Pool, BalancerPoolTypes } from './types';
import { keyBy } from 'lodash';
import { poolGetMainTokens } from './utils';

interface ApiV3Response {
  data: {
    poolGetPools: ApiV3Pool[];
  };
}

function mapPoolType(apiPoolType: string): BalancerPoolTypes {
  // Map API v3 pool types to internal BalancerPoolTypes
  const typeMap: Record<string, BalancerPoolTypes> = {
    WEIGHTED: BalancerPoolTypes.Weighted,
    STABLE: BalancerPoolTypes.Stable,
    META_STABLE: BalancerPoolTypes.MetaStable,
    COMPOSABLE_STABLE: BalancerPoolTypes.ComposableStable,
    LIQUIDITY_BOOTSTRAPPING: BalancerPoolTypes.LiquidityBootstrapping,
    INVESTMENT: BalancerPoolTypes.Investment,
    PHANTOM_STABLE: BalancerPoolTypes.StablePhantom,
    LINEAR: BalancerPoolTypes.Linear,
    GYRO3: BalancerPoolTypes.Gyro3,
    GYROE: BalancerPoolTypes.GyroE,
  };

  return typeMap[apiPoolType] || BalancerPoolTypes.Weighted;
}

function createQuery(
  apiNetworkName: string,
  poolTypes: BalancerPoolTypes[],
  disabledPoolIds: string[],
  maxPoolCount: number,
): string {
  // Map internal BalancerPoolTypes to API pool types
  const reverseTypeMap: Record<BalancerPoolTypes, string> = {
    [BalancerPoolTypes.Weighted]: 'WEIGHTED',
    [BalancerPoolTypes.Stable]: 'STABLE',
    [BalancerPoolTypes.MetaStable]: 'META_STABLE',
    [BalancerPoolTypes.ComposableStable]: 'COMPOSABLE_STABLE',
    [BalancerPoolTypes.LiquidityBootstrapping]: 'LIQUIDITY_BOOTSTRAPPING',
    [BalancerPoolTypes.Investment]: 'INVESTMENT',
    [BalancerPoolTypes.StablePhantom]: 'PHANTOM_STABLE',
    [BalancerPoolTypes.Linear]: 'LINEAR',
    [BalancerPoolTypes.Gyro3]: 'GYRO3',
    [BalancerPoolTypes.GyroE]: 'GYROE',
    [BalancerPoolTypes.AaveLinear]: 'LINEAR',
    [BalancerPoolTypes.ERC4626Linear]: 'LINEAR',
    [BalancerPoolTypes.BeefyLinear]: 'LINEAR',
    [BalancerPoolTypes.GearboxLinear]: 'LINEAR',
    [BalancerPoolTypes.MidasLinear]: 'LINEAR',
    [BalancerPoolTypes.ReaperLinear]: 'LINEAR',
    [BalancerPoolTypes.SiloLinear]: 'LINEAR',
    [BalancerPoolTypes.TetuLinear]: 'LINEAR',
    [BalancerPoolTypes.YearnLinear]: 'LINEAR',
  };

  const poolTypesString = poolTypes
    .map(type => reverseTypeMap[type] || 'WEIGHTED')
    .filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
    .join(', ');

  const disabledPoolIdsString = disabledPoolIds.map(p => `"${p}"`).join(', ');

  // Build the where clause conditionally
  const whereClause = {
    chainIn: `[${apiNetworkName}]`,
    protocolVersionIn: '[2]',
    ...(poolTypesString && { poolTypeIn: `[${poolTypesString}]` }),
    ...(disabledPoolIdsString && { idNotIn: `[${disabledPoolIdsString}]` }),
    minTvl: Number(MIN_USD_LIQUIDITY_TO_FETCH),
  };

  // Convert where clause to string
  const whereString = Object.entries(whereClause)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  return `
    query FetchPools {
      poolGetPools(
        first: ${maxPoolCount},
        where: {${whereString}},
        orderBy: totalLiquidity,
        orderDirection: desc
      ) {
        id
        address
        type
        version
        poolTokens {
          address
          decimals
          weight
          priceRate
        }
        dynamicData {
          totalLiquidity
        }
      }
    }
  `;
}

export async function getPoolsApi(
  apiNetworkName: string,
  maxPoolCount: number = 1000,
  enabledPoolTypes: BalancerPoolTypes[] = [
    BalancerPoolTypes.Stable,
    BalancerPoolTypes.Weighted,
  ],
  disabledPoolIds: string[] = [],
): Promise<SubgraphPoolBase[]> {
  try {
    const query = createQuery(
      apiNetworkName,
      enabledPoolTypes,
      disabledPoolIds,
      maxPoolCount,
    );

    const response = await axios.post<ApiV3Response>(
      BALANCER_API_URL,
      { query },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );

    if (
      !(response.data && response.data.data && response.data.data.poolGetPools)
    ) {
      throw new Error('Unable to fetch pools from the API v3');
    }

    const apiPools = response.data.data.poolGetPools;
    const allPools: SubgraphPoolBase[] = apiPools.map((pool: ApiV3Pool) => ({
      id: pool.id,
      address: pool.address,
      poolType: mapPoolType(pool.type),
      poolTypeVersion: pool.version,
      tokens: pool.poolTokens.map(token => ({
        address: token.address,
        decimals: token.decimals,
      })),
      tokensMap: pool.poolTokens.reduce(
        (acc, token) => ({
          ...acc,
          [token.address.toLowerCase()]: {
            address: token.address,
            decimals: token.decimals,
          },
        }),
        {},
      ),
      mainIndex: 0,
      wrappedIndex: 0,
      mainTokens: [],
      // Gyro params - set defaults as these are fetched separately if needed
      root3Alpha: '',
      alpha: '',
      beta: '',
      c: '',
      s: '',
      lambda: '',
      tauAlphaX: '',
      tauAlphaY: '',
      tauBetaX: '',
      tauBetaY: '',
      u: '',
      v: '',
      w: '',
      z: '',
      dSq: '',
    }));

    // Calculate mainTokens after all pools are mapped
    const poolsMap = keyBy(allPools, 'address');
    allPools.forEach(pool => {
      pool.mainTokens = poolGetMainTokens(pool, poolsMap);
    });

    return allPools;
  } catch (error) {
    throw error;
  }
}
