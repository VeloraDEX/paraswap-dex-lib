import { Logger } from 'log4js';
import { IDexHelper } from '../../../dex-helper';
import { Utils, _require } from '../../../utils';
import { PoolState } from '../types';
import { MulticallReturnedTypes, PoolPollingBase } from './pool-polling-base';
import { ExpHashPubSub } from '../../../lib/pub-sub';

/*
 * Since we are updating all pools state at once, I need some generalized iterator without state,
 * just to go for every pool, get multicall requests and apply them into new state
 */

export class StatePollingManager {
  private pubSub: ExpHashPubSub;

  constructor(dexHelper: IDexHelper, cacheKey: string, ttl: number) {
    this.pubSub = new ExpHashPubSub(dexHelper, cacheKey, ttl);
  }

  subscribe() {
    this.pubSub.subscribe();
  }

  async fetchAndSetStatesFromRPC(
    dexHelper: IDexHelper,
    pools: PoolPollingBase[],
    blockNumber?: number,
  ): Promise<(PoolState | null)[]> {
    if (pools.length === 0) {
      return [];
    }

    const newStates = new Array(pools.length);

    const poolResultDividers = new Array<number>(pools.length).fill(0);
    const callDatas = pools
      .map((p, i) => {
        const poolCalldata = p.getStateMultiCalldata();
        poolResultDividers[i] = poolCalldata.length;
        return poolCalldata;
      })
      .flat();

    let _blockNumber = blockNumber;
    if (_blockNumber === undefined) {
      // If we were not given with blockNumber, set state blockNumber to 0,
      // that is indicating that block number was the latest.
      // If we request here latest blockNumber and try to send query, we frequently
      // hit problem with late nodes. Some node may give us blockNumber 10,
      // but when trying to do query we may hit node that is only on 9 blocknumber
      // And it is a problem. Especially on Optimism and Avalanche.
      _blockNumber = 0;
    }

    const results = await dexHelper.multiNonZeroSenderWrapper.tryAggregate(
      false,
      callDatas,
      blockNumber,
      1000,
    );
    const updatedAt = Date.now();

    let lastStart = 0;

    for (const [i, p] of pools.entries()) {
      const resultsForPool = results.slice(
        lastStart,
        lastStart + poolResultDividers[i],
      );

      let someCallsFailed = false;
      let failedCalls: number[] = [];
      const multiOutputs = resultsForPool.map((result, i) => {
        if (result.success === false) {
          someCallsFailed = true;
          failedCalls.push(i);
          return null;
        }
        return result.returnData;
        // I consider this conversion safe without further checks, because if call failed, we won't proceed to state parsing
      }) as MulticallReturnedTypes[];

      if (someCallsFailed) {
        const multiCallRequests = p.getStateMultiCalldata();
        failedCalls.forEach(i => {
          p.logger.error(
            `Call number ${i} for pool=${p.address} to ${multiCallRequests[i].target} with ${multiCallRequests[i].callData} failed`,
          );
        });
        newStates[i] = null;
        continue;
      }

      const newState = p.parseMultiResultsToStateValues(
        multiOutputs,
        _blockNumber,
        updatedAt,
      );
      p.setState(newState);
      newStates[i] = newState;
      lastStart += poolResultDividers[i];
    }

    return newStates;
  }

  async masterUpdatePoolsInBatch(
    logger: Logger,
    dexHelper: IDexHelper,
    pools: PoolPollingBase[],
    blockNumber?: number,
  ) {
    const dexKey = pools.length > 0 ? pools[0].dexKey : 'CurveV1Factory';
    try {
      const newStates = await this.fetchAndSetStatesFromRPC(
        dexHelper,
        pools,
        blockNumber,
      );
      _require(
        newStates.length === pools.length,
        "newStates length doesn't match pools length",
        { poolLength: pools.length, newStatesLength: newStates.length },
        'newStates.length === pools.length',
      );

      const dataToPublish: Record<string, PoolState | null> = newStates.reduce(
        (acc, state, i) => {
          acc[pools[i].poolIdentifier] = state;
          return acc;
        },
        {} as Record<string, PoolState | null>,
      );

      this.pubSub.publish(dataToPublish);

      await Promise.all(
        pools.map(async (p, i) => {
          if (newStates[i] !== null) {
            await dexHelper.cache.hset(
              p.cacheStateKey,
              p.poolIdentifier,
              Utils.Serialize(newStates[i]),
            );
          } else {
            await dexHelper.cache.hdel(p.cacheStateKey, [p.poolIdentifier]);
          }
        }),
      );

      // logger.info(
      //   `${dexKey}: all (${pools.length}) pools state was successfully updated on network ${dexHelper.config.data.network}`,
      // );
    } catch (e) {
      logger.error(
        `${dexKey}: On network ${
          dexHelper.config.data.network
        } failed to update state for pools: ${pools
          .slice(0, 10)
          .map(p => p.address)
          .join(', ')}${pools.length > 10 ? '...' : ''}: `,
        e,
      );
    }
  }

  async slaveUpdatePoolsInBatch(
    logger: Logger,
    dexHelper: IDexHelper,
    pools: PoolPollingBase[],
    blockNumber?: number,
  ) {
    const dexKey = pools.length > 0 ? pools[0].dexKey : 'CurveV1Factory';
    const poolsForRPCUpdate: PoolPollingBase[] = [];

    await Promise.all(
      pools.map(async p => {
        try {
          const parsedState = await this.pubSub.getAndCache<PoolState>(
            p.poolIdentifier,
          );
          if (parsedState !== null) {
            if (p.isStateUpToDate(parsedState)) {
              p.setState(parsedState);
              return;
            }
          }
        } catch (e) {
          logger.error(
            `${p.dexKey}-${p.poolIdentifier}: Error getting state from cache: `,
            e,
          );
        }

        if (p.baseStatePoolPolling) {
          poolsForRPCUpdate.push(p.baseStatePoolPolling);
        }

        poolsForRPCUpdate.push(p);
      }),
    );

    if (poolsForRPCUpdate.length === 0) {
      return;
    }

    try {
      logger.warn(
        `${dexKey}: ${poolsForRPCUpdate.length} pools: ${poolsForRPCUpdate
          .map(p => p.address)
          .join(', ')} don't have state in cache on network ${
          dexHelper.config.data.network
        }. Falling back to RPC`,
      );

      await this.fetchAndSetStatesFromRPC(
        dexHelper,
        poolsForRPCUpdate,
        blockNumber,
      );
      return;
    } catch (e) {
      logger.error(
        `${dexKey}: On network ${
          dexHelper.config.data.network
        } failed to fetch state from RPC for pools: ${pools
          .slice(0, 10)
          .map(p => p.address)
          .join(', ')}${pools.length > 10 ? '...' : ''}: `,
        e,
      );
      return;
    }
  }

  async updatePoolsInBatch(
    logger: Logger,
    dexHelper: IDexHelper,
    pools: PoolPollingBase[],
    blockNumber?: number,
    liquidityUpdateFunc?: Function,
  ) {
    if (pools.length === 0) {
      return;
    }

    if (liquidityUpdateFunc) {
      await liquidityUpdateFunc();
    }

    if (dexHelper.config.isSlave) {
      await this.slaveUpdatePoolsInBatch(logger, dexHelper, pools, blockNumber);
    } else {
      await this.masterUpdatePoolsInBatch(
        logger,
        dexHelper,
        pools,
        blockNumber,
      );
    }

    logger.trace(
      `CurveV1Factory: finished state update for ${pools.length} pools on network ${dexHelper.config.data.network}`,
    );
  }
}
