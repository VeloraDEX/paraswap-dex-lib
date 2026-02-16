import axios from 'axios';
import { BALANCER_API_URL, MIN_USD_LIQUIDITY_TO_FETCH } from './constants';
import { Token } from '../../types';

export interface TopPool {
  id: string;
  address: string;
  poolTokens: Token[];
  dynamicData: {
    totalLiquidity: string;
  };
}

interface QueryResponse {
  data: {
    poolGetPools: TopPool[];
  };
}

function createQuery(
  apiNetworkName: string,
  tokenAddress: string,
  count: number,
  minLiquidity: number,
): string {
  // Build the where clause conditionally
  const whereClause = {
    tokensIn: `["${tokenAddress.toLowerCase()}"]`,
    chainIn: `[${apiNetworkName}]`,
    protocolVersionIn: '[2]',
    minTvl: minLiquidity,
  };

  // Convert where clause to string
  const whereString = Object.entries(whereClause)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  return `
    query GetTopPools {
      poolGetPools(
        orderBy: totalLiquidity
        orderDirection: desc
        first: ${count}
        where: {${whereString}}
      ) {
        id
        poolTokens {
          address
          decimals
        }
        dynamicData {
          totalLiquidity
        }
      }
    }
  `;
}

export async function getTopPoolsApi(
  apiNetworkName: string,
  tokenAddress: string,
  count: number,
): Promise<TopPool[]> {
  try {
    const query = createQuery(
      apiNetworkName,
      tokenAddress,
      count,
      Number(MIN_USD_LIQUIDITY_TO_FETCH),
    );

    const response = await axios.post<QueryResponse>(
      BALANCER_API_URL,
      { query },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );

    const { data } = response.data;

    if (!data || !data.poolGetPools) {
      throw new Error(`Failed to fetch top pools from Balancer API`);
    }

    // Pools are already filtered by minTvl in the query
    return data.poolGetPools;
  } catch (error) {
    throw error;
  }
}
