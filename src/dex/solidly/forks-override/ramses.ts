import { Network, SUBGRAPH_TIMEOUT } from '../../../constants';
import { getDexKeysWithNetwork } from '../../../utils';
import { SolidlyConfig } from '../config';
import _ from 'lodash';
import { Address, PoolLiquidity } from '../../../types';
import BigNumber from 'bignumber.js';
import { Solidly } from '../solidly';
import { IDexHelper } from '../../../dex-helper';
import { SolidlyPair } from '../types';
import { Interface } from '@ethersproject/abi';
import { BytesLike } from 'ethers';

const RamsesFactoryABI = [
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'pairFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const ramsesFactoryIface = new Interface(RamsesFactoryABI);

export type RamsesSubgraphPool = {
  id: string;
  isStable: boolean;
  token0: string;
  reserve0: string;
  reserve1: string;
  token1: string;
};

export type RamsesSubgraphToken = {
  id: string;
  decimals: string;
};

export class Ramses extends Solidly {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyConfig, ['Ramses']));

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      true, // dynamic fees
    );
  }

  protected getFeesMultiCallData(pair: SolidlyPair) {
    const callEntry = {
      target: this.factoryAddress,
      callData: ramsesFactoryIface.encodeFunctionData('pairFee', [
        pair.exchange,
      ]),
    };
    const callDecoder = (values: BytesLike) =>
      parseInt(
        ramsesFactoryIface
          .decodeFunctionResult('pairFee', values)[0]
          .toString(),
      );

    return {
      callEntry,
      callDecoder,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    count: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.subgraphURL) return [];

    const query = `query ($token: Bytes!, $count: Int) {
      pools0: pairs(first: $count, orderBy: reserve0, orderDirection: desc, where: {token0: $token, reserve0_gt: 1, reserve1_gt: 1}) {
        id
        isStable
        token0
        token1
        reserve0,
        reserve1,
      }
      pools1: pairs(first: $count, orderBy: reserve1, orderDirection: desc, where: {token1: $token, reserve0_gt: 1, reserve1_gt: 1}) {
        id
        isStable
        token0
        token1
        reserve0,
        reserve1,
      }
    }`;

    const { data } = await this.dexHelper.httpRequest.querySubgraph(
      this.subgraphURL,
      {
        query,
        variables: { token: tokenAddress.toLowerCase(), count },
      },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (!(data && data.pools0 && data.pools1))
      throw new Error("Couldn't fetch the pools from the subgraph");

    const tokenIds = _.uniq(
      []
        .concat(data.pools0, data.pools1)
        .map((pool: RamsesSubgraphPool) => [pool.token0, pool.token1])
        .flat(),
    );

    const tokensQuery = `
      query ($tokenIds: [String!]) {
        tokens(where: {id_in: $tokenIds}) {
          id
          decimals
        }
      }`;

    const { data: tokensData } = await this.dexHelper.httpRequest.querySubgraph(
      this.subgraphURL,
      {
        query: tokensQuery,
        variables: { tokenIds },
      },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    const pools0 = await this.prepareSubgraphPools(
      tokensData.tokens,
      data.pools0,
      (
        pool,
        { address1, decimals1, liquidityUSDToken0, liquidityUSDToken1 },
      ) => ({
        exchange: this.dexKey,
        stable: pool.isStable,
        address: pool.id.toLowerCase(),
        connectorTokens: [
          {
            address: address1,
            decimals: decimals1,
          },
        ],
        liquidityUSD: liquidityUSDToken0 + liquidityUSDToken1,
      }),
    );

    const pools1 = await this.prepareSubgraphPools(
      tokensData.tokens,
      data.pools1,
      (
        pool,
        { address0, decimals0, liquidityUSDToken0, liquidityUSDToken1 },
      ) => ({
        exchange: this.dexKey,
        stable: pool.isStable,
        address: pool.id.toLowerCase(),
        connectorTokens: [
          {
            address: address0,
            decimals: decimals0,
          },
        ],
        liquidityUSD: liquidityUSDToken0 + liquidityUSDToken1,
      }),
    );

    return _.slice(
      _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
      0,
      count,
    );
  }

  protected async prepareSubgraphPools(
    tokens: RamsesSubgraphToken[],
    pools: RamsesSubgraphPool[],
    iterator: (
      pool: RamsesSubgraphPool,
      {
        address0,
        address1,
        decimals0,
        decimals1,
        reserve0,
        reserve1,
        liquidityUSDToken0,
        liquidityUSDToken1,
      }: {
        address0: string;
        address1: string;
        decimals0: number;
        decimals1: number;
        reserve0: bigint;
        reserve1: bigint;
        liquidityUSDToken0: number;
        liquidityUSDToken1: number;
      },
    ) => PoolLiquidity,
  ): Promise<PoolLiquidity[]> {
    return Promise.all(
      pools.map(async (pool: RamsesSubgraphPool) => {
        const address0 = pool.token0.toLowerCase();
        const address1 = pool.token1.toLowerCase();

        const decimals0 = parseInt(
          tokens.find(t => t.id === address0)!.decimals,
        );
        const decimals1 = parseInt(
          tokens.find(t => t.id === address1)!.decimals,
        );

        const reserve0 = BigInt(new BigNumber(pool.reserve0).toFixed());
        const reserve1 = BigInt(new BigNumber(pool.reserve1).toFixed());

        const liquidityUSDToken0 = await this.dexHelper.getTokenUSDPrice(
          {
            address: address0,
            decimals: decimals0,
          },
          reserve0,
        );

        const liquidityUSDToken1 = await this.dexHelper.getTokenUSDPrice(
          {
            address: address1,
            decimals: decimals1,
          },
          reserve1,
        );

        return iterator(pool, {
          address0,
          address1,
          decimals0,
          decimals1,
          reserve0,
          reserve1,
          liquidityUSDToken0,
          liquidityUSDToken1,
        });
      }),
    );
  }
}
