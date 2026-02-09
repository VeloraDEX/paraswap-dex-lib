import { Interface } from '@ethersproject/abi';
import _ from 'lodash';
import { pack } from '@ethersproject/solidity';
import {
  Token,
  Address,
  ExchangePrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  PoolPrices,
  PreprocessTransactionOptions,
  ExchangeTxInfo,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, CACHE_PREFIX } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork, isTruthy } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  DexParams,
  OutputResult,
  PoolState,
  SolidlyV3Data,
  SolidlyV3SimpleSwapParams,
  UniswapV3Param,
} from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { SolidlyV3Config, Adapters, PoolsToPreload } from './config';
import { SolidlyV3EventPool } from './solidly-v3-pool';
import DirectSwapABI from '../../abi/DirectSwap.json';
import SolidlyV3StateMulticallABI from '../../abi/solidly-v3/SolidlyV3StateMulticall.abi.json';
import SolidlyV3PoolABI from '../../abi/solidly-v3/SolidlyV3Pool.abi.json';
import {
  UNISWAPV3_EFFICIENCY_FACTOR,
  UNISWAPV3_POOL_SEARCH_OVERHEAD,
  UNISWAPV3_TICK_BASE_OVERHEAD,
  UNISWAPV3_TICK_GAS_COST,
} from './constants';
import { assert, DeepReadonly } from 'ts-essentials';
import { uniswapV3Math } from './contract-math/uniswap-v3-math';
import { Contract } from 'web3-eth-contract';
import { AbiItem } from 'web3-utils';
import { TickMath } from './contract-math/TickMath';
import { OnPoolCreatedCallback, SolidlyV3Factory } from './solidly-v3-factory';
import { SpecialDex } from '../../executor/types';

type PoolPairsInfo = {
  token0: Address;
  token1: Address;
  fee: string;
};

const PoolsRegistryHashKey = `${CACHE_PREFIX}_poolsRegistry`;

const UNISWAPV3_CLEAN_NOT_EXISTING_POOL_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days
const UNISWAPV3_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000; // Once in two days

export class SolidlyV3
  extends SimpleExchange
  implements IDex<SolidlyV3Data, UniswapV3Param>
{
  readonly isFeeOnTransferSupported: boolean = false;
  readonly eventPools: Record<string, SolidlyV3EventPool | null> = {};

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly directSwapIface = new Interface(DirectSwapABI);

  intervalTask?: NodeJS.Timeout;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(SolidlyV3Config, ['SolidlyV3']));

  logger: Logger;

  private stateMultiContract: Contract;

  private notExistingPoolSetKey: string;

  private readonly factory: SolidlyV3Factory;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly poolIface = new Interface(SolidlyV3PoolABI),
    protected config = SolidlyV3Config[dexKey][network],
    protected poolsToPreload = PoolsToPreload[dexKey]?.[network] || [],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey + '-' + network);
    this.stateMultiContract = new this.dexHelper.web3Provider.eth.Contract(
      this.config.stateMultiCallAbi !== undefined
        ? this.config.stateMultiCallAbi
        : (SolidlyV3StateMulticallABI as AbiItem[]),
      this.config.stateMulticall,
    );

    // To receive revert reasons
    this.dexHelper.web3Provider.eth.handleRevert = false;

    // Normalize once all config addresses and use across all scenarios
    this.config = this._toLowerForAllConfigAddresses();

    this.factory = new SolidlyV3Factory(
      dexHelper,
      dexKey,
      this.config.factory,
      this.logger,
      this.onPoolCreatedDeleteFromNonExistingSet,
    );

    this.notExistingPoolSetKey =
      `${CACHE_PREFIX}_${network}_${dexKey}_not_existings_pool_set`.toLowerCase();
  }

  get supportedTickSpacings() {
    return this.config.supportedTickSpacings;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  getPoolIdentifier(
    srcAddress: Address,
    destAddress: Address,
    tickSpacing: bigint,
  ) {
    const tokenAddresses = this._sortTokens(srcAddress, destAddress).join('_');
    return `${this.dexKey}_${tokenAddresses}_${tickSpacing}`;
  }

  async initializePricing(blockNumber: number) {
    // Init listening to new pools creation
    await this.factory.initialize(blockNumber);

    // This is only for testing, because cold pool fetching is goes out of
    // FETCH_POOL_INDENTIFIER_TIMEOUT range
    await Promise.all(
      this.poolsToPreload.map(async pool =>
        Promise.all(
          this.config.supportedTickSpacings.map(async tickSpacing =>
            this.getPool(pool.token0, pool.token1, tickSpacing, blockNumber),
          ),
        ),
      ),
    );

    if (!this.dexHelper.config.isSlave) {
      const cleanExpiredNotExistingPoolsKeys = async () => {
        const maxTimestamp =
          Date.now() - UNISWAPV3_CLEAN_NOT_EXISTING_POOL_TTL_MS;
        await this.dexHelper.cache.zremrangebyscore(
          this.notExistingPoolSetKey,
          0,
          maxTimestamp,
        );
      };

      void cleanExpiredNotExistingPoolsKeys();

      this.intervalTask = setInterval(
        cleanExpiredNotExistingPoolsKeys.bind(this),
        UNISWAPV3_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS,
      );
    }
  }

  /*
   * When a non existing pool is queried, it's blacklisted for an arbitrary long period in order to prevent issuing too many rpc calls
   * Once the pool is created, it gets immediately flagged
   */
  onPoolCreatedDeleteFromNonExistingSet: OnPoolCreatedCallback = async ({
    token0,
    token1,
    tickSpacing,
  }) => {
    const logPrefix = '[onPoolCreatedDeleteFromNonExistingSet]';
    const [_token0, _token1] = this._sortTokens(token0, token1);
    const poolKey = `${_token0}_${_token1}_${tickSpacing}`;

    // consider doing it only from master pool for less calls to distant cache

    // delete entry locally to let local instance discover the pool
    delete this.eventPools[
      this.getPoolIdentifier(_token0, _token1, tickSpacing)
    ];

    try {
      this.logger.info(
        `${logPrefix} delete pool from not existing set=${this.notExistingPoolSetKey}; key=${poolKey}`,
      );
      // delete pool record from set
      const result = await this.dexHelper.cache.zrem(
        this.notExistingPoolSetKey,
        [poolKey],
      );
      this.logger.info(
        `${logPrefix} delete pool from not existing set=${this.notExistingPoolSetKey}; key=${poolKey}; result: ${result}`,
      );
    } catch (error) {
      this.logger.error(
        `${logPrefix} ERROR: failed to delete pool from set: set=${this.notExistingPoolSetKey}; key=${poolKey}`,
        error,
      );
    }
  };

  async getPool(
    srcAddress: Address,
    destAddress: Address,
    tickSpacing: bigint,
    blockNumber: number,
  ): Promise<SolidlyV3EventPool | null> {
    let pool = this.eventPools[
      this.getPoolIdentifier(srcAddress, destAddress, tickSpacing)
    ] as SolidlyV3EventPool | null | undefined;

    if (pool === null) return null;

    if (pool) {
      if (!pool.initFailed) {
        return pool;
      } else {
        // if init failed then prefer to early return pool with empty state to fallback to rpc call
        if (
          ++pool.initRetryAttemptCount % this.config.initRetryFrequency !==
          0
        ) {
          return pool;
        }
        // else pursue with re-try initialization
      }
    }

    const [token0, token1] = this._sortTokens(srcAddress, destAddress);

    const key = `${token0}_${token1}_${tickSpacing}`.toLowerCase();

    if (!pool) {
      const notExistingPoolScore = await this.dexHelper.cache.zscore(
        this.notExistingPoolSetKey,
        key,
      );

      const poolDoesNotExist = notExistingPoolScore !== null;

      if (poolDoesNotExist) {
        this.eventPools[
          this.getPoolIdentifier(srcAddress, destAddress, tickSpacing)
        ] = null;
        return null;
      }
    }

    this.logger.trace(`starting to listen to new pool: ${key}`);
    pool =
      pool ||
      new SolidlyV3EventPool(
        this.dexHelper,
        this.dexKey,
        this.stateMultiContract,
        this.config.decodeStateMultiCallResultWithRelativeBitmaps,
        this.erc20Interface,
        this.config.factory,
        tickSpacing,
        token0,
        token1,
        this.logger,
        this.cacheStateKey,
        this.config.initHash,
      );

    try {
      await pool.initialize(blockNumber, {
        initCallback: (state: DeepReadonly<PoolState>) => {
          //really hacky, we need to push poolAddress so that we subscribeToLogs in StatefulEventSubscriber
          pool!.addressesSubscribed[0] = state.pool;
          pool!.poolAddress = state.pool;
          pool!.initFailed = false;
          pool!.initRetryAttemptCount = 0;
        },
      });
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('Pool does not exist')) {
        // no need to await we want the set to have the pool key but it's not blocking
        this.dexHelper.cache.zadd(
          this.notExistingPoolSetKey,
          [Date.now(), key],
          'NX',
        );

        // Pool does not exist for this feeCode, so we can set it to null
        // to prevent more requests for this pool
        pool = null;
        this.logger.trace(
          `${this.dexHelper}: Pool: srcAddress=${srcAddress}, destAddress=${destAddress}, fee=${tickSpacing} not found`,
          e,
        );
      } else {
        // on unknown error mark as failed and increase retryCount for retry init strategy
        // note: state would be null by default which allows to fallback
        this.logger.warn(
          `${this.dexKey}: Can not generate pool state for srcAddress=${srcAddress}, destAddress=${destAddress}, fee=${tickSpacing} pool fallback to rpc and retry every ${this.config.initRetryFrequency} times, initRetryAttemptCount=${pool.initRetryAttemptCount}`,
          e,
        );
        pool.initFailed = true;
      }
    }

    if (pool !== null) {
      const allEventPools = Object.values(this.eventPools);
      this.logger.info(
        `starting to listen to new non-null pool: ${key}. Already following ${allEventPools
          // Not that I like this reduce, but since it is done only on initialization, expect this to be ok
          .reduce(
            (acc, curr) => (curr !== null ? ++acc : acc),
            0,
          )} non-null pools or ${allEventPools.length} total pools`,
      );
    }

    this.eventPools[
      this.getPoolIdentifier(srcAddress, destAddress, tickSpacing)
    ] = pool;
    return pool;
  }

  async addMasterPool(poolKey: string, blockNumber: number): Promise<boolean> {
    const _pairs = await this.dexHelper.cache.hget(
      PoolsRegistryHashKey,
      `${this.cacheStateKey}_${poolKey}`,
    );
    if (!_pairs) {
      this.logger.warn(
        `did not find poolConfig in for key ${PoolsRegistryHashKey} ${this.cacheStateKey}_${poolKey}`,
      );
      return false;
    }

    const poolInfo: PoolPairsInfo = JSON.parse(_pairs);

    const pool = await this.getPool(
      poolInfo.token0,
      poolInfo.token1,
      BigInt(poolInfo.fee),
      blockNumber,
    );

    if (!pool) {
      return false;
    }

    return true;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = this._getLoweredAddresses(
      _srcToken,
      _destToken,
    );

    if (_srcAddress === _destAddress) return [];

    const pools = (
      await Promise.all(
        this.supportedTickSpacings.map(async tickSpacing =>
          this.getPool(_srcAddress, _destAddress, tickSpacing, blockNumber),
        ),
      )
    ).filter(pool => pool);

    if (pools.length === 0) return [];

    return pools.map(pool =>
      this.getPoolIdentifier(_srcAddress, _destAddress, pool!.tickSpacing),
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<SolidlyV3Data>> {
    try {
      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const [_srcAddress, _destAddress] = this._getLoweredAddresses(
        _srcToken,
        _destToken,
      );

      if (_srcAddress === _destAddress) return null;

      let selectedPools: SolidlyV3EventPool[] = [];

      if (!limitPools) {
        selectedPools = (
          await Promise.all(
            this.supportedTickSpacings.map(async tickSpacing => {
              const locallyFoundPool =
                this.eventPools[
                  this.getPoolIdentifier(_srcAddress, _destAddress, tickSpacing)
                ];
              if (locallyFoundPool) return locallyFoundPool;

              const newlyFetchedPool = await this.getPool(
                _srcAddress,
                _destAddress,
                tickSpacing,
                blockNumber,
              );
              return newlyFetchedPool;
            }),
          )
        ).filter(isTruthy);
      } else {
        const pairIdentifierWithoutFee = this.getPoolIdentifier(
          _srcAddress,
          _destAddress,
          0n,
          // Trim from 0 fee postfix, so it become comparable
        ).slice(0, -1);

        const poolIdentifiers = limitPools.filter(identifier =>
          identifier.startsWith(pairIdentifierWithoutFee),
        );

        selectedPools = (
          await Promise.all(
            poolIdentifiers.map(async identifier => {
              let locallyFoundPool = this.eventPools[identifier];
              if (locallyFoundPool) return locallyFoundPool;

              const [, srcAddress, destAddress, tickSpacing] =
                identifier.split('_');
              const newlyFetchedPool = await this.getPool(
                srcAddress,
                destAddress,
                BigInt(tickSpacing),
                blockNumber,
              );
              return newlyFetchedPool;
            }),
          )
        ).filter(isTruthy);
      }

      if (selectedPools.length === 0) return null;

      const poolsToUse = selectedPools.reduce(
        (acc, pool) => {
          let state = pool.getState(blockNumber);
          if (state === null) {
            throw new Error('Unable to retrieve pool state.');
          } else {
            acc.poolWithState.push(pool);
          }
          return acc;
        },
        {
          poolWithState: [] as SolidlyV3EventPool[],
          poolWithoutState: [] as SolidlyV3EventPool[],
        },
      );

      const states = poolsToUse.poolWithState.map(
        p => p.getState(blockNumber)!,
      );

      const unitAmount = getBigIntPow(
        side == SwapSide.SELL ? _srcToken.decimals : _destToken.decimals,
      );

      const _amounts = [...amounts.slice(1)];

      const [token0] = this._sortTokens(_srcAddress, _destAddress);

      const zeroForOne = token0 === _srcAddress ? true : false;

      const result = await Promise.all(
        poolsToUse.poolWithState.map(async (pool, i) => {
          const state = states[i];

          if (state.liquidity <= 0n) {
            if (state.liquidity < 0) {
              this.logger.error(
                `${this.dexKey}-${this.network}: ${pool.poolAddress} pool has negative liquidity: ${state.liquidity}. Find with key: ${pool.mapKey}`,
              );
            }
            this.logger.trace(`pool have 0 liquidity`);
            return null;
          }

          const balanceDestToken =
            _destAddress === pool.token0 ? state.balance0 : state.balance1;

          const unitResult = this._getOutputs(
            state,
            [unitAmount],
            zeroForOne,
            side,
            balanceDestToken,
          );
          const pricesResult = this._getOutputs(
            state,
            _amounts,
            zeroForOne,
            side,
            balanceDestToken,
          );

          if (!unitResult || !pricesResult) {
            this.logger.debug('Prices or unit is not calculated');
            return null;
          }

          const prices = [0n, ...pricesResult.outputs];
          const gasCost = [
            0,
            ...pricesResult.outputs.map((p, index) => {
              if (p == 0n) {
                return 0;
              } else {
                return (
                  UNISWAPV3_POOL_SEARCH_OVERHEAD +
                  UNISWAPV3_TICK_BASE_OVERHEAD +
                  pricesResult.tickCounts[index] * UNISWAPV3_TICK_GAS_COST
                );
              }
            }),
          ];
          return {
            unit: unitResult.outputs[0],
            prices,
            data: {
              zeroForOne,
              poolAddress: pool.poolAddress,
            },
            poolIdentifiers: [
              this.getPoolIdentifier(
                pool.token0,
                pool.token1,
                pool.tickSpacing,
              ),
            ],
            exchange: this.dexKey,
            gasCost: gasCost,
            poolAddresses: [pool.poolAddress],
          };
        }),
      );

      const notNullResult = result.filter(
        res => res !== null,
      ) as ExchangePrices<SolidlyV3Data>;

      return notNullResult;
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SolidlyV3Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const sqrtPriceLimitX96 = data.zeroForOne
      ? (TickMath.MIN_SQRT_RATIO + BigInt(1)).toString()
      : (TickMath.MAX_SQRT_RATIO - BigInt(1)).toString();

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          recipient: 'address',
          zeroForOne: 'bool',
          sqrtPriceLimitX96: 'uint160',
        },
      },
      {
        recipient: this.augustusAddress,
        zeroForOne: data.zeroForOne,
        sqrtPriceLimitX96,
      },
    );

    return {
      targetExchange: data.poolAddress,
      payload,
      networkFee: '0',
    };
  }

  getCalldataGasCost(poolPrices: PoolPrices<SolidlyV3Data>): number | number[] {
    const gasCost =
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> path header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // ParentStruct -> path (20+3+20 = 43 = 32+11 bytes)
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.FULL_WORD +
      CALLDATA_GAS_COST.wordNonZeroBytes(11);
    const arr = new Array(poolPrices.prices.length);
    poolPrices.prices.forEach((p, index) => {
      if (p == 0n) {
        arr[index] = 0;
      } else {
        arr[index] = gasCost;
      }
    });
    return arr;
  }

  getTokenFromAddress(address: Address): Token {
    // In this Dex decimals are not used
    return { address, decimals: 0 };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SolidlyV3Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapFunction = this.poolIface.getFunction(
      'swap(address,bool,int256,uint160)',
    );

    const swapFunctionParams: SolidlyV3SimpleSwapParams = {
      recipient: this.augustusAddress,
      zeroForOne: data.zeroForOne,
      amountSpecified:
        side === SwapSide.SELL
          ? srcAmount.toString()
          : (-destAmount).toString(),
      sqrtPriceLimitX96: data.zeroForOne
        ? (TickMath.MIN_SQRT_RATIO + BigInt(1)).toString()
        : (TickMath.MAX_SQRT_RATIO - BigInt(1)).toString(),
    };
    const swapData = this.poolIface.encodeFunctionData(swapFunction, [
      swapFunctionParams.recipient,
      swapFunctionParams.zeroForOne,
      swapFunctionParams.amountSpecified,
      swapFunctionParams.sqrtPriceLimitX96,
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.poolAddress,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SolidlyV3Data,
    side: SwapSide,
  ): DexExchangeParam {
    const swapFunction = this.poolIface.getFunction(
      'swap(address,bool,int256,uint160)',
    );

    const swapFunctionParams: SolidlyV3SimpleSwapParams = {
      recipient,
      zeroForOne: data.zeroForOne,
      amountSpecified:
        side === SwapSide.SELL
          ? srcAmount.toString()
          : (-destAmount).toString(),
      sqrtPriceLimitX96: data.zeroForOne
        ? (TickMath.MIN_SQRT_RATIO + BigInt(1)).toString()
        : (TickMath.MAX_SQRT_RATIO - BigInt(1)).toString(),
    };
    const swapData = this.poolIface.encodeFunctionData(swapFunction, [
      swapFunctionParams.recipient,
      swapFunctionParams.zeroForOne,
      swapFunctionParams.amountSpecified,
      swapFunctionParams.sqrtPriceLimitX96,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: data.poolAddress,
      returnAmountPos: undefined,
      ...(side === SwapSide.BUY
        ? {
            specialDexSupportsInsertFromAmount: true,
            specialDexFlag: SpecialDex.BUY_ON_SOLIDLY_V3,
          }
        : {}),
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = tokenAddress.toLowerCase();

    const res = await this._querySubgraph(
      `query ($token: Bytes!, $count: Int) {
                pools0: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token0: $token, liquidity_gt: "0"}) {
                id
                token0 {
                  id
                  decimals
                }
                token1 {
                  id
                  decimals
                }
                totalValueLockedUSD
              }
              pools1: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token1: $token, liquidity_gt: "0"}) {
                id
                token0 {
                  id
                  decimals
                }
                token1 {
                  id
                  decimals
                }
                totalValueLockedUSD
              }
            }`,
      {
        token: _tokenAddress,
        count: limit,
      },
    );

    if (!(res && res.pools0 && res.pools1)) {
      this.logger.error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );
      return [];
    }

    const pools0 = _.map(res.pools0, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD:
        parseFloat(pool.totalValueLockedUSD) * UNISWAPV3_EFFICIENCY_FACTOR,
    }));

    const pools1 = _.map(res.pools1, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD:
        parseFloat(pool.totalValueLockedUSD) * UNISWAPV3_EFFICIENCY_FACTOR,
    }));

    const pools = _.slice(
      _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
      0,
      limit,
    );
    return pools;
  }

  private async _getPoolsFromIdentifiers(
    poolIdentifiers: string[],
    blockNumber: number,
  ): Promise<SolidlyV3EventPool[]> {
    const pools = await Promise.all(
      poolIdentifiers.map(async identifier => {
        const [, srcAddress, destAddress, fee] = identifier.split('_');
        return this.getPool(srcAddress, destAddress, BigInt(fee), blockNumber);
      }),
    );
    return pools.filter(pool => pool) as SolidlyV3EventPool[];
  }

  private _getLoweredAddresses(srcToken: Token, destToken: Token) {
    return [srcToken.address.toLowerCase(), destToken.address.toLowerCase()];
  }

  private _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) => (a < b ? -1 : 1));
  }

  private _toLowerForAllConfigAddresses() {
    // If new config property will be added, the TS will throw compile error
    const newConfig: DexParams = {
      factory: this.config.factory.toLowerCase(),
      supportedTickSpacings: this.config.supportedTickSpacings,
      stateMulticall: this.config.stateMulticall.toLowerCase(),
      chunksCount: this.config.chunksCount,
      initRetryFrequency: this.config.initRetryFrequency,
      deployer: this.config.deployer?.toLowerCase(),
      initHash: this.config.initHash,
      subgraphURL: this.config.subgraphURL,
      stateMultiCallAbi: this.config.stateMultiCallAbi,
      decodeStateMultiCallResultWithRelativeBitmaps:
        this.config.decodeStateMultiCallResultWithRelativeBitmaps,
    };
    return newConfig;
  }

  private _getOutputs(
    state: DeepReadonly<PoolState>,
    amounts: bigint[],
    zeroForOne: boolean,
    side: SwapSide,
    destTokenBalance: bigint,
  ): OutputResult | null {
    try {
      const outputsResult = uniswapV3Math.queryOutputs(
        state,
        amounts,
        zeroForOne,
        side,
      );

      if (side === SwapSide.SELL) {
        if (outputsResult.outputs[0] > destTokenBalance) {
          return null;
        }

        for (let i = 0; i < outputsResult.outputs.length; i++) {
          if (outputsResult.outputs[i] > destTokenBalance) {
            outputsResult.outputs[i] = 0n;
            outputsResult.tickCounts[i] = 0;
          }
        }
      } else {
        if (amounts[0] > destTokenBalance) {
          return null;
        }

        // This may be improved by first checking outputs and requesting outputs
        // only for amounts that makes more sense, but I don't think this is really
        // important now
        for (let i = 0; i < amounts.length; i++) {
          if (amounts[i] > destTokenBalance) {
            outputsResult.outputs[i] = 0n;
            outputsResult.tickCounts[i] = 0;
          }
        }
      }

      return outputsResult;
    } catch (e) {
      this.logger.debug(
        `${this.dexKey}: received error in _getOutputs while calculating outputs`,
        e,
      );
      return null;
    }
  }

  private async _querySubgraph(
    query: string,
    variables: Object,
    timeout = 30000,
  ) {
    try {
      const res = await this.dexHelper.httpRequest.querySubgraph(
        this.config.subgraphURL,
        { query, variables },
        { timeout },
      );
      return res.data;
    } catch (e) {
      this.logger.error(`${this.dexKey}: can not query subgraph: `, e);
      return {};
    }
  }

  private _encodePath(
    path: {
      tokenIn: Address;
      tokenOut: Address;
      fee: NumberAsString;
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
      this.logger.error(
        `${this.dexKey}: Received invalid path=${path} for side=${side} to encode`,
      );
      return '0x';
    }

    const { _path, types } = path.reduce(
      (
        { _path, types }: { _path: string[]; types: string[] },
        curr,
        index,
      ): { _path: string[]; types: string[] } => {
        if (index === 0) {
          return {
            types: ['address', 'uint24', 'address'],
            _path: [curr.tokenIn, curr.fee, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'uint24', 'address'],
            _path: [..._path, curr.fee, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? pack(types.reverse(), _path.reverse())
      : pack(types, _path);
  }

  releaseResources() {
    if (this.intervalTask !== undefined) {
      clearInterval(this.intervalTask);
      this.intervalTask = undefined;
    }
  }
}
