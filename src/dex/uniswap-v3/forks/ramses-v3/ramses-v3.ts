import { Network } from '../../../../constants';
import { UniswapV3Config } from '../../config';
import { getDexKeysWithNetwork } from '../../../../utils';
import _ from 'lodash';
import { VelodromeSlipstream } from '../velodrome-slipstream/velodrome-slipstream';
import { Address } from '../../../../types';
import { PoolLiquidity } from '../../../../types';
import { MultiCallParams } from '../../../../lib/multi-wrapper';
import { uint24ToBigInt } from '../../../../lib/decoders';
import { Interface } from '@ethersproject/abi';
import RamsesV3PoolABI from '../../../../abi/ramses-v3/RamsesV3Pool.abi.json';
import { VelodromeSlipstreamEventPool } from '../velodrome-slipstream/velodrome-slipstream-pool';

export class RamsesV3 extends VelodromeSlipstream {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(UniswapV3Config, ['RamsesV3']));

  protected readonly poolIface = new Interface(RamsesV3PoolABI);

  protected buildFeeCallData(
    pools: VelodromeSlipstreamEventPool[],
  ): MultiCallParams<bigint>[] {
    return pools.map(pool => ({
      target: pool.poolAddress,
      callData: this.poolIface.encodeFunctionData('fee', []),
      decodeFunction: uint24ToBigInt,
    }));
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.config.subgraphURL) return [];

    const _tokenAddress = tokenAddress.toLowerCase();

    const res = await this._querySubgraph(
      `query ($token: Bytes!, $count: Int) {
                pools0: clPools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token0: $token}) {
                id
                token0 {
                  id
                  decimals
                }
                token1 {
                  id
                  decimals
                }
                totalValueLockedUSD
              }
              pools1: clPools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token1: $token}) {
                id
                token0 {
                  id
                  decimals
                }
                token1 {
                  id
                  decimals
                }
                totalValueLockedUSD
              }
            }`,
      {
        token: _tokenAddress,
        count: limit,
      },
    );

    if (!(res && res.pools0 && res.pools1)) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const pools0 = _.map(res.pools0, (pool: any) => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.totalValueLockedUSD ?? 0),
    }));

    const pools1 = _.map(res.pools1, (pool: any) => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.totalValueLockedUSD ?? 0),
    }));

    const pools = _.slice(
      _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
      0,
      limit,
    );

    return pools;
  }
}
