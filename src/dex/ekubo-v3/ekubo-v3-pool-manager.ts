import { Result } from '@ethersproject/abi';
import { BasicQuoteData, EkuboContracts } from './types';
import { DeepReadonly } from 'ts-essentials';
import { BlockHeader } from 'web3-eth';
import { Log, Logger, Token } from '../../types';
import { EventSubscriber, IDexHelper } from '../../dex-helper';
import { EkuboPool, IEkuboPool } from './pools/pool';
import {
  ConcentratedPoolTypeConfig,
  isConcentratedKey,
  isStableswapKey,
  PoolConfig,
  PoolKey,
  PoolTypeConfig,
  StableswapPoolTypeConfig,
} from './pools/utils';
import { convertAndSortTokens } from './utils';
import { floatSqrtRatioToFixed } from './pools/math/sqrt-ratio';
import { hexDataSlice, hexlify, hexValue, hexZeroPad } from 'ethers/lib/utils';
import {
  CORE_ADDRESS,
  MEV_CAPTURE_ADDRESS,
  ORACLE_ADDRESS,
  TWAMM_ADDRESS,
} from './config';
import { NULL_ADDRESS } from '../../constants';
import { FullRangePool, FullRangePoolState } from './pools/full-range';
import { StableswapPool } from './pools/stableswap';
import { BasePool, BasePoolState } from './pools/base';
import { OraclePool } from './pools/oracle';
import { MevCapturePool } from './pools/mev-capture';
import { TwammPool, TwammPoolState } from './pools/twamm';

const SUBGRAPH_QUERY = `query ($coreAddress: Bytes!, $extensions: [Bytes!]) {
  _meta {
    block {
      hash
      number
    }
  }
  poolInitializations(
    where: {coreAddress: $coreAddress, extension_in: $extensions}, orderBy: blockNumber
  ) {
    blockNumber
    blockHash
    tickSpacing
    stableswapCenterTick
    stableswapAmplification
    extension
    fee
    poolId
    token0
    token1
  }
}`;

const MIN_BITMAPS_SEARCHED = 2;
const MAX_BATCH_SIZE = 100;

const MAX_SUBGRAPH_RETRIES = 10;
const SUBGRAPH_RETRY_INTERVAL_MS = 3000;

type PoolKeyWithInitBlockNumber<C extends PoolTypeConfig> = {
  key: PoolKey<C>;
  initBlockNumber: number;
};

// The only attached EventSubscriber of this integration that will forward all relevant logs to the pools and handle pool initialization events
export class EkuboV3PoolManager implements EventSubscriber {
  public readonly name = 'PoolManager';

  public isTracking = () => false;

  public readonly poolsByBI = new Map<bigint, IEkuboPool<PoolTypeConfig>>();
  public readonly poolsByString = new Map<string, IEkuboPool<PoolTypeConfig>>();

  private readonly poolIdParsers: Record<
    string,
    Map<string, (data: string) => bigint | string>
  >;
  private readonly poolInitializedFragment;
  private readonly poolInitializedTopicHash;

  public constructor(
    public readonly parentName: string,
    private readonly logger: Logger,
    private readonly dexHelper: IDexHelper,
    private readonly contracts: EkuboContracts,
    private readonly subgraphId: string,
  ) {
    const {
      core: { contract: coreContract, interface: coreIface },
      twamm: { contract: twammContract, interface: twammIface },
    } = contracts;

    this.poolInitializedFragment = coreIface.getEvent('PoolInitialized');
    this.poolInitializedTopicHash = coreIface.getEventTopic('PoolInitialized');

    this.poolIdParsers = {
      [coreContract.address]: new Map([
        ['', parsePoolIdByLogDataOffsetFn(20)],
        [
          coreIface.getEventTopic('PositionUpdated'),
          parsePoolIdByLogDataOffsetFn(32),
        ],
      ]),
      [twammContract.address]: new Map<
        string,
        (data: string) => bigint | string
      >([
        ['', parsePoolIdByLogDataOffsetFn(0)],
        [
          twammIface.getEventTopic('OrderUpdated'),
          data =>
            new PoolKey(
              BigInt(hexDataSlice(data, 64, 96)),
              BigInt(hexDataSlice(data, 96, 128)),
              new PoolConfig(
                BigInt(TWAMM_ADDRESS),
                BigInt(hexDataSlice(data, 128, 136)),
                StableswapPoolTypeConfig.fullRangeConfig(),
              ),
            ).stringId,
        ],
      ]),
    };
  }

  public async update(
    logs: Readonly<Log>[],
    blockHeaders: Readonly<{ [blockNumber: number]: Readonly<BlockHeader> }>,
    blockNumberForMissingStateRegen?: number,
  ): Promise<void> {
    const poolsLogs = new Map<IEkuboPool<PoolTypeConfig>, Log[]>();

    for (const log of logs) {
      const contractParsers = this.poolIdParsers[log.address];
      if (typeof contractParsers === 'undefined') {
        continue;
      }

      const eventId = log.topics.at(0) ?? '';
      const poolIdParser = contractParsers.get(eventId);

      if (typeof poolIdParser !== 'undefined') {
        const poolId = poolIdParser(log.data);

        const pool =
          typeof poolId === 'bigint'
            ? this.poolsByBI.get(poolId)
            : this.poolsByString.get(poolId);

        if (typeof pool === 'undefined') {
          this.logger.warn(
            `Pool ID ${
              typeof poolId === 'bigint'
                ? hexZeroPad(hexValue(poolId), 32)
                : poolId
            } not found in pool map`,
          );
          continue;
        }

        const poolLogs = poolsLogs.get(pool) ?? [];

        poolLogs.push(log);
        poolsLogs.set(pool, poolLogs);
      } else if (
        log.address === this.contracts.core.contract.address &&
        log.topics[0] === this.poolInitializedTopicHash
      ) {
        const blockHeader = blockHeaders[log.blockNumber];
        if (typeof blockHeader === 'undefined') {
          this.logger.error(
            `Ignoring pool initialization because block header for block ${log.blockNumber} is not available`,
          );
          continue;
        }

        try {
          this.handlePoolInitialized(
            this.contracts.core.interface.decodeEventLog(
              this.poolInitializedFragment,
              log.data,
              log.topics,
            ),
            blockHeader,
          );
        } catch (err) {
          this.logger.error('Failed to handle pool initialization:', err);
        }
      }
    }

    await Promise.all(
      poolsLogs
        .entries()
        .map(([pool, logs]) =>
          pool.update(logs, blockHeaders, blockNumberForMissingStateRegen),
        ),
    );
  }

  public restart(blockNumber: number): void {
    for (const pool of this.poolsByBI.values()) {
      pool.restart(blockNumber);
    }
  }

  public rollback(blockNumber: number): void {
    for (const pool of this.poolsByBI.values()) {
      if (pool.initializationBlockNumber() > blockNumber) {
        this.deletePool(pool);
      } else {
        pool.rollback(blockNumber);
      }
    }
  }

  public invalidate(): void {
    for (const pool of this.poolsByBI.values()) {
      pool.invalidate();
    }
  }

  private async fetchCanonicalSubgraphPoolKeys(
    maxBlockNumber: number,
    subscribeToBlockManager: boolean,
  ): Promise<{
    poolKeys:
      | PoolKeyWithInitBlockNumber<
          StableswapPoolTypeConfig | ConcentratedPoolTypeConfig
        >[]
      | null;
    subscribedBlockNumber: number | null;
  }> {
    let poolKeys = null;
    let subscribedBlockNumber = null;

    try {
      const {
        _meta: {
          block: { number: subgraphBlockNumber, hash: subgraphBlockHash },
        },
        poolInitializations,
      } = (
        await this.dexHelper.httpRequest.querySubgraph<{
          data: {
            _meta: {
              block: {
                hash: string;
                number: number;
              };
            };
            poolInitializations: {
              blockNumber: string;
              blockHash: string;
              tickSpacing: number | null;
              stableswapCenterTick: number | null;
              stableswapAmplification: number | null;
              extension: string;
              fee: string;
              poolId: string;
              token0: string;
              token1: string;
            }[];
          };
        }>(
          this.subgraphId,
          {
            query: SUBGRAPH_QUERY,
            variables: {
              coreAddress: CORE_ADDRESS,
              extensions: [
                NULL_ADDRESS,
                ORACLE_ADDRESS,
                TWAMM_ADDRESS,
                MEV_CAPTURE_ADDRESS,
              ],
            },
          },
          {},
        )
      ).data;

      if (subscribeToBlockManager) {
        const blockNumber = Math.min(subgraphBlockNumber, maxBlockNumber);

        this.dexHelper.blockManager.subscribeToLogs(
          this,
          [
            this.contracts.core.contract.address,
            this.contracts.twamm.contract.address,
          ],
          blockNumber,
        );

        subscribedBlockNumber = blockNumber;
      }

      // Just check the existence of the latest known block by hash in the canonical chain.
      // This, together with the pool manager being subscribed before this check, ensures that
      // we can consistently transition from the subgraph to the RPC state.
      try {
        await this.dexHelper.provider.getBlock(subgraphBlockHash);
      } catch (err) {
        this.logger.warn(
          'Failed to transition from subgraph to RPC state (possible reorg):',
          err,
        );

        return {
          poolKeys: null,
          subscribedBlockNumber,
        };
      }

      // Remove pools initialized at a block > maxBlockNumber
      while (true) {
        const lastElem = poolInitializations.at(-1);
        if (
          typeof lastElem === 'undefined' ||
          Number(lastElem.blockNumber) <= maxBlockNumber
        ) {
          break;
        }
        poolInitializations.pop();
      }

      poolKeys = poolInitializations.flatMap(info => {
        let poolTypeConfig;

        if (info.tickSpacing !== null) {
          poolTypeConfig = new ConcentratedPoolTypeConfig(info.tickSpacing);
        } else if (
          info.stableswapAmplification !== null &&
          info.stableswapCenterTick !== null
        ) {
          poolTypeConfig = new StableswapPoolTypeConfig(
            info.stableswapCenterTick,
            info.stableswapAmplification,
          );
        } else {
          this.logger.error(
            `Pool ${info.poolId} has an unknown pool type config`,
          );
          return [];
        }

        return [
          {
            key: new PoolKey(
              BigInt(info.token0),
              BigInt(info.token1),
              new PoolConfig(
                BigInt(info.extension),
                BigInt(info.fee),
                poolTypeConfig,
              ),
              BigInt(info.poolId),
            ),
            initBlockNumber: Number(info.blockNumber),
          },
        ];
      });
    } catch (err) {
      this.logger.error('Subgraph pool key retrieval failed:', err);
    } finally {
      return {
        poolKeys,
        subscribedBlockNumber,
      };
    }
  }

  public async updatePools(
    blockNumber: number,
    subscribe: boolean,
  ): Promise<void> {
    let attempt = 0;
    let maxBlockNumber = blockNumber;
    let poolKeys = null;
    let mustActivateSubscription = subscribe;

    do {
      attempt++;

      const res = await this.fetchCanonicalSubgraphPoolKeys(
        maxBlockNumber,
        mustActivateSubscription,
      );

      if (res.subscribedBlockNumber !== null) {
        mustActivateSubscription = false;
        maxBlockNumber = res.subscribedBlockNumber;
      }

      if (res.poolKeys === null) {
        await new Promise(resolve =>
          setTimeout(resolve, SUBGRAPH_RETRY_INTERVAL_MS),
        );
      } else {
        poolKeys = res.poolKeys;
      }
    } while (poolKeys === null && attempt <= MAX_SUBGRAPH_RETRIES);

    if (poolKeys === null) {
      this.logger.error(
        `Subgraph initialization failed after ${MAX_SUBGRAPH_RETRIES} attempts`,
      );
      return;
    }

    if (!subscribe) {
      this.clearPools();
    }

    const [twammPoolKeys, otherPoolKeys] = poolKeys.reduce<
      [
        PoolKeyWithInitBlockNumber<StableswapPoolTypeConfig>[],
        PoolKeyWithInitBlockNumber<
          StableswapPoolTypeConfig | ConcentratedPoolTypeConfig
        >[],
      ]
    >(
      ([twammPoolKeys, otherPoolKeys], poolKeyWithInitBlockNumber) => {
        if (
          poolKeyWithInitBlockNumber.key.config.extension ===
          BigInt(TWAMM_ADDRESS)
        ) {
          twammPoolKeys.push(
            poolKeyWithInitBlockNumber as PoolKeyWithInitBlockNumber<StableswapPoolTypeConfig>,
          );
        } else {
          otherPoolKeys.push(poolKeyWithInitBlockNumber);
        }

        return [twammPoolKeys, otherPoolKeys];
      },
      [[], []],
    );

    const promises: Promise<void>[] = [];

    const commonArgs = [
      this.parentName,
      this.dexHelper,
      this.logger,
      this.contracts,
    ] as const;

    const addPool = async <
      C extends PoolTypeConfig,
      S,
      P extends EkuboPool<C, S>,
    >(
      constructor: {
        new (...args: [...typeof commonArgs, number, PoolKey<C>]): P;
      },
      initialState: DeepReadonly<S> | undefined,
      initBlockNumber: number,
      poolKey: PoolKey<C>,
    ): Promise<void> => {
      const pool = new constructor(...commonArgs, initBlockNumber, poolKey);

      pool.isTracking = this.isTracking;
      pool.setState(
        initialState ?? (await pool.generateState(blockNumber)),
        blockNumber,
      );

      this.setPool(pool);
    };

    for (
      let batchStart = 0;
      batchStart < otherPoolKeys.length;
      batchStart += MAX_BATCH_SIZE
    ) {
      const batch = otherPoolKeys.slice(
        batchStart,
        batchStart + MAX_BATCH_SIZE,
      );

      promises.push(
        (
          this.contracts.core.quoteDataFetcher.getQuoteData(
            batch.map(({ key }) => key.toAbi()),
            MIN_BITMAPS_SEARCHED,
            {
              blockTag: blockNumber,
            },
          ) as Promise<BasicQuoteData[]>
        )
          .then(async fetchedData => {
            await Promise.all(
              fetchedData.map(async (data, i) => {
                const { key: poolKey, initBlockNumber } =
                  otherPoolKeys[batchStart + i];
                const { extension } = poolKey.config;

                try {
                  if (isStableswapKey(poolKey)) {
                    switch (extension) {
                      case 0n:
                        poolKey.config.poolTypeConfig.isFullRange()
                          ? await addPool(
                              FullRangePool,
                              FullRangePoolState.fromQuoter(data),
                              initBlockNumber,
                              poolKey,
                            )
                          : await addPool(
                              StableswapPool,
                              FullRangePoolState.fromQuoter(data),
                              initBlockNumber,
                              poolKey,
                            );
                        break;
                      case BigInt(ORACLE_ADDRESS):
                        await addPool(
                          OraclePool,
                          FullRangePoolState.fromQuoter(data),
                          initBlockNumber,
                          poolKey,
                        );
                        break;
                      default:
                        throw new Error(
                          `Unknown pool extension ${hexZeroPad(
                            hexlify(extension),
                            20,
                          )}`,
                        );
                    }
                  } else if (isConcentratedKey(poolKey)) {
                    switch (extension) {
                      case 0n:
                        await addPool(
                          BasePool,
                          BasePoolState.fromQuoter(data),
                          initBlockNumber,
                          poolKey,
                        );
                        break;
                      case BigInt(MEV_CAPTURE_ADDRESS):
                        await addPool(
                          MevCapturePool,
                          BasePoolState.fromQuoter(data),
                          initBlockNumber,
                          poolKey,
                        );
                        break;
                      default:
                        throw new Error(
                          `Unknown pool extension ${hexZeroPad(
                            hexlify(extension),
                            20,
                          )}`,
                        );
                    }
                  } else {
                    throw new Error(
                      `Unknown pool key type config in pool key ${poolKey}`,
                    );
                  }
                } catch (err) {
                  this.logger.error(
                    `Failed to construct pool ${poolKey.stringId}: ${err}`,
                  );
                }
              }),
            );
          })
          .catch((err: any) => {
            this.logger.error(
              `Fetching batch failed. Pool keys: ${batch.map(
                ({ key }) => key.stringId,
              )}. Error: ${err}`,
            );
          }),
      );
    }

    promises.push(
      ...twammPoolKeys.map(async ({ key, initBlockNumber }) => {
        // The TWAMM data fetcher doesn't allow fetching state for multiple pools at once, so we just let `generateState` work to avoid duplicating logic
        try {
          await addPool<
            StableswapPoolTypeConfig,
            TwammPoolState.Object,
            TwammPool
          >(TwammPool, undefined, initBlockNumber, key);
        } catch (err) {
          this.logger.error(`Failed to construct pool ${key.stringId}: ${err}`);
        }
      }),
    );

    await Promise.all(promises);
  }

  public async getQuotePools(
    tokenA: Token,
    tokenB: Token,
    limitPools: string[] | undefined,
  ): Promise<Iterable<IEkuboPool<PoolTypeConfig>>> {
    const [token0, token1] = convertAndSortTokens(tokenA, tokenB);

    let unfilteredPools: IteratorObject<IEkuboPool<PoolTypeConfig>>;
    if (typeof limitPools === 'undefined') {
      unfilteredPools = this.poolsByBI.values();
    } else {
      unfilteredPools = Iterator.from(
        limitPools.flatMap(stringId => {
          let pool = this.poolsByString.get(stringId);

          if (typeof pool === 'undefined') {
            this.logger.error(`Requested pool ${stringId} doesn't exist`);
            return [];
          }

          return [pool];
        }),
      );
    }

    return unfilteredPools.filter(
      pool => pool.key.token0 === token0 && pool.key.token1 === token1,
    );
  }

  public setPool(pool: IEkuboPool<PoolTypeConfig>) {
    const key = pool.key;

    this.poolsByBI.set(key.numId, pool);
    this.poolsByString.set(key.stringId, pool);
  }

  private deletePool(pool: IEkuboPool<PoolTypeConfig>) {
    const key = pool.key;

    this.poolsByBI.delete(key.numId);
    this.poolsByString.delete(key.stringId);
  }

  private clearPools() {
    this.poolsByBI.clear();
    this.poolsByString.clear();
  }

  private handlePoolInitialized(
    ev: Result,
    blockHeader: Readonly<BlockHeader>,
  ) {
    const poolKey = PoolKey.fromAbi(ev.poolKey);
    const { extension } = poolKey.config;
    const blockNumber = blockHeader.number;
    const state = {
      sqrtRatio: floatSqrtRatioToFixed(BigInt(ev.sqrtRatio)),
      tick: ev.tick,
      blockHeader,
    };

    const commonArgs = [
      this.parentName,
      this.dexHelper,
      this.logger,
      this.contracts,
      blockNumber,
    ] as const;

    const addPool = <C extends PoolTypeConfig, S, P extends EkuboPool<C, S>>(
      constructor: { new (...args: [...typeof commonArgs, PoolKey<C>]): P },
      poolKey: PoolKey<C>,
      initialState: DeepReadonly<S>,
    ): void => {
      const pool = new constructor(...commonArgs, poolKey);
      pool.isTracking = this.isTracking;
      pool.setState(initialState, blockNumber);
      this.setPool(pool);
    };

    if (isStableswapKey(poolKey)) {
      switch (extension) {
        case 0n:
          const fullRangeState =
            FullRangePoolState.fromPoolInitialization(state);
          return poolKey.config.poolTypeConfig.isFullRange()
            ? addPool(FullRangePool, poolKey, fullRangeState)
            : addPool(StableswapPool, poolKey, fullRangeState);
        case BigInt(ORACLE_ADDRESS):
          return addPool(
            OraclePool,
            poolKey,
            FullRangePoolState.fromPoolInitialization(state),
          );
        case BigInt(TWAMM_ADDRESS):
          return addPool(
            TwammPool,
            poolKey,
            TwammPoolState.fromPoolInitialization(state),
          );
        default:
          this.logger.debug(
            `Ignoring unknown pool extension ${hexZeroPad(
              hexlify(extension),
              20,
            )} for stableswap pool`,
          );
      }
    } else if (isConcentratedKey(poolKey)) {
      const basePoolState = BasePoolState.fromPoolInitialization(state);

      switch (extension) {
        case 0n:
          return addPool(BasePool, poolKey, basePoolState);
        case BigInt(MEV_CAPTURE_ADDRESS):
          return addPool(MevCapturePool, poolKey, basePoolState);
        default:
          this.logger.debug(
            `Ignoring unknown pool extension ${hexZeroPad(
              hexlify(extension),
              20,
            )} for concentrated pool`,
          );
      }
    } else {
      this.logger.error(`Unknown pool key type config in pool key ${poolKey}`);
    }
  }
}

function parsePoolIdByLogDataOffsetFn(
  offset: number,
): (data: string) => bigint {
  return data => BigInt(hexDataSlice(data, offset, offset + 32));
}
