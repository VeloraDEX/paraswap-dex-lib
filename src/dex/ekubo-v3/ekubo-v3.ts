import { Interface } from '@ethersproject/abi';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { ETHER_ADDRESS, Network, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Context, IDex } from '../idex';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  Token,
} from '../../types';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { SimpleExchange } from '../simple-exchange';
import { EKUBO_CONFIG } from './config';
import { BasePool, BasePoolState } from './pools/base';
import { BasicQuoteData, EkuboData } from './types';
import {
  convertParaSwapToEkubo,
  convertAndSortTokens,
  contractsFromDexParams,
  convertEkuboToParaSwap,
  bigintMax,
} from './utils';

import { BigNumber, Contract } from 'ethers';
import { hexlify, hexZeroPad } from 'ethers/lib/utils';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import RouterABI from '../../abi/ekubo-v3/mev-capture-router.json';
import { FullRangePool, FullRangePoolState } from './pools/full-range';
import { EkuboPool, IEkuboPool } from './pools/pool';
import { MIN_I256 } from './pools/math/constants';
import {
  MAX_SQRT_RATIO_FLOAT,
  MIN_SQRT_RATIO_FLOAT,
} from './pools/math/sqrt-ratio';
import { isPriceIncreasing } from './pools/math/swap';
import { OraclePool } from './pools/oracle';
import { TwammPool, TwammPoolState } from './pools/twamm';
import {
  ConcentratedPoolTypeConfig,
  EkuboPoolKey,
  PoolConfig,
  PoolKey,
  PoolTypeConfig,
  StableswapPoolTypeConfig,
  isConcentratedKey,
  isStableswapKey,
} from './pools/utils';
import { MevCapturePool } from './pools/mev-capture';
import { erc20Iface } from '../../lib/tokens/utils';
import { StableswapPool } from './pools/stableswap';

const assertUnreachable = (x: never): never => {
  throw new Error(`Unhandled case: ${x}`);
};

const SUBGRAPH_QUERY = `query InitializedPools($startBlock: BigInt!, $coreAddress: Bytes!, $extensions: [Bytes!]) {
  poolInitializeds(
    where: {blockNumber_gte: $startBlock, coreAddress: $coreAddress, extension_in: $extensions}, orderBy: blockNumber
  ) {
    blockNumber
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

const POOL_MAP_UPDATE_INTERVAL_MS = 1 * 60 * 1000;
const REORG_BACKFILL_BLOCKS = 12n;

// Ekubo Protocol https://ekubo.org/
export class EkuboV3 extends SimpleExchange implements IDex<EkuboData> {
  public readonly hasConstantPriceLargeAmounts = false;
  public readonly needWrapNative = false;
  public readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(EKUBO_CONFIG);

  private readonly pools: Map<string, IEkuboPool<PoolTypeConfig>> = new Map();

  public logger;

  public readonly config;

  public readonly routerIface;
  private readonly contracts;

  private interval?: NodeJS.Timeout;
  private lastInitializedEventBlock = 0n;

  // Caches the number of decimals for TVL computation purposes
  private readonly decimals: Record<string, AsyncOrSync<number | null>> = {
    [ETHER_ADDRESS]: 18,
  };

  public constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);

    this.logger = dexHelper.getLogger(dexKey);
    this.config = EKUBO_CONFIG[dexKey][network];

    this.contracts = contractsFromDexParams(this.config, dexHelper.provider);
    this.routerIface = new Interface(RouterABI);
  }

  public async initializePricing(blockNumber: number) {
    await this.updatePools(blockNumber, true);

    // Periodically schedules fetching pool keys from the subgraph and filling in details with the quote data fetcher
    this.interval = setInterval(
      async () =>
        this.updatePools(await this.dexHelper.provider.getBlockNumber(), true),
      POOL_MAP_UPDATE_INTERVAL_MS,
    );
  }

  private async updatePools(
    blockNumber: number,
    subscribe: boolean,
  ): Promise<void> {
    let poolKeys: EkuboPoolKey[] = [];
    try {
      poolKeys = await this.fetchRecentlyAddedPoolKeys();
    } catch (err) {
      this.logger.error(`Fetching pool keys from subgraph failed: ${err}`);

      if (subscribe) {
        return;
      }
    }

    const untrackedPoolKeys = poolKeys.filter(
      poolKey => !this.pools.has(poolKey.stringId),
    );

    const [twammPoolKeys, otherPoolKeys] = untrackedPoolKeys.reduce<
      [PoolKey<StableswapPoolTypeConfig>[], EkuboPoolKey[]]
    >(
      ([twammPoolKeys, otherPoolKeys], poolKey) => {
        if (poolKey.config.extension === BigInt(this.config.twamm)) {
          if (isStableswapKey(poolKey)) {
            twammPoolKeys.push(poolKey);
          } else {
            this.logger.error(
              `TWAMM pool key should be stableswap: ${poolKey}`,
            );
          }
        } else {
          otherPoolKeys.push(poolKey);
        }

        return [twammPoolKeys, otherPoolKeys];
      },
      [[], []],
    );

    const promises: Promise<void>[] = [];

    if (!subscribe) {
      promises.push(
        ...this.pools.values().map(pool =>
          pool.updateState(blockNumber).catch(err => {
            this.logger.error(
              `Updating state of pool ${pool.key.stringId} failed: ${err}`,
            );
          }),
        ),
      );
    }

    const commonArgs = [
      this.dexKey,
      this.dexHelper,
      this.logger,
      this.contracts,
    ] as const;

    const addPool = async <
      C extends PoolTypeConfig,
      S,
      P extends EkuboPool<C, S>,
    >(
      constructor: { new (...args: [...typeof commonArgs, PoolKey<C>]): P },
      initialState: DeepReadonly<S> | undefined,
      poolKey: PoolKey<C>,
    ): Promise<void> => {
      const pool = new constructor(...commonArgs, poolKey);

      if (subscribe) {
        await pool.initialize(blockNumber, { state: initialState });
      } else {
        pool.setState(
          initialState ?? (await pool.generateState(blockNumber)),
          blockNumber,
        );
      }

      this.pools.set(poolKey.stringId, pool);
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
            batch.map(poolKey => poolKey.toAbi()),
            MIN_BITMAPS_SEARCHED,
            {
              blockTag: blockNumber,
            },
          ) as Promise<BasicQuoteData[]>
        )
          .then(async fetchedData => {
            await Promise.all(
              fetchedData.map(async (data, i) => {
                const poolKey = otherPoolKeys[batchStart + i];
                const { extension } = poolKey.config;

                try {
                  switch (extension) {
                    case 0n: {
                      if (isStableswapKey(poolKey)) {
                        if (poolKey.config.poolTypeConfig.isFullRange()) {
                          await addPool(
                            FullRangePool,
                            FullRangePoolState.fromQuoter(data),
                            poolKey,
                          );
                        } else {
                          await addPool(
                            StableswapPool,
                            FullRangePoolState.fromQuoter(data),
                            poolKey,
                          );
                        }
                      } else if (isConcentratedKey(poolKey)) {
                        await addPool(
                          BasePool,
                          BasePoolState.fromQuoter(data),
                          poolKey,
                        );
                      } else {
                        assertUnreachable(poolKey);
                      }
                      break;
                    }
                    case BigInt(this.config.oracle): {
                      if (
                        !isStableswapKey(poolKey) ||
                        !poolKey.config.poolTypeConfig.isFullRange()
                      ) {
                        this.logger.error(
                          `Unexpected Oracle pool key ${poolKey}`,
                        );
                        break;
                      }

                      await addPool(
                        OraclePool,
                        FullRangePoolState.fromQuoter(data),
                        poolKey,
                      );
                      break;
                    }
                    case BigInt(this.config.mevCapture): {
                      if (!isConcentratedKey(poolKey)) {
                        this.logger.error(
                          `Unexpected MEV-capture pool key ${poolKey}`,
                        );
                        break;
                      }

                      await addPool(
                        MevCapturePool,
                        BasePoolState.fromQuoter(data),
                        poolKey,
                      );
                      break;
                    }
                    default:
                      throw new Error(
                        `Unknown pool extension ${hexZeroPad(
                          hexlify(extension),
                          20,
                        )}`,
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
                poolKey => poolKey.stringId,
              )}. Error: ${err}`,
            );
          }),
      );
    }

    promises.push(
      ...twammPoolKeys.map(async poolKey => {
        // The TWAMM data fetcher doesn't allow fetching state for multiple pools at once, so we just let `generateState` work to avoid duplicating logic
        try {
          await addPool<
            StableswapPoolTypeConfig,
            TwammPoolState.Object,
            TwammPool
          >(TwammPool, undefined, poolKey);
        } catch (err) {
          this.logger.error(
            `Failed to construct pool ${poolKey.stringId}: ${err}`,
          );
        }
      }),
    );

    await Promise.all(promises);
  }

  public async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    const [token0, token1] = convertAndSortTokens(srcToken, destToken);
    const stringIds = new Set(
      this.pools
        .entries()
        .filter(
          ([_, pool]) =>
            pool.key.token0 === token0 && pool.key.token1 === token1,
        )
        .map(([stringId, _]) => stringId),
    );

    return Array.from(stringIds);
  }

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<EkuboData>> {
    const pools = await this.getPools(
      srcToken,
      destToken,
      blockNumber,
      limitPools,
    );

    const isExactOut = side === SwapSide.BUY;

    const amountToken = isExactOut ? destToken : srcToken;
    const amountTokenAddress = convertParaSwapToEkubo(amountToken.address);
    const unitAmount = getBigIntPow(amountToken.decimals);

    const token1 = convertAndSortTokens(srcToken, destToken)[1];

    const exchangePrices = [];

    // eslint-disable-next-line no-restricted-syntax
    poolLoop: for (const pool of pools) {
      const poolId = pool.key.stringId;

      try {
        const quotes = [];
        const skipAheadMap: Record<string, number> = {};

        for (const amount of [unitAmount, ...amounts]) {
          const inputAmount = isExactOut ? -amount : amount;

          const quote = pool.quote(
            inputAmount,
            amountTokenAddress,
            blockNumber,
          );

          if (quote.consumedAmount !== inputAmount) {
            this.logger.debug(
              `Pool ${poolId} doesn't have enough liquidity to support swap of ${amount} ${
                amountToken.symbol ?? amountToken.address
              }`,
            );

            // There doesn't seem to be a way to skip just this one price.
            // Anyway, this pool is probably not the right one if it has such thin liquidity.
            continue poolLoop;
          }

          quotes.push(quote);
          skipAheadMap[amount.toString()] = quote.skipAhead;
        }

        const [unitQuote, ...otherQuotes] = quotes;

        exchangePrices.push({
          prices: otherQuotes.map(quote => quote.calculatedAmount),
          unit: unitQuote.calculatedAmount,
          data: {
            poolKeyAbi: pool.key.toAbi(),
            isToken1: amountTokenAddress === token1,
            skipAhead: skipAheadMap,
          },
          poolIdentifiers: [poolId],
          exchange: this.dexKey,
          gasCost: otherQuotes.map(quote => quote.gasConsumed),
        });
      } catch (err) {
        this.logger.error('Quote error:', err);
        continue;
      }
    }

    return exchangePrices;
  }

  public getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: EkuboData,
    side: SwapSide,
    _context: Context,
    _executorAddress: Address,
  ): DexExchangeParam {
    const amount = BigInt(side === SwapSide.BUY ? `-${destAmount}` : srcAmount);
    const amountStr = (
      side === SwapSide.SELL ? srcAmount : destAmount
    ).toString();

    return {
      needWrapNative: this.needWrapNative,
      exchangeData: this.routerIface.encodeFunctionData(
        'swap((address,address,bytes32),bool,int128,uint96,uint256,int256,address)',
        [
          data.poolKeyAbi,
          data.isToken1,
          BigNumber.from(amount),
          isPriceIncreasing(amount, data.isToken1)
            ? MAX_SQRT_RATIO_FLOAT
            : MIN_SQRT_RATIO_FLOAT,
          BigNumber.from(data.skipAhead[amountStr] ?? 0),
          MIN_I256,
          recipient,
        ],
      ),
      sendEthButSupportsInsertFromAmount: true,
      targetExchange: this.config.router,
      dexFuncHasRecipient: true,
      returnAmountPos: undefined,
    };
  }

  public async updatePoolState() {
    return this.updatePools(
      await this.dexHelper.provider.getBlockNumber(),
      false,
    );
  }

  public async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const poolsTokenTvls = (
      await Promise.all(
        this.pools.values().map(async pool => {
          try {
            const tokenPair = [
              convertEkuboToParaSwap(pool.key.token0),
              convertEkuboToParaSwap(pool.key.token1),
            ];

            if (!tokenPair.includes(tokenAddress)) {
              return null;
            }

            const tvls = pool.computeTvl();

            const [token0Tvl, token1Tvl] = await Promise.all(
              tokenPair.map(async (tokenAddress, i) => {
                const decimals = await this.getDecimals(tokenAddress);
                if (decimals === null) {
                  return null;
                }

                return {
                  tvl: tvls[i],
                  address: tokenAddress,
                  decimals,
                };
              }),
            );

            if (token0Tvl === null || token1Tvl === null) {
              return null;
            }

            return {
              pool,
              token0Tvl,
              token1Tvl,
            };
          } catch (err) {
            this.logger.error(
              `TVL computation for pool ${pool.key.stringId} failed: ${err}`,
            );
            return null;
          }
        }),
      )
    ).filter(res => res !== null);

    const usdTvls = await this.dexHelper.getUsdTokenAmounts(
      poolsTokenTvls.flatMap(({ token0Tvl, token1Tvl }) => [
        [token0Tvl.address, token0Tvl.tvl],
        [token1Tvl.address, token1Tvl.tvl],
      ]),
    );

    const poolLiquidities: PoolLiquidity[] = poolsTokenTvls.map(
      ({ token0Tvl, token1Tvl }, i) => {
        const [token0UsdTvl, token1UsdTvl] = usdTvls.slice(i * 2, i * 2 + 2);

        const [connector, thisLiquidityUSD, connectorLiquidityUsd] =
          token0Tvl.address === tokenAddress
            ? [token1Tvl, token0UsdTvl, token1UsdTvl]
            : [token0Tvl, token1UsdTvl, token0UsdTvl];

        return {
          exchange: this.dexKey,
          address: this.config.core,
          connectorTokens: [
            {
              address: connector.address,
              decimals: connector.decimals,
              liquidityUSD: connectorLiquidityUsd,
            },
          ],
          liquidityUSD: thisLiquidityUSD,
        };
      },
    );

    poolLiquidities
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .splice(limit, Infinity);

    return poolLiquidities;
  }

  public releaseResources(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async fetchRecentlyAddedPoolKeys(): Promise<EkuboPoolKey[]> {
    const res = await this.dexHelper.httpRequest.querySubgraph<{
      data: {
        poolInitializeds: {
          blockNumber: string;
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
      this.config.subgraphId,
      {
        query: SUBGRAPH_QUERY,
        variables: {
          // Query slightly before the last seen block to tolerate short reorgs
          startBlock: bigintMax(
            0n,
            this.lastInitializedEventBlock - REORG_BACKFILL_BLOCKS,
          ),
          coreAddress: this.config.core,
          extensions: [
            '0x0000000000000000000000000000000000000000',
            this.config.oracle,
            this.config.twamm,
            this.config.mevCapture,
          ],
        },
      },
      {},
    );

    const poolKeys = res.data.poolInitializeds.map(info => {
      if (info.tickSpacing !== null) {
        return new PoolKey(
          BigInt(info.token0),
          BigInt(info.token1),
          new PoolConfig(
            BigInt(info.extension),
            BigInt(info.fee),
            new ConcentratedPoolTypeConfig(info.tickSpacing),
          ),
          BigInt(info.poolId),
        );
      }

      if (
        info.stableswapAmplification !== null &&
        info.stableswapCenterTick !== null
      ) {
        return new PoolKey(
          BigInt(info.token0),
          BigInt(info.token1),
          new PoolConfig(
            BigInt(info.extension),
            BigInt(info.fee),
            new StableswapPoolTypeConfig(
              info.stableswapCenterTick,
              info.stableswapAmplification,
            ),
          ),
          BigInt(info.poolId),
        );
      }

      throw new Error(`Pool ${info.poolId} has unknown pool type config`);
    });

    this.lastInitializedEventBlock = res.data.poolInitializeds
      .map(info => BigInt(info.blockNumber))
      .reduce((max, bn) => bigintMax(max, bn), this.lastInitializedEventBlock);

    return poolKeys;
  }

  private getDecimals(erc20Token: string): AsyncOrSync<number | null> {
    const cached = this.decimals[erc20Token];
    if (typeof cached !== 'undefined') {
      return cached;
    }

    const call: Promise<number> = new Contract(
      erc20Token,
      erc20Iface,
      this.dexHelper.provider,
    ).decimals();

    const promise = call.catch((err: any) => {
      this.logger.error(
        'Failed to fetch decimals for token',
        erc20Token,
        'due to:',
        err,
      );
      return null;
    });

    this.decimals[erc20Token] = promise;

    return promise;
  }

  private async getPools(
    tokenA: Token,
    tokenB: Token,
    blockNumber: number,
    limitPools: string[] | undefined,
  ): Promise<Iterable<IEkuboPool<PoolTypeConfig>>> {
    const [token0, token1] = convertAndSortTokens(tokenA, tokenB);

    let unfilteredPools: IteratorObject<IEkuboPool<PoolTypeConfig>>;
    if (typeof limitPools === 'undefined') {
      unfilteredPools = this.pools.values();
    } else {
      const unfilteredPoolsArr: IEkuboPool<PoolTypeConfig>[] = [];

      await Promise.all(
        limitPools.map(async stringId => {
          let pool = this.pools.get(stringId);

          if (typeof pool === 'undefined') {
            try {
              pool = await this.initializeUntrackedPool(stringId, blockNumber);
            } catch (err) {
              this.logger.error(`Initializing pool ${stringId} failed: ${err}`);
              return;
            }
          }

          unfilteredPoolsArr.push(pool);
        }),
      );

      unfilteredPools = Iterator.from(unfilteredPoolsArr);
    }

    return unfilteredPools.filter(
      pool => pool.key.token0 === token0 && pool.key.token1 === token1,
    );
  }

  private async initializeUntrackedPool(
    stringId: string,
    blockNumber: number,
  ): Promise<IEkuboPool<PoolTypeConfig>> {
    const poolKey = PoolKey.fromStringId(stringId);
    const { extension } = poolKey.config;

    let pool;

    if (isStableswapKey(poolKey)) {
      const constructor = (() => {
        switch (extension) {
          case 0n:
            return poolKey.config.poolTypeConfig.isFullRange()
              ? FullRangePool
              : StableswapPool;
          case BigInt(this.config.oracle):
            return OraclePool;
          case BigInt(this.config.twamm):
            return TwammPool;
          default:
            throw new Error(
              `Unknown pool extension ${hexZeroPad(
                hexlify(extension),
                20,
              )} for stableswap pool`,
            );
        }
      })();

      pool = new constructor(
        this.dexKey,
        this.dexHelper,
        this.logger,
        this.contracts,
        poolKey,
      );
    } else if (isConcentratedKey(poolKey)) {
      const constructor = (() => {
        switch (extension) {
          case 0n:
            return BasePool;
          case BigInt(this.config.mevCapture):
            return MevCapturePool;
          default:
            throw new Error(
              `Unknown pool extension ${hexZeroPad(
                hexlify(extension),
                20,
              )} for concentrated pool`,
            );
        }
      })();

      pool = new constructor(
        this.dexKey,
        this.dexHelper,
        this.logger,
        this.contracts,
        poolKey,
      );
    } else {
      return assertUnreachable(poolKey);
    }

    await pool.initialize(blockNumber);
    this.pools.set(stringId, pool);

    return pool;
  }

  // LEGACY
  public getAdapters(
    _side: SwapSide,
  ): { name: string; index: number }[] | null {
    return null;
  }

  // LEGACY
  public getCalldataGasCost(
    _poolPrices: PoolPrices<EkuboData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // LEGACY
  public getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    _data: EkuboData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.dexKey,
      payload: '',
      networkFee: '0',
    };
  }
}
