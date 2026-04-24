import { SubgraphConnectorPool } from './types';
import { IDexHelper } from '../../dex-helper';
import { Logger } from 'log4js';

const SUBGRAPH_TIMEOUT = 30 * 1000;
const POOL_MIN_TVL_USD = 10_000;

export async function queryAvailablePoolsForToken(
  dexHelper: IDexHelper,
  logger: Logger,
  dexKey: string,
  subgraphUrl: string,
  tokenAddress: string,
  limit: number,
): Promise<{
  pools0: SubgraphConnectorPool[];
  pools1: SubgraphConnectorPool[];
}> {
  const poolsQuery = `query ($token: Bytes!, $count: Int, $minTVL: Int!) {
    pools0: pools(
      where: {
        token0: $token
        liquidity_gt: 0
        totalValueLockedUSD_gte: $minTVL
      }
      orderBy: totalValueLockedUSD
      orderDirection: desc
      first: $count
    ) {
      id
      totalValueLockedUSD
      token0 {
        address: id
        decimals
      }
      token1 {
        address: id
        decimals
      }
    }
    pools1: pools(
      where: {
        token1: $token
        liquidity_gt: 0
        totalValueLockedUSD_gte: $minTVL
      }
      orderBy: totalValueLockedUSD
      orderDirection: desc
      first: $count
    ) {
      id
      totalValueLockedUSD
      token0 {
        address: id
        decimals
      }
      token1 {
        address: id
        decimals
      }
    }
  }`;

  const res = await dexHelper.httpRequest.querySubgraph<{
    data: {
      pools0: SubgraphConnectorPool[];
      pools1: SubgraphConnectorPool[];
    };
    errors?: { message: string }[];
  }>(
    subgraphUrl,
    {
      query: poolsQuery,
      variables: {
        token: tokenAddress,
        count: limit,
        minTVL: POOL_MIN_TVL_USD,
      },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    throw new Error(res.errors[0].message);
  }

  return res.data;
}
