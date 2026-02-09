import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import FactoryABI from '../../abi/algebra-integral/AlgebraFactory.abi.json';
import erc20Abi from '../../abi/erc20.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers/lib/utils';
import { FactoryState, Pool } from './types';
import { ETHER_ADDRESS, NULL_ADDRESS, SUBGRAPH_TIMEOUT } from '../../constants';
import { MIN_USD_TVL_FOR_PRICING } from './constants';
import { uint256ToBigInt } from '../../lib/decoders';

/*
 * "Stateless" event subscriber in order to capture "PoolCreated" event on new pools created.
 * State is present, but it's a placeholder to actually make the events reach handlers (if there's no previous state - `processBlockLogs` is not called)
 */
export class AlgebraIntegralFactory extends StatefulEventSubscriber<FactoryState> {
  handlers: {
    [event: string]: (event: any) => Promise<void>;
  } = {};

  logDecoder: (log: Log) => any;

  private pools: Pool[] = [];
  private erc20Interface = new Interface(erc20Abi);

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected factoryAddress: Address,
    protected subgraphURL: string,
    protected factoryIface = new Interface(FactoryABI),
  ) {
    super(parentName, `${parentName} Factory`, dexHelper, logger, false);

    this.addressesSubscribed = [factoryAddress];

    this.logDecoder = (log: Log) => this.factoryIface.parseLog(log);

    this.handlers['Pool'] = this.handleNewPool.bind(this);
    this.handlers['CustomPool'] = this.handleNewCustomPool.bind(this);
  }

  async initialize(blockNumber: number) {
    this.pools = await this.queryAllAvailablePools(blockNumber);
  }

  generateState(): FactoryState {
    return {};
  }

  protected async processLog(
    _: DeepReadonly<FactoryState>,
    log: Readonly<Log>,
  ): Promise<FactoryState> {
    const event = this.logDecoder(log);
    if (event.name in this.handlers) {
      await this.handlers[event.name](event);
    }

    return {};
  }

  public getAvailablePoolsForPair(
    srcToken: Address,
    destToken: Address,
  ): Pool[] {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = [
      _srcToken.toLowerCase(),
      _destToken.toLowerCase(),
    ];

    return this.pools
      .filter(
        pool =>
          (pool.token0 === _srcAddress && pool.token1 === _destAddress) ||
          (pool.token0 === _destAddress && pool.token1 === _srcAddress),
      )
      .filter(pool => pool.tvlUSD >= MIN_USD_TVL_FOR_PRICING)
      .sort((a, b) => {
        // sort by tvl
        const tvlDiff = b.tvlUSD - a.tvlUSD;
        if (tvlDiff !== 0) {
          return tvlDiff;
        }

        return 1;
      });
  }

  public async queryAllAvailablePools(blockNumber: number): Promise<Pool[]> {
    const defaultPerPageLimit = 1000;
    let pools: Pool[] = [];
    let skip = 0;

    let currentPools: Pool[] =
      await this.queryOnePageForAllAvailablePoolsFromSubgraph(
        blockNumber,
        skip,
        defaultPerPageLimit,
      );
    pools = pools.concat(currentPools);

    while (currentPools.length === defaultPerPageLimit) {
      skip += defaultPerPageLimit;
      currentPools = await this.queryOnePageForAllAvailablePoolsFromSubgraph(
        blockNumber,
        skip,
        defaultPerPageLimit,
      );

      pools = pools.concat(currentPools);
    }

    return pools;
  }

  private async queryOnePageForAllAvailablePoolsFromSubgraph(
    blockNumber: number,
    skip: number,
    limit: number,
    latestBlock = false,
  ): Promise<Pool[]> {
    const poolsQuery = `query ($skip: Int!, $first: Int!) {
      pools(
        ${latestBlock ? '' : `block: { number: ${blockNumber} }`}
        orderBy: totalValueLockedUSD
        orderDirection: desc
        skip: $skip
        first: $first
      ) {
        id
        deployer
        totalValueLockedUSD
        token0 {
          id
        }
        token1 {
          id
        }
      }
    }`;

    const res = await this.dexHelper.httpRequest.querySubgraph<{
      data: {
        pools: Array<{
          id: string;
          deployer: string;
          totalValueLockedUSD: string;
          token0: { id: string };
          token1: { id: string };
        }>;
      };
      errors?: { message: string }[];
    }>(
      this.subgraphURL,
      {
        query: poolsQuery,
        variables: {
          skip,
          first: limit,
        },
      },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (res.errors && res.errors.length) {
      if (
        res.errors[0].message.includes('missing block') ||
        res.errors[0].message.includes('not yet available')
      ) {
        this.logger.info(
          `${this.parentName}: subgraph fallback to the latest block...`,
        );
        return this.queryOnePageForAllAvailablePoolsFromSubgraph(
          blockNumber,
          skip,
          limit,
          true,
        );
      } else {
        throw new Error(res.errors[0].message);
      }
    }

    return res.data.pools.map(pool => ({
      poolAddress: pool.id.toLowerCase(),
      token0: pool.token0.id.toLowerCase(),
      token1: pool.token1.id.toLowerCase(),
      deployer: pool.deployer.toLowerCase(),
      tvlUSD: parseFloat(pool.totalValueLockedUSD) || 0,
    }));
  }

  async handleNewPool(event: LogDescription) {
    const token0 = event.args.token0.toLowerCase();
    const token1 = event.args.token1.toLowerCase();
    const deployer = NULL_ADDRESS; // Regular pools have zero address as deployer

    const poolAddress = event.args.pool?.toLowerCase() || '';
    if (poolAddress) {
      this.pools.push({
        poolAddress,
        token0,
        token1,
        deployer,
        tvlUSD: 0,
      });
    }
  }

  async handleNewCustomPool(event: LogDescription) {
    const token0 = event.args.token0.toLowerCase();
    const token1 = event.args.token1.toLowerCase();
    const deployer = event.args.deployer.toLowerCase();

    const poolAddress = event.args.pool?.toLowerCase() || '';
    if (poolAddress) {
      this.pools.push({
        poolAddress,
        token0,
        token1,
        deployer,
        tvlUSD: 0,
      });
    }
  }

  async updatePoolsTvl(): Promise<void> {
    if (this.pools.length === 0) return;

    // Build multicall to fetch token balances for all pools
    const balanceCalls = this.pools.flatMap(pool => [
      {
        target: pool.token0,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          pool.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: pool.token1,
        callData: this.erc20Interface.encodeFunctionData('balanceOf', [
          pool.poolAddress,
        ]),
        decodeFunction: uint256ToBigInt,
      },
    ]);

    const balanceResults =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        balanceCalls,
      );

    // Build token amounts for USD conversion
    const tokenAmounts: [string, bigint][] = this.pools.flatMap((pool, i) => {
      const balance0 = balanceResults[i * 2].success
        ? balanceResults[i * 2].returnData
        : 0n;
      const balance1 = balanceResults[i * 2 + 1].success
        ? balanceResults[i * 2 + 1].returnData
        : 0n;

      return [
        [
          pool.token0 === NULL_ADDRESS.toLowerCase()
            ? ETHER_ADDRESS
            : pool.token0,
          balance0,
        ],
        [
          pool.token1 === NULL_ADDRESS.toLowerCase()
            ? ETHER_ADDRESS
            : pool.token1,
          balance1,
        ],
      ] as [string, bigint][];
    });

    // Get USD values
    const usdValues = await this.dexHelper.getUsdTokenAmounts(tokenAmounts);

    // Update pool TVL
    this.pools.forEach((pool, i) => {
      const tvl0 = usdValues[i * 2] || 0;
      const tvl1 = usdValues[i * 2 + 1] || 0;
      pool.tvlUSD = tvl0 + tvl1;
    });
  }
}
