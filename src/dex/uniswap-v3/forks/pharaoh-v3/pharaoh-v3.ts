import { Network } from '../../../../constants';
import { UniswapV3Config } from '../../config';
import { getDexKeysWithNetwork } from '../../../../utils';
import _ from 'lodash';
import { VelodromeSlipstream } from '../velodrome-slipstream/velodrome-slipstream';
import { Address } from '@paraswap/core';
import { PoolLiquidity } from '../../../../types';
import { UNISWAPV3_EFFICIENCY_FACTOR } from '../../constants';

interface SubgraphPool {
  id: string;
  token0: {
    id: string;
    decimals: number;
  };
  token1: {
    id: string;
    decimals: number;
  };
  totalValueLockedToken0: string;
  totalValueLockedToken1: string;
  token0Price: string;
  token1Price: string;
}

export class PharaohV3 extends VelodromeSlipstream {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(UniswapV3Config, ['PharaohV3']));

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.config.subgraphURL) return [];

    const _tokenAddress = tokenAddress.toLowerCase();

    const res = await this._querySubgraph(
      `query ($token: Bytes!, $count: Int) {
        pools0: clPools(
          orderBy: totalValueLockedToken0
          orderDirection: desc
          first: $count
          skip: 0
          where: { token0: $token }
        ) {
          id
          token0 {
            id
            decimals
          }
          token1 {
            id
            decimals
          }
        }
          
        pools1: clPools(
          orderBy: totalValueLockedToken1
          orderDirection: desc
          first: $count
          skip: 0
          where: { token1: $token }
        ) {
          id
          token0 {
            id
            decimals
          }
          token1 {
            id
            decimals
          }
        }
      }`,
      {
        token: _tokenAddress,
        count: limit,
      },
    );

    if (!(res && res.pools0 && res.pools1)) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch pools from subgraph`,
      );
      return [];
    }

    const pools0: PoolLiquidity[] = res.pools0.map((pool: SubgraphPool) => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: Number(pool.token1.decimals),
        },
      ],
      liquidityUSD: 0,
    }));

    const pools1: PoolLiquidity[] = res.pools1.map((pool: SubgraphPool) => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: Number(pool.token0.decimals),
        },
      ],
      liquidityUSD: 0,
    }));

    const allPools = [...pools0, ...pools1];

    if (allPools.length === 0) return [];

    const poolBalances = await this._getPoolBalances(
      allPools.map(p => [
        p.address,
        tokenAddress,
        p.connectorTokens[0].address,
      ]),
    );

    const tokensAmounts = allPools
      .map((p, i) => {
        return [
          [tokenAddress, poolBalances[i][0]],
          [p.connectorTokens[0].address, poolBalances[i][1]],
        ] as [string, bigint | null][];
      })
      .flat();

    const poolUsdBalances = await this.dexHelper.getUsdTokenAmounts(
      tokensAmounts,
    );

    const pools = allPools.map((pool, i) => {
      const tokenUsdBalance = poolUsdBalances[i * 2];
      const connectorTokenUsdBalance = poolUsdBalances[i * 2 + 1];

      const tokenUsdLiquidity = tokenUsdBalance
        ? tokenUsdBalance * UNISWAPV3_EFFICIENCY_FACTOR
        : null;

      const connectorTokenUsdLiquidity = connectorTokenUsdBalance
        ? connectorTokenUsdBalance * UNISWAPV3_EFFICIENCY_FACTOR
        : null;

      if (tokenUsdLiquidity) {
        pool.connectorTokens[0] = {
          ...pool.connectorTokens[0],
          liquidityUSD: tokenUsdLiquidity,
        };
      }

      const liquidityUSD = connectorTokenUsdLiquidity || tokenUsdLiquidity || 0;

      return {
        ...pool,
        liquidityUSD,
      };
    });

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}
