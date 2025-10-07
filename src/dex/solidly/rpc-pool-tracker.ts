import { Interface } from '@ethersproject/abi';
import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import {
  addressDecode,
  uint256DecodeToNumber,
  generalDecoder,
} from '../../lib/decoders';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { Address, PoolLiquidity, Token } from '../../types';
import { Solidly } from './solidly';
import { BytesLike } from 'ethers';

type Pool = {
  address: Address;
  token0: Token;
  token1: Token;
  reserve0: bigint;
  reserve1: bigint;
};

const SolidlyFactoryABI = [
  {
    inputs: [],
    name: 'reserve0',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'reserve1',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
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
  {
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
      {
        internalType: 'uint256',
        name: '_reserve0',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_reserve1',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_blockTimestampLast',
        type: 'uint256',
      },
    ],
    payable: false,
    stateMutability: 'view',
    type: 'function',
  },
];

const solidlyFactoryIface = new Interface(SolidlyFactoryABI);

export class SolidlyRpcPoolTracker extends Solidly {
  public pools: Pool[] = [];

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
  }

  // getAllPoolsCallData should be overridden in case RPC pool tracker is used
  protected getAllPoolsCallData(): MultiCallParams<number> | undefined {
    return undefined;
  }

  // getPoolCallData should be overridden in case RPC pool tracker is used
  protected getPoolCallData(
    index: number,
  ): MultiCallParams<string> | undefined {
    return undefined;
  }

  async updatePoolState() {
    this.logger.info(
      `Started updating pools for ${this.dexKey} on ${this.network} network`,
    );
    await this.updatePools();
    await this.updatePoolsReserves(this.pools);
    this.logger.info(
      `Finished updating pools for ${this.dexKey} on ${this.network} network`,
    );
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = tokenAddress.toLowerCase();

    let pools = this.pools
      .filter(
        pool => pool.token0.address === token || pool.token1.address === token,
      )
      .sort((a, b) => {
        const aReserve = token === a.token0.address ? a.reserve0 : a.reserve1;
        const bReserve = token === b.token0.address ? b.reserve0 : b.reserve1;

        return Number(bReserve - aReserve);
      })
      .slice(0, limit);

    if (pools.length === 0) {
      return [];
    }

    // reserves are updated in `updatePoolState` regularly, so no need to update them each time here
    // pools = await this.updatePoolsReserves(pools.map(pool => pool.address));

    const tokensAmounts = pools
      .map(pool => {
        const token0 = pool.token0.address;
        const token1 = pool.token1.address;
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
        token === pool.token0.address ? pool.token1 : pool.token0;

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

  async updatePools() {
    const allPoolsCallData = this.getAllPoolsCallData();
    if (!allPoolsCallData) {
      throw new Error('getAllPoolsCallData is not implemented');
    }

    const callData: MultiCallParams<number>[] = [allPoolsCallData];

    const [allPoolsLength] =
      await this.dexHelper.multiWrapper.tryAggregate<number>(true, callData);

    if (this.pools.length < allPoolsLength.returnData) {
      await this.initPools(this.pools.length, allPoolsLength.returnData);
    }
  }

  async initPools(fromIndex: number, toIndex: number) {
    const allPoolsCallData: MultiCallParams<string>[] = [];
    for (let i = fromIndex; i < toIndex; i++) {
      const poolCallData = this.getPoolCallData(i);
      if (!poolCallData) {
        throw new Error('getPoolCallData is not implemented');
      }
      allPoolsCallData.push(poolCallData);
    }

    const allPoolsResults =
      await this.dexHelper.multiWrapper.tryAggregate<string>(
        true,
        allPoolsCallData,
      );

    const poolsCalldata: MultiCallParams<string | [bigint, bigint, number]>[] =
      [];

    for (const poolResult of allPoolsResults) {
      poolsCalldata.push(
        {
          target: poolResult.returnData,
          callData: solidlyFactoryIface.encodeFunctionData('token0', []),
          decodeFunction: addressDecode,
        },
        {
          target: poolResult.returnData,
          callData: solidlyFactoryIface.encodeFunctionData('token1', []),
          decodeFunction: addressDecode,
        },
        {
          target: poolResult.returnData,
          callData: solidlyFactoryIface.encodeFunctionData('getReserves', []),
          decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
            return generalDecoder(
              result,
              ['uint256', 'uint256', 'uint256'],
              [0n, 0n, 0],
              res => [BigInt(res[0]), BigInt(res[1]), Number(res[2])],
            );
          },
        },
      );
    }

    const pools = await this.dexHelper.multiWrapper.tryAggregate<
      string | [bigint, bigint, number]
    >(false, poolsCalldata);

    this.pools = [];

    const tokensSet = new Set<string>();
    for (let i = 0; i < allPoolsResults.length; i++) {
      const token0 = (pools[i * 3].returnData as string).toLowerCase();
      const token1 = (pools[i * 3 + 1].returnData as string).toLowerCase();

      tokensSet.add(token0.toLowerCase());
      tokensSet.add(token1.toLowerCase());
    }

    const decimalsCalldata: MultiCallParams<number>[] = [];
    const tokens = Array.from(tokensSet);

    for (const token of tokens) {
      decimalsCalldata.push({
        target: token,
        callData: solidlyFactoryIface.encodeFunctionData('decimals', []),
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
      acc[token] = result.returnData ?? 18;
      return acc;
    }, {} as Record<string, number>);

    for (let i = 0; i < allPoolsResults.length; i++) {
      const poolAddress = allPoolsResults[i].returnData.toLowerCase();
      const token0 = (pools[i * 3].returnData as string).toLowerCase();
      const token1 = (pools[i * 3 + 1].returnData as string).toLowerCase();
      const [reserve0, reserve1] = (pools[i * 3 + 2]?.returnData ?? [
        0n,
        0n,
        0,
      ]) as [bigint, bigint, number];

      this.pools.push({
        address: poolAddress,
        token0: {
          address: token0,
          decimals: decimals[token0],
        },
        token1: {
          address: token1,
          decimals: decimals[token1],
        },
        reserve0,
        reserve1,
      });
    }
  }

  async updatePoolsReserves(pools: Pool[]): Promise<Pool[]> {
    const callData: MultiCallParams<[bigint, bigint, number]>[] = [];

    for (const pool of pools) {
      callData.push({
        target: pool.address,
        callData: solidlyFactoryIface.encodeFunctionData('getReserves', []),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) => {
          return generalDecoder(
            result,
            ['uint256', 'uint256', 'uint256'],
            [0n, 0n, 0],
            res => [BigInt(res[0]), BigInt(res[1]), Number(res[2])],
          );
        },
      });
    }

    const results = await this.dexHelper.multiWrapper.tryAggregate<
      [bigint, bigint, number]
    >(false, callData);

    const _pools: Pool[] = [];

    for (let i = 0; i < pools.length; i++) {
      const [reserve0, reserve1] = (results[i].returnData ?? [0n, 0n, 0]) as [
        bigint,
        bigint,
        number,
      ];

      pools[i].reserve0 = reserve0;
      pools[i].reserve1 = reserve1;
    }

    return _pools;
  }
}
