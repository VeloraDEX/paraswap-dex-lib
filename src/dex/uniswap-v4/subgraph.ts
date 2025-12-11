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
  staticPoolsList?: string[],
  hooks: string[] = [NULL_ADDRESS],
): Promise<{
  pools0: SubgraphConnectorPool[];
  pools1: SubgraphConnectorPool[];
}> {
  const list = staticPoolsList
    ? staticPoolsList.map(t => `"${t}"`).join(',')
    : '';
  const poolsQuery = `query ($token: Bytes!, $hooks: [Bytes!], $minTVL: Int!, $count: Int) {
    pools0: pools(
      where: {
        token0: $token
        hooks_in: $hooks
        liquidity_gt: 0
        totalValueLockedUSD_gte: $minTVL
        ${list ? `id_in: [${list}]` : ''}
      }
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
      fee: feeTier
      tickSpacing
      hooks
    }
    pools1: pools(
      where: {
        token1: $token
        hooks_in: $hooks
        liquidity_gt: 0
        totalValueLockedUSD_gte: $minTVL
        ${list ? `id_in: [${list}]` : ''}
      }
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
      fee: feeTier
      tickSpacing
      hooks
    }
  }
`;

  const fetchPools = async (hookList: string[], minTVL: number) => {
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
          hooks: hookList,
          minTVL,
        },
      },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (res.errors && res.errors.length) {
      throw new Error(res.errors[0].message);
    }

    return res.data;
  };

  const hooksWithNoMinTvl = hooks.filter(h => h !== NULL_ADDRESS);
  const hooksWithMinTvl = hooks.includes(NULL_ADDRESS) ? [NULL_ADDRESS] : [];

  const results: {
    pools0: SubgraphConnectorPool[];
    pools1: SubgraphConnectorPool[];
  }[] = [];

  if (hooksWithNoMinTvl.length) {
    results.push(await fetchPools(hooksWithNoMinTvl, 0));
  }

  if (hooksWithMinTvl.length) {
    results.push(await fetchPools(hooksWithMinTvl, POOL_MIN_TVL_USD));
  }

  return {
    pools0: results.flatMap(r => r.pools0),
    pools1: results.flatMap(r => r.pools1),
  };
}

export async function queryAvailablePoolsForPairFromSubgraph(
  dexHelper: IDexHelper,
  subgraphUrl: string,
  srcToken: Address,
  destToken: Address,
  hooks: string = NULL_ADDRESS,
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
        minTVL: hooks === NULL_ADDRESS ? POOL_MIN_TVL_USD : 0,
        hooks,
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
  hooks: string[] = [NULL_ADDRESS],
  latestBlock = false,
): Promise<SubgraphPool[]> {
  const hooksWithNoMinTvl = hooks.filter(h => h !== NULL_ADDRESS);
  const hooksWithMinTvl = hooks.includes(NULL_ADDRESS) ? [NULL_ADDRESS] : [];

  const fetchPage = async (hookList: string[], minTVL: number) => {
    const poolsQuery = `query ($skip: Int!, $minTVL: Int!, $hooks: [Bytes!]) {
      pools(
        where: { hooks_in: $hooks, liquidity_gt: 0, totalValueLockedUSD_gte: $minTVL },
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
          hooks: hookList,
          minTVL,
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
          hookList,
          true,
        );
      } else {
        throw new Error(res.errors[0].message);
      }
    }

    return res.data.pools;
  };

  const pools: SubgraphPool[] = [];

  if (hooksWithNoMinTvl.length) {
    pools.push(...(await fetchPage(hooksWithNoMinTvl, 0)));
  }

  if (hooksWithMinTvl.length) {
    pools.push(...(await fetchPage(hooksWithMinTvl, POOL_MIN_TVL_USD)));
  }

  return pools;
}

export async function queryPoolsFromSubgraph(
  dexHelper: IDexHelper,
  subgraphUrl: string,
  poolIds: string[],
  hooks: string = NULL_ADDRESS,
): Promise<SubgraphPool[] | null> {
  const poolsQuery = `query ($minTVL: Int!, $hooks: Bytes!, $pools: [Bytes!]!) {
      pools(where: {liquidity_gt: 0, totalValueLockedUSD_gte: $minTVL, id_in: $pools}) {
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
        hooks,
        minTVL: hooks === NULL_ADDRESS ? POOL_MIN_TVL_USD : 0,
        pools: poolIds,
      },
    },
    { timeout: SUBGRAPH_TIMEOUT },
  );

  return res?.data?.pools ?? null;
}
