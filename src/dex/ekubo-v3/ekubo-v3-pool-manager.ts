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
  BOOSTED_FEES_CONCENTRATED_ADDRESS,
  MEV_CAPTURE_ADDRESS,
  ORACLE_ADDRESS,
  TWAMM_ADDRESS,
} from './config';
import { FullRangePool, FullRangePoolState } from './pools/full-range';
import { StableswapPool } from './pools/stableswap';
import { ConcentratedPool, ConcentratedPoolState } from './pools/concentrated';
import { OraclePool } from './pools/oracle';
import { MevCapturePool } from './pools/mev-capture';
import { TwammPool, TwammPoolState } from './pools/twamm';
import { BoostedFeesPool, BoostedFeesPoolState } from './pools/boosted-fees';
import { ExtensionType, extensionType } from './extension-type';

const SUBGRAPH_PAGE_SIZE = 1000;
const SUBGRAPH_EXTENSIONS = [
  ORACLE_ADDRESS,
  TWAMM_ADDRESS,
  MEV_CAPTURE_ADDRESS,
  BOOSTED_FEES_CONCENTRATED_ADDRESS,
];
const SUBGRAPH_QUERY = `query ($lastId: Bytes!) {
  _meta {
    block {
      hash
      number
    }
  }
  poolInitializations(
    first: ${SUBGRAPH_PAGE_SIZE}
    where: {
      and: [
        {id_gte: $lastId}
        {or: [
          {extension_in: [${SUBGRAPH_EXTENSIONS.map(
            extension => `"${extension.toString()}"`,
          ).join()}]}
          {extension_lte: "0x1fffffffffffffffffffffffffffffffffffffff"}
          {extension_gte: "0x8000000000000000000000000000000000000000", extension_lte: "0x9fffffffffffffffffffffffffffffffffffffff"}
        ]}
      ]
    }
    orderBy: id
  ) {
    id
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
const SUBGRAPH_INITIAL_LAST_ID = '0x00000000000000000000000000000000';

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
      boostedFees: {
        contract: boostedFeesContract,
        interface: boostedFeesIface,
      },
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
      [boostedFeesContract.address]: new Map([
        ['', parsePoolIdByLogDataOffsetFn(0)],
        [
          boostedFeesIface.getEventTopic('PoolBoosted'),
          parsePoolIdByLogDataOffsetFn(0),
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
    poolKeysRes:
      | PoolKeyWithInitBlockNumber<
          StableswapPoolTypeConfig | ConcentratedPoolTypeConfig
        >[]
      | Error;
    subscribedBlockNumber: number | null;
  }> {
    let subscribedBlockNumber = null;

    type PoolInitialization = {
      id: string;
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
    };
    type SubgraphData = {
      _meta: {
        block: {
          hash: string;
          number: number;
        };
      };
      poolInitializations: PoolInitialization[];
    };

    const poolInitializations: PoolInitialization[] = [];
    let subgraphBlockNumber, subgraphBlockHash;
    let lastRowInfo: { id: string; blockHash: string | null } = {
      id: SUBGRAPH_INITIAL_LAST_ID,
      blockHash: null,
    };

    while (true) {
      let subgraphData;
      try {
        subgraphData = (
          await this.dexHelper.httpRequest.querySubgraph<{
            data: SubgraphData;
          }>(
            this.subgraphId,
            {
              query: SUBGRAPH_QUERY,
              variables: {
                lastId: lastRowInfo.id,
              },
            },
            {},
          )
        ).data;
      } catch (err) {
        return {
          poolKeysRes: new Error('Subgraph pool key retrieval failed', {
            cause: err,
          }),
          subscribedBlockNumber,
        };
      }

      const { _meta, poolInitializations: rawPage } = subgraphData;
      subgraphBlockNumber = _meta.block.number;
      subgraphBlockHash = _meta.block.hash;

      let page;

      if (lastRowInfo.blockHash !== null) {
        const firstRow = rawPage.at(0);

        if (
          typeof firstRow === 'undefined' ||
          firstRow.id !== lastRowInfo.id ||
          firstRow.blockHash !== lastRowInfo.blockHash
        ) {
          return {
            poolKeysRes: new Error('Subgraph cursor continuity check failed'),
            subscribedBlockNumber,
          };
        }

        page = rawPage.slice(1);
      } else {
        page = rawPage;
      }

      poolInitializations.push(...page);

      const lastElem = rawPage.at(SUBGRAPH_PAGE_SIZE - 1);
      if (typeof lastElem === 'undefined') {
        break;
      }

      lastRowInfo = {
        id: lastElem.id,
        blockHash: lastElem.blockHash,
      };
    }

    if (subscribeToBlockManager) {
      const blockNumber = Math.min(subgraphBlockNumber, maxBlockNumber);

      this.dexHelper.blockManager.subscribeToLogs(
        this,
        [
          this.contracts.core.contract.address,
          this.contracts.twamm.contract.address,
          this.contracts.boostedFees.contract.address,
        ],
        blockNumber,
      );

      subscribedBlockNumber = blockNumber;
    }

    // TODO there can now be events that are missed when the EventSubscriber (this instance) receives events for pools which should be initialized but aren't because the following reorg check fails
    // Just check the existence of the latest known block by hash in the canonical chain.
    // This, together with the pool manager being subscribed before this check, ensures that
    // we can consistently transition from the subgraph to the RPC state.
    try {
      await this.dexHelper.provider.getBlock(subgraphBlockHash);
    } catch (err) {
      return {
        poolKeysRes: new Error(
          'Failed to transition from subgraph to RPC state (possible reorg)',
          { cause: err },
        ),
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

    const poolKeys = poolInitializations.flatMap(info => {
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

    return {
      poolKeysRes: poolKeys,
      subscribedBlockNumber,
    };
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

      if (res.poolKeysRes instanceof Error) {
        this.logger.warn(
          'Subgraph pool key retrieval failed:',
          res.poolKeysRes,
        );
        await new Promise(resolve =>
          setTimeout(resolve, SUBGRAPH_RETRY_INTERVAL_MS),
        );
      } else {
        poolKeys = res.poolKeysRes;
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

    const [twammPoolKeys, boostedFeesPoolKeys, otherPoolKeys] = poolKeys.reduce<
      [
        PoolKeyWithInitBlockNumber<StableswapPoolTypeConfig>[],
        PoolKeyWithInitBlockNumber<ConcentratedPoolTypeConfig>[],
        PoolKeyWithInitBlockNumber<
          StableswapPoolTypeConfig | ConcentratedPoolTypeConfig
        >[],
      ]
    >(
      (
        [twammPoolKeys, boostedFeesPoolKeys, otherPoolKeys],
        poolKeyWithInitBlockNumber,
      ) => {
        switch (
          extensionType(poolKeyWithInitBlockNumber.key.config.extension)
        ) {
          case ExtensionType.Twamm:
            twammPoolKeys.push(
              poolKeyWithInitBlockNumber as PoolKeyWithInitBlockNumber<StableswapPoolTypeConfig>,
            );
            break;
          case ExtensionType.BoostedFeesConcentrated:
            boostedFeesPoolKeys.push(
              poolKeyWithInitBlockNumber as PoolKeyWithInitBlockNumber<ConcentratedPoolTypeConfig>,
            );
            break;
          case ExtensionType.NoSwapCallPoints:
          case ExtensionType.Oracle:
          case ExtensionType.MevCapture:
            otherPoolKeys.push(poolKeyWithInitBlockNumber);
            break;
          default:
            this.logger.debug(
              `Ignoring unknown pool extension ${hexZeroPad(
                hexlify(poolKeyWithInitBlockNumber.key.config.extension),
                20,
              )}`,
            );
        }

        return [twammPoolKeys, boostedFeesPoolKeys, otherPoolKeys];
      },
      [[], [], []],
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
                const { key: poolKey, initBlockNumber } = batch[i];
                const extType = extensionType(poolKey.config.extension);

                try {
                  if (isStableswapKey(poolKey)) {
                    switch (extType) {
                      case ExtensionType.NoSwapCallPoints:
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
                      case ExtensionType.Oracle:
                        await addPool(
                          OraclePool,
                          FullRangePoolState.fromQuoter(data),
                          initBlockNumber,
                          poolKey,
                        );
                        break;
                      default:
                        throw new Error(
                          `Unexpected extension type ${extType} for stableswap pool`,
                        );
                    }
                  } else if (isConcentratedKey(poolKey)) {
                    switch (extType) {
                      case ExtensionType.NoSwapCallPoints:
                        await addPool(
                          ConcentratedPool,
                          ConcentratedPoolState.fromQuoter(data),
                          initBlockNumber,
                          poolKey,
                        );
                        break;
                      case ExtensionType.MevCapture:
                        await addPool(
                          MevCapturePool,
                          ConcentratedPoolState.fromQuoter(data),
                          initBlockNumber,
                          poolKey,
                        );
                        break;
                      default:
                        throw new Error(
                          `Unexpected extension type ${extType} for concentrated pool`,
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

    promises.push(
      ...boostedFeesPoolKeys.map(async ({ key, initBlockNumber }) => {
        try {
          const [quoteData, boostedFeesData] = await Promise.all([
            this.contracts.core.quoteDataFetcher.getQuoteData(
              [key.toAbi()],
              MIN_BITMAPS_SEARCHED,
              { blockTag: blockNumber },
            ) as Promise<BasicQuoteData[]>,
            this.contracts.boostedFees.quoteDataFetcher.getPoolState(
              key.toAbi(),
              { blockTag: blockNumber },
            ),
          ]);

          await addPool(
            BoostedFeesPool,
            BoostedFeesPoolState.fromQuoter(quoteData[0], boostedFeesData),
            initBlockNumber,
            key,
          );
        } catch (err) {
          this.logger.error(`Failed to construct pool ${key.stringId}: ${err}`);
        }
      }),
    );

    await Promise.all(promises);
  }

  public getQuotePools(
    tokenA: Token,
    tokenB: Token,
    limitPools: string[] | undefined,
  ): Iterable<IEkuboPool<PoolTypeConfig>> {
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
      switch (extensionType(extension)) {
        case ExtensionType.NoSwapCallPoints:
          const fullRangeState =
            FullRangePoolState.fromPoolInitialization(state);
          return poolKey.config.poolTypeConfig.isFullRange()
            ? addPool(FullRangePool, poolKey, fullRangeState)
            : addPool(StableswapPool, poolKey, fullRangeState);
        case ExtensionType.Oracle:
          return addPool(
            OraclePool,
            poolKey,
            FullRangePoolState.fromPoolInitialization(state),
          );
        case ExtensionType.Twamm:
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
      const concentratedPoolState =
        ConcentratedPoolState.fromPoolInitialization(state);

      switch (extensionType(extension)) {
        case ExtensionType.NoSwapCallPoints:
          return addPool(ConcentratedPool, poolKey, concentratedPoolState);
        case ExtensionType.MevCapture:
          return addPool(MevCapturePool, poolKey, concentratedPoolState);
        case ExtensionType.BoostedFeesConcentrated:
          return addPool(
            BoostedFeesPool,
            poolKey,
            BoostedFeesPoolState.fromPoolInitialization(state),
          );
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
