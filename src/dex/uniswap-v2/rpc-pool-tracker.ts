import { Interface } from '@ethersproject/abi';
import { CACHE_PREFIX, Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import {
  addressDecode,
  uint256DecodeToNumber,
  generalDecoder,
} from '../../lib/decoders';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { Address, PoolLiquidity, Token } from '../../types';
import { UniswapV2 } from './uniswap-v2';
import { BytesLike } from 'ethers';

type CachedPool = {
  address: Address;
  updatedAt: number; // block timestamp in ms of when last _update happened
  token0: Token;
  token1: Token;
};

// pools structure without nested objects can save up to 30% of memory (pancake-swap-v2 has 1.8 pools)
type Pool = {
  address: Address;
  token0Address: Address;
  token0Decimals: number;
  token1Address: Address;
  token1Decimals: number;
  reserve0: bigint;
  reserve1: bigint;
  reservesUpdatedAt: number | null;
  updatedAt: number; // block timestamp in ms of when last _update happened
};

// also used to check if reserves should be updated
const UPDATE_NEW_POOLS_INTERVAL = 10 * 60 * 1000; // 10 minutes
const UPDATE_POOLS_AGE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const WRITE_BATCH_SIZE = 1_000;
const READ_BATCH_SIZE = 10_000;
// pool is valid if last update was less than 180 days ago, otherwise pool is considered stale and will not be used on pt
const VALID_POOLS_AGE = 1000 * 60 * 60 * 24 * 180; // 180 days
const MAX_RESERVES_POOLS_UPDATE = 2_000;

const FactoryABI = [
  {
    constant: true,
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    name: 'allPairs',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'allPairsLength',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
      {
        internalType: 'uint112',
        name: '_reserve0',
        type: 'uint112',
      },
      {
        internalType: 'uint112',
        name: '_reserve1',
        type: 'uint112',
      },
      {
        internalType: 'uint32',
        name: '_blockTimestampLast',
        type: 'uint32',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [
      {
        internalType: 'uint8',
        name: '',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const factoryIface = new Interface(FactoryABI);

export class UniswapV2RpcPoolTracker extends UniswapV2 {
  private cacheKey: string;
  protected allPoolsLength: number = 0;
  public pools: Record<string, Pool> = {};

  readonly isStatePollingDex = true;

  private newPoolsUpdateInterval: NodeJS.Timeout | null = null;
  private poolsAgeUpdateInterval: NodeJS.Timeout | null = null;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected isDynamicFees = false,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      isDynamicFees, // dynamic fees
    );

    this.cacheKey =
      `${CACHE_PREFIX}_${this.network}_${this.dexKey}_pools`.toLowerCase();
  }

  async initializePricing() {
    this.logger.info(
      `PancakeSwapV2: Initializing pools for ${this.dexKey} on ${this.network}...`,
    );
    if (!this.dexHelper.config.isSlave) {
      await this.updatePools(true);
      await this.updatePoolsAge();

      this.newPoolsUpdateInterval = setInterval(async () => {
        try {
          await this.updatePools();
        } catch (error) {
          this.logger.error(
            `Error updating new pools for ${this.dexKey} on ${this.network}: ${error}`,
          );
        }
      }, UPDATE_NEW_POOLS_INTERVAL);

      this.poolsAgeUpdateInterval = setInterval(async () => {
        try {
          await this.updatePoolsAge();
        } catch (error) {
          this.logger.error(
            `Error updating pools age for ${this.dexKey} on ${this.network}: ${error}`,
          );
        }
      }, UPDATE_POOLS_AGE_INTERVAL);
    }
  }

  async updatePools(initialize = false) {
    const allPools = await this.getOnChainPoolsLength();
    const allCachedPools = await this.dexHelper.cache.hlen(this.cacheKey);

    const missingPools = allPools - allCachedPools;

    if (!initialize && missingPools > 1_000) {
      throw new Error(
        `Missing ${missingPools} out of ${allPools} pools. Cache is not up to date, reverting... `,
      );
    }

    if (allPools > allCachedPools) {
      await this.initPools(allCachedPools, allPools);
    }
  }

  async initPools(fromIndex: number, toIndex: number) {
    this.logger.info(`Initializing pools from ${fromIndex} to ${toIndex}...`);

    for (let i = fromIndex; i < toIndex; i += WRITE_BATCH_SIZE) {
      this.logger.info(
        `Fetching pools from ${i} to ${Math.min(
          i + WRITE_BATCH_SIZE,
          toIndex,
        )}`,
      );

      const fetchedPools = await this.fetchPools(
        i,
        Math.min(i + WRITE_BATCH_SIZE, toIndex),
      );
      const pools = Object.fromEntries(
        Object.entries(fetchedPools).map(([key, value]) => [
          key,
          JSON.stringify(value),
        ]),
      );
      await this.dexHelper.cache.hmset(this.cacheKey, pools);
    }

    this.logger.info(
      `Fetched ${toIndex - fromIndex} pools from ${fromIndex} to ${toIndex}`,
    );
  }

  async getCachedPools(fromIndex: number, toIndex: number) {
    for (
      let batchStart = fromIndex;
      batchStart < toIndex;
      batchStart += READ_BATCH_SIZE
    ) {
      const batchEnd = Math.min(batchStart + READ_BATCH_SIZE, toIndex);
      const keys = [];
      for (let i = batchStart; i < batchEnd; i++) {
        keys.push(i.toString());
      }
      this.logger.info(
        `Getting cached pools from ${batchStart} to ${batchEnd}`,
      );
      const pools = await this.dexHelper.cache.hmget(this.cacheKey, keys);

      const minValidUpdatedAt = Date.now() - VALID_POOLS_AGE;
      pools.forEach((pool, idx) => {
        if (pool) {
          const index = batchStart + idx;
          const parsedPool = JSON.parse(pool) as CachedPool;
          if (parsedPool && parsedPool.updatedAt > minValidUpdatedAt) {
            this.pools[index] = {
              address: parsedPool.address,
              token0Address: parsedPool.token0.address,
              token0Decimals: parsedPool.token0.decimals,
              token1Address: parsedPool.token1.address,
              token1Decimals: parsedPool.token1.decimals,
              updatedAt: parsedPool.updatedAt,
              reserve0: 0n,
              reserve1: 0n,
              reservesUpdatedAt: null,
            };
          }
        } else {
          this.logger.warn(
            `Pool with index ${batchStart + idx} not found in cache`,
          );
        }

        this.allPoolsLength++;
      });
    }
  }

  async updatePoolState() {
    await this.updatePools();

    const allPools = this.allPoolsLength;
    const allCachedPools = await this.dexHelper.cache.hlen(this.cacheKey);

    if (allPools < allCachedPools) {
      await this.getCachedPools(allPools, allCachedPools);
    }
  }

  async updatePoolsAge() {
    this.logger.info(
      `Starting update pools age for ${this.dexKey} on ${this.network}...`,
    );
    const allPools = this.allPoolsLength;
    const allCachedPools = await this.dexHelper.cache.hlen(this.cacheKey);

    if (allPools < allCachedPools) {
      await this.getCachedPools(allPools, allCachedPools);
    }

    const poolsIndexes = Object.keys(this.pools);
    this.logger.info(
      `Updating pools age for ${poolsIndexes.length} pools on ${this.network}...`,
    );

    // batch poolsCalldata and process in chunks to avoid huge amounts of multi-calls
    for (
      let batchStart = 0;
      batchStart < poolsIndexes.length;
      batchStart += WRITE_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + WRITE_BATCH_SIZE,
        poolsIndexes.length,
      );
      const batchIndexes = poolsIndexes.slice(batchStart, batchEnd);

      this.logger.info(
        `Updating pools age for ${batchStart}-${batchEnd} pools on ${this.network}...`,
      );

      const batchCalldata: MultiCallParams<number>[] = batchIndexes.map(
        poolIndex => ({
          target: this.pools[poolIndex].address,
          callData: factoryIface.encodeFunctionData('getReserves', []),
          decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
            return generalDecoder(
              result,
              ['uint112', 'uint112', 'uint32'],
              0,
              res => Number(res[2]),
            );
          },
        }),
      );

      const batchPoolsData =
        await this.dexHelper.multiWrapper.tryAggregate<number>(
          true,
          batchCalldata,
          undefined,
          // as calls are small, should be affordable to use a larger batch size
          WRITE_BATCH_SIZE,
        );

      const poolsToUpdate: Record<string, string> = {};

      for (let i = 0; i < batchPoolsData.length; i++) {
        const poolIndex = batchIndexes[i];
        const updatedAt = (batchPoolsData[i].returnData as number) * 1000;

        if (updatedAt !== this.pools[poolIndex].updatedAt) {
          this.pools[poolIndex].updatedAt = updatedAt;

          const pool: CachedPool = {
            address: this.pools[poolIndex].address,
            updatedAt,
            token0: {
              address: this.pools[poolIndex].token0Address,
              decimals: this.pools[poolIndex].token0Decimals,
            },
            token1: {
              address: this.pools[poolIndex].token1Address,
              decimals: this.pools[poolIndex].token1Decimals,
            },
          };

          poolsToUpdate[poolIndex] = JSON.stringify(pool);
        }
      }

      if (Object.keys(poolsToUpdate).length > 0) {
        await this.dexHelper.cache.hmset(this.cacheKey, poolsToUpdate);
      }
    }

    this.logger.info(
      `Finished update pools age for ${poolsIndexes.length} pools on ${this.network}.`,
    );
  }

  async getOnChainPoolsLength() {
    const allPoolsCallData = {
      target: this.factoryAddress,
      callData: factoryIface.encodeFunctionData('allPairsLength', []),
      decodeFunction: uint256DecodeToNumber,
    };

    if (!allPoolsCallData) {
      throw new Error('getAllPoolsCallData is not implemented');
    }

    const callData: MultiCallParams<number>[] = [allPoolsCallData];

    const [allPoolsLength] =
      await this.dexHelper.multiWrapper.tryAggregate<number>(true, callData);

    return allPoolsLength.returnData;
  }

  async fetchPools(fromIndex: number, toIndex: number) {
    const allPoolsCallData: MultiCallParams<string>[] = [];
    for (let i = fromIndex; i < toIndex; i++) {
      const poolCallData = {
        target: this.factoryAddress,
        callData: factoryIface.encodeFunctionData('allPairs', [i]),
        decodeFunction: addressDecode,
      };

      allPoolsCallData.push(poolCallData);
    }

    const allPoolsResults =
      await this.dexHelper.multiWrapper.tryAggregate<string>(
        true,
        allPoolsCallData,
      );

    const poolsCalldata: MultiCallParams<string | bigint[] | number>[] = [];

    for (const poolResult of allPoolsResults) {
      poolsCalldata.push(
        {
          target: poolResult.returnData,
          callData: factoryIface.encodeFunctionData('token0', []),
          decodeFunction: addressDecode,
        },
        {
          target: poolResult.returnData,
          callData: factoryIface.encodeFunctionData('token1', []),
          decodeFunction: addressDecode,
        },
        {
          target: poolResult.returnData,
          callData: factoryIface.encodeFunctionData('getReserves', []),
          decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
            return generalDecoder(
              result,
              ['uint112', 'uint112', 'uint32'],
              0,
              res => Number(res[2]),
            );
          },
        },
      );
    }

    const poolsData = await this.dexHelper.multiWrapper.tryAggregate<
      string | bigint[] | number
    >(true, poolsCalldata);

    const tokensSet = new Set<string>();
    for (let i = 0; i < allPoolsResults.length; i++) {
      const token0 = (poolsData[i * 3].returnData as string).toLowerCase();
      const token1 = (poolsData[i * 3 + 1].returnData as string).toLowerCase();

      tokensSet.add(token0.toLowerCase());
      tokensSet.add(token1.toLowerCase());
    }

    const decimalsCalldata: MultiCallParams<number>[] = [];
    const tokens = Array.from(tokensSet);

    for (const token of tokens) {
      decimalsCalldata.push({
        target: token,
        callData: factoryIface.encodeFunctionData('decimals', []),
        decodeFunction: uint256DecodeToNumber,
      });
    }

    const decimalsResults =
      await this.dexHelper.multiWrapper.tryAggregate<number>(
        false,
        decimalsCalldata,
      );

    const decimals = decimalsResults.reduce((acc, result, index) => {
      const token = tokens[index];
      acc[token] = result.returnData || 18; // default to 18 decimals if not found
      return acc;
    }, {} as Record<string, number>);

    const pools: Record<string, CachedPool> = {};

    for (let i = 0; i < allPoolsResults.length; i++) {
      const poolAddress = allPoolsResults[i].returnData.toLowerCase();
      const token0 = (poolsData[i * 3].returnData as string).toLowerCase();
      const token1 = (poolsData[i * 3 + 1].returnData as string).toLowerCase();
      const updatedAt = poolsData[i * 3 + 2].returnData as number;

      pools[i + fromIndex] = {
        address: poolAddress,
        updatedAt: updatedAt * 1000,
        token0: {
          address: token0,
          decimals: decimals[token0],
        },
        token1: {
          address: token1,
          decimals: decimals[token1],
        },
      };
    }

    return pools;
  }

  async updatePoolsReserves(pools: Pool[]): Promise<void> {
    const callData: MultiCallParams<[bigint, bigint, number]>[] = [];

    for (const pool of pools) {
      callData.push({
        target: pool.address,
        callData: factoryIface.encodeFunctionData('getReserves', []),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
          return generalDecoder(
            result,
            ['uint112', 'uint112', 'uint32'],
            [0n, 0n, 0],
            res => [BigInt(res[0]), BigInt(res[1]), Number(res[2])],
          );
        },
      });
    }

    const results = await this.dexHelper.multiWrapper.tryAggregate<
      [bigint, bigint, number]
    >(true, callData);

    for (let i = 0; i < pools.length; i++) {
      const [reserve0, reserve1, updatedAt] = results[i].returnData;
      const pool = pools[i];
      pool.updatedAt = updatedAt * 1000; // convert to ms
      pool.reserve0 = reserve0;
      pool.reserve1 = reserve1;
      pool.reservesUpdatedAt = Date.now();
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = tokenAddress.toLowerCase();

    // sort by updateAt with the assumption that pools with good liquidity are updated more frequently
    let pools = Object.values(this.pools)
      .filter(
        pool => pool.token0Address === token || pool.token1Address === token,
      )
      .sort((a, b) => {
        return b.updatedAt - a.updatedAt;
      });

    if (pools.length === 0) {
      return [];
    }

    const now = Date.now();
    const poolsToUpdate = pools
      .filter(
        pool =>
          !pool.reservesUpdatedAt ||
          now - pool.reservesUpdatedAt > UPDATE_NEW_POOLS_INTERVAL,
      )
      .slice(0, MAX_RESERVES_POOLS_UPDATE);

    if (poolsToUpdate.length > 0) {
      try {
        this.logger.info(
          `Started updating reserves for ${poolsToUpdate.length} pools for token ${token} on ${this.network}...`,
        );
        await this.updatePoolsReserves(poolsToUpdate);
        this.logger.info(
          `Finished updating reserves for ${poolsToUpdate.length} pools for token ${token} on ${this.network}...`,
        );
      } catch (error) {
        this.logger.error(
          `Error updating reserves for pools for token ${token} on ${this.network}: ${error}`,
        );
        return [];
      }
    }

    pools = pools
      .sort((a, b) => {
        const aReserve = token === a.token0Address ? a.reserve0 : a.reserve1;
        const bReserve = token === b.token0Address ? b.reserve0 : b.reserve1;

        return Number(bReserve - aReserve);
      })
      .slice(0, limit);

    const tokensAmounts = pools
      .map(pool => {
        const token0 = pool.token0Address;
        const token1 = pool.token1Address;
        const reserve0 = pool.reserve0;
        const reserve1 = pool.reserve1;

        return [
          [token0, reserve0],
          [token1, reserve1],
        ] as [string, bigint | null][];
      })
      .flat();

    const usdTokenAmounts = await this.dexHelper.getUsdTokenAmounts(
      tokensAmounts,
    );

    const poolsWithLiquidity: PoolLiquidity[] = pools.map((pool, i) => {
      const connectorToken =
        token === pool.token0Address
          ? {
              address: pool.token1Address,
              decimals: pool.token1Decimals,
            }
          : {
              address: pool.token0Address,
              decimals: pool.token0Decimals,
            };

      let token0ReserveUSD = usdTokenAmounts[i * 2];
      let token1ReserveUSD = usdTokenAmounts[i * 2 + 1];

      // fallback to non-empty usd reserves
      if (!token0ReserveUSD && token1ReserveUSD) {
        token0ReserveUSD = token1ReserveUSD;
      }

      if (!token1ReserveUSD && token0ReserveUSD) {
        token1ReserveUSD = token0ReserveUSD;
      }

      return {
        exchange: this.dexKey,
        address: pool.address,
        connectorTokens: [connectorToken],
        liquidityUSD: token0ReserveUSD + token1ReserveUSD,
      };
    });

    return poolsWithLiquidity
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  releaseResources() {
    if (this.newPoolsUpdateInterval) {
      clearInterval(this.newPoolsUpdateInterval);
      this.newPoolsUpdateInterval = null;
    }
    if (this.poolsAgeUpdateInterval) {
      clearInterval(this.poolsAgeUpdateInterval);
      this.poolsAgeUpdateInterval = null;
    }
  }
}
