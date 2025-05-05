import { SubgraphConnectorPool, SubgraphPool, SubgraphTick } from './types';
import { POOL_MIN_TVL_USD, SUBGRAPH_TIMEOUT } from './constants';
import { IDexHelper } from '../../dex-helper';
import { Logger } from 'log4js';
import { Address } from '@paraswap/core';
import { NULL_ADDRESS } from '../../constants';

export async function queryTicksForPool(
  dexHelper: IDexHelper,
  logger: Logger,
  dexKey: string,
  subgraphUrl: string,
  blockNumber: number,
  id: string,
  skip: number,
  limit: number,
  latestBlock = false,
): Promise<SubgraphTick[]> {
  const ticksQuery = `query($poolId: Bytes!, $skip: Int!) {
      ticks(
        where: {pool_: {id: $poolId}}
        first: ${limit}
        skip: $skip
        orderBy: createdAtBlockNumber
        orderDirection: asc
        ${latestBlock ? '' : `block: { number: ${blockNumber} }`}
      ) {
        liquidityNet
        liquidityGross
        tickIdx
      }
  }`;

  const res = await dexHelper.httpRequest.querySubgraph<{
    data: {
      ticks: SubgraphTick[];
    };
    errors?: { message: string }[];
  }>(
    subgraphUrl,
    {
      query: ticksQuery,
      variables: { poolId: id, skip },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    if (res.errors[0].message.includes('missing block')) {
      logger.info(
        `${dexKey}: subgraph query ticks fallback to the latest block...`,
      );
      return queryTicksForPool(
        dexHelper,
        logger,
        dexKey,
        subgraphUrl,
        blockNumber,
        id,
        skip,
        limit,
        true,
      );
    } else {
      throw new Error(res.errors[0].message);
    }
  }

  return res.data.ticks || [];
}

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
  const poolsQuery = `query ($token: Bytes!, $hooks: Bytes!, $minTVL: Int!, $count: Int) {
      pools0: pools(
        where: { token0: $token, hooks: $hooks, liquidity_gt: 0, totalValueLockedUSD_gte: $minTVL }
        orderBy: volumeUSD
        orderDirection: desc
        first: $count
      ) {
      id
      volumeUSD
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
      where: { token1: $token, hooks: $hooks, liquidity_gt: 0, totalValueLockedUSD_gte: $minTVL }
      orderBy: volumeUSD
      orderDirection: desc
      first: $count
    ) {
      id
      volumeUSD
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
        hooks: NULL_ADDRESS,
        minTVL: POOL_MIN_TVL_USD,
      },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    throw new Error(res.errors[0].message);
  }

  return { pools0: res.data.pools0, pools1: res.data.pools1 };
}

export async function queryAvailablePoolsForPairFromSubgraph(
  dexHelper: IDexHelper,
  subgraphUrl: string,
  srcToken: Address,
  destToken: Address,
): Promise<SubgraphPool[]> {
  const ticksLimit = 300;

  const poolsQuery = `query ($token0: Bytes!, $token1: Bytes!, $minTVL: Int!, $hooks: Bytes!) {
      pools(
        where: { token0: $token0, token1: $token1, hooks: $hooks, liquidity_gt: 0, totalValueLockedUSD_gte: $minTVL },
        orderBy: totalValueLockedUSD
        orderDirection: desc
      ) {
        id
        fee: feeTier
        tickSpacing
        token0 {
          address: id
        }
        token1 {
          address: id
        }
        hooks
        tick
        ticks(first: ${ticksLimit}) {
          id
          liquidityGross
          liquidityNet
          tickIdx
        }
      }
    }`;

  const [token0, token1] =
    parseInt(srcToken, 16) < parseInt(destToken, 16)
      ? [srcToken, destToken]
      : [destToken, srcToken];

  const res = await dexHelper.httpRequest.querySubgraph<{
    data: {
      pools: SubgraphPool[];
    };
    errors?: { message: string }[];
  }>(
    subgraphUrl,
    {
      query: poolsQuery,
      variables: {
        token0,
        token1,
        minTVL: POOL_MIN_TVL_USD,
        hooks: NULL_ADDRESS,
      },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    throw new Error(res.errors[0].message);
  }

  return res.data.pools;
}

export async function queryOnePageForAllAvailablePoolsFromSubgraph(
  dexHelper: IDexHelper,
  logger: Logger,
  dexKey: string,
  subgraphUrl: string,
  blockNumber: number,
  skip: number,
  limit: number,
  latestBlock = false,
): Promise<SubgraphPool[]> {
  const poolsQuery = `query ($skip: Int!, $minTVL: Int!, $hooks: Bytes!) {
      pools(
        where: { hooks: $hooks, liquidity_gt: 0, totalValueLockedUSD_gte: $minTVL },
        ${latestBlock ? '' : `block: { number: ${blockNumber} }`}
        orderBy: totalValueLockedUSD
        orderDirection: desc
        skip: $skip
        first: ${limit}
      ) {
        id
        fee: feeTier
        volumeUSD
        tickSpacing
        token0 {
          address: id
        }
        token1 {
          address: id
        }
        hooks
        tick
      }
    }`;

  const res = await dexHelper.httpRequest.querySubgraph<{
    data: {
      pools: SubgraphPool[];
    };
    errors?: { message: string }[];
  }>(
    subgraphUrl,
    {
      query: poolsQuery,
      variables: {
        skip: skip,
        hooks: NULL_ADDRESS,
        minTVL: POOL_MIN_TVL_USD,
      },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  if (res.errors && res.errors.length) {
    if (res.errors[0].message.includes('missing block')) {
      logger.info(`${dexKey}: subgraph fallback to the latest block...`);
      return queryOnePageForAllAvailablePoolsFromSubgraph(
        dexHelper,
        logger,
        dexKey,
        subgraphUrl,
        blockNumber,
        skip,
        limit,
        true,
      );
    } else {
      throw new Error(res.errors[0].message);
    }
  }

  return res.data.pools;
}
