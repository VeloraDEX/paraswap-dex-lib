import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import FactoryABI from '../../abi/algebra-integral/AlgebraFactory.abi.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers/lib/utils';
import { FactoryState, Pool } from './types';
import { NULL_ADDRESS, SUBGRAPH_TIMEOUT } from '../../constants';

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
    blockNumber: number,
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
      if (res.errors[0].message.includes('missing block')) {
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
}
