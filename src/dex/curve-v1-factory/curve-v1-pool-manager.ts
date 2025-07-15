import _ from 'lodash';
import { Logger } from 'log4js';
import { Address } from '@paraswap/core';
import { IDexHelper } from '../../dex-helper';
import { TaskScheduler } from '../../lib/task-scheduler';
import {
  CURVE_API_URL,
  LIQUIDITY_FETCH_TIMEOUT_MS,
  LIQUIDITY_UPDATE_PERIOD_MS,
  MAX_ALLOWED_STATE_DELAY_FACTOR,
  NETWORK_ID_TO_NAME,
  STATE_UPDATE_PERIOD_MS,
  STATE_UPDATE_RETRY_PERIOD_MS,
} from './constants';
import { PriceHandler } from './price-handlers/price-handler';
import { PoolPollingBase } from './state-polling-pools/pool-polling-base';
import { StatePollingManager } from './state-polling-pools/polling-manager';
import { CACHE_PREFIX, NULL_ADDRESS } from '../../constants';
import { LiquidityInCache } from './types';
import { assert } from 'ts-essentials';

/*
 * The idea of FactoryPoolManager is to try to abstract both pool types: fully event based
 * semi event based into one wall `PoolManager`. Currently we only support only
 * semi event based, but it may be extended in future when we make full transition from CurveV1
 */

export class CurveV1FactoryPoolManager {
  // This is needed because we initialize all factory pools + custom pools
  // Custom pools are not fully supported. I need them only in meta pools as base pool
  // to get poolState, but not for pricing requests.
  // It appears from CurveV1 and CurveV1Factory duality
  // Sometimes it happens that as customPool we have factory plain pool, in that case I use
  // isUsedForPricing flag to identify if it must be used for pricing or not. If yes,
  // it goes to statePollingPoolsFromId
  private poolsForOnlyState: Record<string, PoolPollingBase> = {};

  // poolsForOnly State and statePollingPoolsFromId must not have overlapping in pool
  private statePollingPoolsFromId: Record<string, PoolPollingBase> = {};

  // This is fast lookup table when you look for pair and searching for coins in all pools
  // In fact it is skewed in favor of CRV, so we still end up with 100 pools for CRV token.
  // It should bo considered for optimizing
  private coinAddressesToPoolIdentifiers: Record<string, string[]> = {};

  private allCurveLiquidityApiSlugs: Set<string> = new Set([
    '/factory',
    '/factory-crvusd',
    '/factory-stable-ng',
  ]);

  private statePollingManager: StatePollingManager;
  private taskScheduler: TaskScheduler;

  private liquidityUpdatedAtMs: number = 0;

  private liquidityLastUpdateInfoKey: string;
  private liquidityCacheKey: string;

  constructor(
    private name: string,
    cacheStateKey: string,
    private logger: Logger,
    private dexHelper: IDexHelper,
    private allPriceHandlers: Record<string, PriceHandler>,
    stateUpdatePeriodMs: number = STATE_UPDATE_PERIOD_MS,
    stateUpdateRetryPeriodMs: number = STATE_UPDATE_RETRY_PERIOD_MS,
    maxAllowedStateDelayFactor: number = MAX_ALLOWED_STATE_DELAY_FACTOR,
  ) {
    this.statePollingManager = new StatePollingManager(
      dexHelper,
      cacheStateKey,
      // lower than on PoolPollingBase.isStateUpToDate to increase chances of getting fresh data if pub-sub is lagging
      Math.round(
        (stateUpdatePeriodMs / 1000) * (maxAllowedStateDelayFactor - 1),
      ),
    );

    if (this.dexHelper.config.isSlave) {
      this.statePollingManager.subscribe();
    }

    this.taskScheduler = new TaskScheduler(
      this.name,
      this.logger,
      this.updatePollingPoolsInBatch.bind(this),
      stateUpdatePeriodMs,
      stateUpdateRetryPeriodMs,
    );
    this.liquidityCacheKey = `${CACHE_PREFIX}_liquidity_in_usd`.toLowerCase();

    // In cache we have one reserved key name where we get when all these keys were updated
    this.liquidityLastUpdateInfoKey = `liquidityUpdatedAtMs`;
  }

  initializePollingPools() {
    this.taskScheduler.reinitializeTaskScheduler();
    // Execute and start timer
    this.taskScheduler.setTimer(0);
  }

  updatePollingPoolsInBatch() {
    // This is the sorted array of pools to update. Main point is - first are pools
    // from non-meta pools and only after that meta pools.
    // It may be optimized preparing this pools before hand
    const filteredPoolsByLiquidity = Object.values(
      this.statePollingPoolsFromId,
    ).filter(p => p.hasEnoughLiquidity());

    const pools = Object.values(this.poolsForOnlyState).concat(
      filteredPoolsByLiquidity.sort((a, b) => +a.isMetaPool - +b.isMetaPool),
    );

    return this.statePollingManager.updatePoolsInBatch(
      this.logger,
      this.dexHelper,
      pools,
      undefined,
      Date.now() - this.liquidityUpdatedAtMs > LIQUIDITY_UPDATE_PERIOD_MS
        ? this.fetchLiquiditiesFromApi.bind(this)
        : undefined,
    );
  }

  async updateManuallyPollingPools(pools: PoolPollingBase[]) {
    return this.statePollingManager.updatePoolsInBatch(
      this.logger,
      this.dexHelper,
      pools,
      undefined,
      undefined,
    );
  }

  async initializeIndividualPollingPoolState(
    identifier: string,
    isSrcFeeOnTransferTokenToBeExchanged: boolean,
    blockNumber?: number,
  ) {
    const pool = this.getPool(identifier, isSrcFeeOnTransferTokenToBeExchanged);
    if (pool === null) {
      this.logger.error(
        `${identifier}: can not initialize first state for pool`,
      );
      return;
    }

    await this.statePollingManager.updatePoolsInBatch(
      this.logger,
      this.dexHelper,
      [pool],
      blockNumber,
    );
  }

  getPriceHandler(implementationAddress: string): PriceHandler {
    assert(
      this.allPriceHandlers[implementationAddress],
      `No price handler for ${implementationAddress}`,
    );

    return this.allPriceHandlers[implementationAddress];
  }

  releaseResources() {
    this.taskScheduler.releaseResources();
  }

  initializeNewPool(identifier: string, pool: PoolPollingBase) {
    if (this.statePollingPoolsFromId[identifier]) {
      return;
    }

    if (this.poolsForOnlyState[identifier]) {
      throw new Error(
        `${this.name}: pool with ${identifier} is already initialized as custom pool`,
      );
    }

    this.statePollingPoolsFromId[identifier] = pool;

    const allCoins = pool.poolConstants.COINS.concat(
      Object.keys(pool.underlyingCoinsToIndices),
    ).filter(p => p !== NULL_ADDRESS);
    // It is not quite efficient, but since it is done only on init part,
    // I think it should be ok
    allCoins.forEach(c => {
      const identifiers = this.coinAddressesToPoolIdentifiers[c];
      if (identifiers === undefined) {
        this.coinAddressesToPoolIdentifiers[c] = [identifier];
      } else {
        this.coinAddressesToPoolIdentifiers[c].push(identifier);
        this.coinAddressesToPoolIdentifiers[c] = _.uniq(
          this.coinAddressesToPoolIdentifiers[c],
        );
      }
    });

    this.allCurveLiquidityApiSlugs.add(pool.curveLiquidityApiSlug);
  }

  initializeNewPoolForState(identifier: string, pool: PoolPollingBase) {
    // Temporary hack before every pool is ported into new architecture
    if (pool.isUsedForPricing) {
      this.initializeNewPool(identifier, pool);
      return;
    }

    if (this.poolsForOnlyState[identifier]) {
      this.logger.trace(
        `${this.name}: pool with identifier ${identifier} is already initialized`,
      );
      return;
    }

    if (this.statePollingPoolsFromId[identifier]) {
      throw new Error(
        `${this.name}: pool with ${identifier} is not used for pricing, but already initialized as factory pool`,
      );
    }

    this.poolsForOnlyState[identifier] = pool;
  }

  getPoolsForPair(
    srcTokenAddress: string,
    destTokenAddress: string,
    isSrcFeeOnTransferToBeExchanged?: boolean,
  ): PoolPollingBase[] {
    const inSrcTokenIdentifiers =
      this.coinAddressesToPoolIdentifiers[srcTokenAddress];
    const inDestTokenIdentifiers =
      this.coinAddressesToPoolIdentifiers[destTokenAddress];

    // I am not sure about this intersection. Maybe better take pool with longer
    // elements and use only that? Because while doing intersection, it still
    // iterates on all elements since we are not using any hashed structure like Set
    let intersectedPoolIdentifiersSubset: string[] = [];
    if (
      inSrcTokenIdentifiers !== undefined &&
      inDestTokenIdentifiers !== undefined
    ) {
      intersectedPoolIdentifiersSubset = _.intersection(
        inSrcTokenIdentifiers,
        inDestTokenIdentifiers,
      );
    }

    const pools = intersectedPoolIdentifiersSubset
      .map(identifier =>
        this.getPool(
          identifier,
          isSrcFeeOnTransferToBeExchanged
            ? isSrcFeeOnTransferToBeExchanged
            : false,
        ),
      )
      .filter((p): p is PoolPollingBase => {
        if (p === null || !p.hasEnoughLiquidity()) {
          return false;
        }

        const currentState = p.getState();
        if (
          currentState === null ||
          // Pool has no liquidity
          currentState.balances.every(b => b === 0n)
        ) {
          return false;
        }

        const poolData = p.getPoolData(srcTokenAddress, destTokenAddress);
        if (poolData === null) {
          return false;
        }

        return true;
      });

    return pools;
  }

  getPool(
    identifier: string,
    isSrcFeeOnTransferTokenToBeExchanged: boolean,
  ): PoolPollingBase | null {
    const pool = this.statePollingPoolsFromId[identifier];
    if (pool !== undefined) {
      if (
        isSrcFeeOnTransferTokenToBeExchanged &&
        pool.isSrcFeeOnTransferSupported
      ) {
        return pool;
      } else if (!isSrcFeeOnTransferTokenToBeExchanged) {
        return pool;
      }
    }

    const fromStateOnlyPools = this.poolsForOnlyState[identifier];
    if (fromStateOnlyPools !== undefined) {
      if (
        isSrcFeeOnTransferTokenToBeExchanged &&
        fromStateOnlyPools.isSrcFeeOnTransferSupported
      ) {
        return fromStateOnlyPools;
      } else if (!isSrcFeeOnTransferTokenToBeExchanged) {
        return fromStateOnlyPools;
      }
    }

    return null;
  }

  async fetchLiquiditiesFromApi(): Promise<void> {
    // Role 1: In case of slave version try to fetch liquidity info from cache
    if (this.dexHelper.config.isSlave) {
      const liquiditiesUnparsed = await this.dexHelper.cache.get(
        this.name,
        this.dexHelper.config.data.network,
        this.liquidityCacheKey,
      );
      if (liquiditiesUnparsed === null) {
        // Here we just log this event and since we didn't went else branch, code
        // is executed further and go to actual liquidity check
        // To follow the logic, just skip this block and continue reading
        this.logger.error(
          `${this.name} ${this.dexHelper.config.data.network}: No liquidity info found in cache. Falling back to request`,
        );
      } else {
        // If we found something in cache, we parse that and update our local variables
        // Values can not be outdated, because I put TTL on each entry. In that case we just
        // receive null and fallback to request
        const liquiditiesParsed = JSON.parse(
          liquiditiesUnparsed,
        ) as LiquidityInCache;

        this.liquidityUpdatedAtMs =
          liquiditiesParsed[this.liquidityLastUpdateInfoKey];
        for (const pool of Object.values(this.statePollingPoolsFromId)) {
          if (liquiditiesParsed[pool.address] !== undefined) {
            pool.liquidityUSD = liquiditiesParsed[pool.address];
          } else {
            pool.liquidityUSD = 0;
          }
        }
        this.logger.trace(
          `${this.name} ${this.dexHelper.config.data.network}: pools liquidity successfully updated from cache`,
        );
        return;
      }
    }

    // Role 2: In case if master version or fallback to requests
    let URL: string = '';
    try {
      let someFailed = false;
      const responses = await Promise.all(
        Array.from(this.allCurveLiquidityApiSlugs).map(async slug => {
          URL = `${CURVE_API_URL}/${
            NETWORK_ID_TO_NAME[this.dexHelper.config.data.network]
          }${slug}`;

          return this.dexHelper.httpRequest.get<{
            success: boolean;
            data: {
              poolData: {
                usdTotal: number;
                address: string;
                usdTotalExcludingBasePool: number;
              }[];
            };
          }>(URL, LIQUIDITY_FETCH_TIMEOUT_MS);
        }),
      );
      const addressToLiquidity: Record<string, number> = {};
      for (const data of responses) {
        if (!data.success) {
          someFailed = true;
          break;
        }
        for (const poolData of data.data.poolData) {
          if (poolData.usdTotalExcludingBasePool || poolData.usdTotal) {
            addressToLiquidity[poolData.address.toLowerCase()] =
              poolData.usdTotalExcludingBasePool || poolData.usdTotal;
          }
        }
      }
      if (someFailed) {
        // This is needed to reduce complexity and don't track when each API was updated. We either update
        // everything or don't update anything and invalidate liquidity amounts
        this.logger.error(
          `${this.name} ${this.dexHelper.config.data.network}: some of the Curve API requests fail. Won't update anything.`,
        );
        return;
      }

      Object.values(this.statePollingPoolsFromId).map(pool => {
        const poolLiquidity = addressToLiquidity[pool.address];
        if (poolLiquidity === undefined) {
          pool.liquidityUSD = 0;
        } else {
          pool.liquidityUSD = poolLiquidity;
        }
      });

      this.liquidityUpdatedAtMs = Date.now();

      this.logger.info(
        `${this.name} ${this.dexHelper.config.data.network}: successfully fetched liquidity updates`,
      );

      // Update cache if it is master version
      if (!this.dexHelper.config.isSlave) {
        addressToLiquidity[this.liquidityLastUpdateInfoKey] =
          this.liquidityUpdatedAtMs;

        this.dexHelper.cache
          .setex(
            this.name,
            this.dexHelper.config.data.network,
            this.liquidityCacheKey,
            Math.floor((LIQUIDITY_UPDATE_PERIOD_MS * 2) / 1000),
            JSON.stringify(addressToLiquidity),
          )
          .catch(e => {
            this.logger.error(
              `${this.name}: failed to save new liquidity state to cache: `,
              e,
            );
          });
      }
    } catch (e) {
      this.logger.error(
        `${this.name}: Error fetching liquidity from Curve API ${URL}: `,
        e,
      );
    }
  }

  getPoolsWithToken(tokenAddress: Address): PoolPollingBase[] {
    const poolIdentifiers = this.coinAddressesToPoolIdentifiers[tokenAddress];
    if (poolIdentifiers === undefined) {
      return [];
    }
    return poolIdentifiers
      .map(poolIdentifier => this.getPool(poolIdentifier, false))
      .filter((p): p is PoolPollingBase => p !== null);
  }
}
