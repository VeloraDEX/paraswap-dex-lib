import { defaultAbiCoder, Interface } from '@ethersproject/abi';
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
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, CACHE_PREFIX } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import {
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isTruthy,
} from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  DexParams,
  OutputResult,
  PoolState,
  UniswapV3Data,
  UniswapV3Functions,
  UniswapV3SimpleSwapParams,
} from '../uniswap-v3/types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { PancakeswapV3Config, Adapters } from './config';
import { PancakeSwapV3EventPool } from './pancakeswap-v3-pool';
import PancakeswapV3RouterABI from '../../abi/pancakeswap-v3/PancakeswapV3Router.abi.json';
import PancakeswapV3QuoterABI from '../../abi/pancakeswap-v3/PancakeswapV3Quoter.abi.json';
import UniswapV3MultiABI from '../../abi/uniswap-v3/UniswapMulti.abi.json';
import PancakeswapV3StateMulticallABI from '../../abi/pancakeswap-v3/PancakeV3StateMulticall.abi.json';
import {
  PANCAKESWAPV3_EFFICIENCY_FACTOR,
  PANCAKESWAPV3_TICK_BASE_OVERHEAD,
  PANCAKESWAPV3_POOL_SEARCH_OVERHEAD,
  PANCAKESWAPV3_TICK_GAS_COST,
} from './constants';
import { DeepReadonly } from 'ts-essentials';
import { pancakeswapV3Math } from './contract-math/pancakeswap-v3-math';
import { Contract } from 'web3-eth-contract';
import { AbiItem } from 'web3-utils';
import { BalanceRequest, getBalances } from '../../lib/tokens/balancer-fetcher';
import {
  AssetType,
  DEFAULT_ID_ERC20,
  DEFAULT_ID_ERC20_AS_STRING,
} from '../../lib/tokens/types';
import {
  OnPoolCreatedCallback,
  PancakeswapV3Factory,
} from './pancakeswap-v3-factory';
import { extractReturnAmountPosition } from '../../executor/utils';
import { uint256ToBigInt } from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';

type PoolPairsInfo = {
  token0: Address;
  token1: Address;
  fee: string;
};

const PoolsRegistryHashKey = `${CACHE_PREFIX}_poolsRegistry`;

const PANCAKESWAPV3_CLEAN_NOT_EXISTING_POOL_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const PANCAKESWAPV3_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS = 24 * 60 * 60 * 1000; // Once in a day
const PANCAKESWAPV3_QUOTE_GASLIMIT = 200_000;

export class PancakeswapV3
  extends SimpleExchange
  implements IDex<UniswapV3Data>
{
  private readonly factory: PancakeswapV3Factory;
  readonly isFeeOnTransferSupported: boolean = false;
  readonly eventPools: Record<string, PancakeSwapV3EventPool | null> = {};

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  intervalTask?: NodeJS.Timeout;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(
      _.pick(PancakeswapV3Config, [
        'PancakeswapV3',
        'DackieSwapV3',
        'SwapBasedV3',
      ]),
    );

  logger: Logger;

  private uniswapMulti: Contract;
  private stateMultiContract: Contract;

  private notExistingPoolSetKey: string;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly routerIface = new Interface(PancakeswapV3RouterABI),
    readonly quoterIface = new Interface(PancakeswapV3QuoterABI),
    protected config = PancakeswapV3Config[dexKey][network], // protected poolsToPreload = PoolsToPreload[dexKey][network] || [],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey + '-' + network);
    this.uniswapMulti = new this.dexHelper.web3Provider.eth.Contract(
      UniswapV3MultiABI as AbiItem[],
      this.config.uniswapMulticall,
    );
    this.stateMultiContract = new this.dexHelper.web3Provider.eth.Contract(
      PancakeswapV3StateMulticallABI as AbiItem[],
      this.config.stateMulticall,
    );

    // To receive revert reasons
    this.dexHelper.web3Provider.eth.handleRevert = false;

    // Normalise once all config addresses and use across all scenarios
    this.config = this._toLowerForAllConfigAddresses();

    this.notExistingPoolSetKey =
      `${CACHE_PREFIX}_${network}_${dexKey}_not_existings_pool_set`.toLowerCase();

    this.factory = new PancakeswapV3Factory(
      dexHelper,
      dexKey,
      this.config.factory,
      this.logger,
      this.onPoolCreatedDeleteFromNonExistingSet,
    );
  }

  get supportedFees() {
    return this.config.supportedFees;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  getPoolIdentifier(srcAddress: Address, destAddress: Address, fee: bigint) {
    const tokenAddresses = this._sortTokens(srcAddress, destAddress).join('_');
    return `${this.dexKey}_${tokenAddresses}_${fee}`;
  }

  async initializePricing(blockNumber: number) {
    // Init listening to new pools creation
    await this.factory.initialize(blockNumber);

    if (!this.dexHelper.config.isSlave) {
      const cleanExpiredNotExistingPoolsKeys = async () => {
        const maxTimestamp =
          Date.now() - PANCAKESWAPV3_CLEAN_NOT_EXISTING_POOL_TTL_MS;
        await this.dexHelper.cache.zremrangebyscore(
          this.notExistingPoolSetKey,
          0,
          maxTimestamp,
        );
      };

      void cleanExpiredNotExistingPoolsKeys();

      this.intervalTask = setInterval(
        cleanExpiredNotExistingPoolsKeys.bind(this),
        PANCAKESWAPV3_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS,
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
    fee,
  }) => {
    const logPrefix = '[onPoolCreatedDeleteFromNonExistingSet]';
    const [_token0, _token1] = this._sortTokens(token0, token1);
    const poolKey = `${_token0}_${_token1}_${fee}`;

    // consider doing it only from master pool for less calls to distant cache

    // delete entry locally to let local instance discover the pool
    delete this.eventPools[this.getPoolIdentifier(_token0, _token1, fee)];

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
    fee: bigint,
    blockNumber: number,
  ): Promise<PancakeSwapV3EventPool | null> {
    let pool = this.eventPools[
      this.getPoolIdentifier(srcAddress, destAddress, fee)
    ] as PancakeSwapV3EventPool | null | undefined;

    if (pool === null) return null;

    if (pool) {
      if (pool.isInactive()) {
        return null;
      } else if (!pool.initFailed) {
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

    const key = `${token0}_${token1}_${fee}`.toLowerCase();

    // no need to run this logic on retry initialisation scenario
    if (!pool) {
      const notExistingPoolScore = await this.dexHelper.cache.zscore(
        this.notExistingPoolSetKey,
        key,
      );

      const poolDoesNotExist = notExistingPoolScore !== null;

      if (poolDoesNotExist) {
        this.eventPools[this.getPoolIdentifier(srcAddress, destAddress, fee)] =
          null;
        return null;
      }
    }

    this.logger.trace(`starting to listen to new pool: ${key}`);
    pool =
      pool ||
      new PancakeSwapV3EventPool(
        this.dexHelper,
        this.dexKey,
        this.stateMultiContract,
        this.erc20Interface,
        this.config.factory,
        fee,
        token0,
        token1,
        this.logger,
        this.cacheStateKey,
        this.config.initHash,
        this.config.deployer,
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
      if (
        e instanceof Error &&
        (e.message.endsWith('Pool does not exist') ||
          e.message.endsWith('Pool is inactive'))
      ) {
        if (e.message.endsWith('Pool is inactive')) {
          this.logger.info(
            `${this.dexKey}: Adding inactive pool ${pool.poolAddress} to "notExistingPoolSet": srcAddress=${srcAddress}, destAddress=${destAddress}, fee=${fee}`,
          );
        }
        // no need to await we want the set to have the pool key but it's not blocking
        void this.dexHelper.cache.zadd(
          this.notExistingPoolSetKey,
          [Date.now(), key],
          'NX',
        );

        // prevent more requests for this pool
        pool = null;
        this.logger.trace(
          `${this.dexHelper}: ${e.message}: srcAddress=${srcAddress}, destAddress=${destAddress}, fee=${fee}`,
          e,
        );
      } else {
        // on unkown error mark as failed and increase retryCount for retry init strategy
        // note: state would be null by default which allows to fallback
        this.logger.warn(
          `${this.dexKey}: Can not generate pool state for srcAddress=${srcAddress}, destAddress=${destAddress}, fee=${fee} pool fallback to rpc and retry every ${this.config.initRetryFrequency} times, initRetryAttemptCount=${pool.initRetryAttemptCount}`,
          e,
        );
        pool.initFailed = true;
      }
    }

    if (pool !== null) {
      const allEventPools = Object.values(this.eventPools);
      // if pool was created, delete pool record from non existing set
      this.dexHelper.cache
        .zrem(this.notExistingPoolSetKey, [key])
        .catch(() => {});
      this.logger.info(
        `starting to listen to new non-null pool: ${key}. Already following ${allEventPools
          // Not that I like this reduce, but since it is done only on initialization, expect this to be ok
          .reduce(
            (acc, curr) => (curr !== null ? ++acc : acc),
            0,
          )} non-null pools or ${allEventPools.length} total pools`,
      );
    }

    this.eventPools[this.getPoolIdentifier(srcAddress, destAddress, fee)] =
      pool;
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
        this.supportedFees.map(async fee =>
          this.getPool(_srcAddress, _destAddress, fee, blockNumber),
        ),
      )
    ).filter(pool => pool);

    if (pools.length === 0) return [];

    return pools.map(pool =>
      this.getPoolIdentifier(_srcAddress, _destAddress, pool!.feeCode),
    );
  }

  async getPricingFromRpc(
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    pools: PancakeSwapV3EventPool[],
  ): Promise<ExchangePrices<UniswapV3Data> | null> {
    if (pools.length === 0) {
      return null;
    }
    this.logger.warn(`fallback to rpc for ${pools.length} pool(s)`);

    const requests = pools.map<BalanceRequest>(
      pool => ({
        owner: pool.poolAddress,
        asset: side == SwapSide.SELL ? from.address : to.address,
        assetType: AssetType.ERC20,
        ids: [
          {
            id: DEFAULT_ID_ERC20,
            spenders: [],
          },
        ],
      }),
      [],
    );

    const balances = await getBalances(this.dexHelper.multiWrapper, requests);

    pools = pools.filter((pool, index) => {
      const balance = balances[index].amounts[DEFAULT_ID_ERC20_AS_STRING];
      if (balance >= amounts[amounts.length - 1]) {
        return true;
      }
      this.logger.warn(
        `[${this.network}][${pool.parentName}] have no balance ${pool.poolAddress} ${from.address} ${to.address}. (Balance: ${balance})`,
      );
      return false;
    });

    pools.forEach(pool => {
      this.logger.warn(
        `[${this.network}][${pool.parentName}] fallback to rpc for ${pool.name}`,
      );
    });

    const unitVolume = getBigIntPow(
      (side === SwapSide.SELL ? from : to).decimals,
    );

    const chunks = amounts.length - 1;

    const _width = Math.floor(chunks / this.config.chunksCount);

    const _amounts = [unitVolume].concat(
      Array.from(Array(this.config.chunksCount).keys()).map(
        i => amounts[(i + 1) * _width],
      ),
    );

    const calldata = pools.map(pool =>
      _amounts.map(_amount => ({
        target: this.config.quoter,
        gasLimit: PANCAKESWAPV3_QUOTE_GASLIMIT,
        callData:
          side === SwapSide.SELL
            ? this.quoterIface.encodeFunctionData('quoteExactInputSingle', [
                [
                  from.address,
                  to.address,
                  _amount.toString(),
                  pool.feeCodeAsString,
                  0, //sqrtPriceLimitX96
                ],
              ])
            : this.quoterIface.encodeFunctionData('quoteExactOutputSingle', [
                [
                  from.address,
                  to.address,
                  _amount.toString(),
                  pool.feeCodeAsString,
                  0, //sqrtPriceLimitX96
                ],
              ]),
      })),
    );

    const data = await this.uniswapMulti.methods
      .multicall(calldata.flat())
      .call();

    const decode = (j: number): bigint => {
      if (!data.returnData[j].success) {
        return 0n;
      }
      const decoded = defaultAbiCoder.decode(
        ['uint256'],
        data.returnData[j].returnData,
      );
      return BigInt(decoded[0].toString());
    };

    let i = 0;
    const result = pools.map(pool => {
      const _rates = _amounts.map(() => decode(i++));
      const unit: bigint = _rates[0];

      const prices = interpolate(
        _amounts.slice(1),
        _rates.slice(1),
        amounts,
        side,
      );

      return {
        prices,
        unit,
        data: {
          path: [
            {
              tokenIn: from.address,
              tokenOut: to.address,
              fee: pool.feeCodeAsString,
            },
          ],
        },
        poolIdentifiers: [
          this.getPoolIdentifier(pool.token0, pool.token1, pool.feeCode),
        ],
        exchange: this.dexKey,
        gasCost: prices.map(p => (p === 0n ? 0 : PANCAKESWAPV3_QUOTE_GASLIMIT)),
        poolAddresses: [pool.poolAddress],
      };
    });

    return result;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<UniswapV3Data>> {
    try {
      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const [_srcAddress, _destAddress] = this._getLoweredAddresses(
        _srcToken,
        _destToken,
      );

      if (_srcAddress === _destAddress) return null;

      let selectedPools: PancakeSwapV3EventPool[] = [];

      if (!limitPools) {
        selectedPools = (
          await Promise.all(
            this.supportedFees.map(async fee => {
              const locallyFoundPool =
                this.eventPools[
                  this.getPoolIdentifier(_srcAddress, _destAddress, fee)
                ];
              if (locallyFoundPool) return locallyFoundPool;

              const newlyFetchedPool = await this.getPool(
                _srcAddress,
                _destAddress,
                fee,
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

              const [, srcAddress, destAddress, fee] = identifier.split('_');
              const newlyFetchedPool = await this.getPool(
                srcAddress,
                destAddress,
                BigInt(fee),
                blockNumber,
              );
              return newlyFetchedPool;
            }),
          )
        ).filter(isTruthy);
      }

      if (selectedPools.length === 0) return null;

      await Promise.all(
        selectedPools.map(pool => pool.checkState(blockNumber)),
      );

      const poolsToUse = selectedPools.reduce(
        (acc, pool) => {
          let state = pool.getState(blockNumber);
          if (state === null) {
            this.logger.trace(
              `${this.dexKey}: State === null. Fallback to rpc ${pool.name}`,
            );
            acc.poolWithoutState.push(pool);
          } else {
            acc.poolWithState.push(pool);
          }
          return acc;
        },
        {
          poolWithState: [] as PancakeSwapV3EventPool[],
          poolWithoutState: [] as PancakeSwapV3EventPool[],
        },
      );

      poolsToUse.poolWithoutState.forEach(pool => {
        this.logger.warn(
          `PancakeV3: Pool ${pool.name} on ${this.dexKey} has no state. Fallback to rpc`,
        );
      });

      const rpcResultsPromise = this.getPricingFromRpc(
        _srcToken,
        _destToken,
        amounts,
        side,
        poolsToUse.poolWithoutState,
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

          if (!pricesResult) {
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
                  PANCAKESWAPV3_POOL_SEARCH_OVERHEAD +
                  PANCAKESWAPV3_TICK_BASE_OVERHEAD +
                  pricesResult.tickCounts[index] * PANCAKESWAPV3_TICK_GAS_COST
                );
              }
            }),
          ];
          return {
            unit: unitResult?.outputs[0] || 0n,
            prices,
            data: {
              path: [
                {
                  tokenIn: _srcAddress,
                  tokenOut: _destAddress,
                  fee: pool.feeCode.toString(),
                },
              ],
            },
            poolIdentifiers: [
              this.getPoolIdentifier(pool.token0, pool.token1, pool.feeCode),
            ],
            exchange: this.dexKey,
            gasCost: gasCost,
            poolAddresses: [pool.poolAddress],
          };
        }),
      );
      const rpcResults = await rpcResultsPromise;

      const notNullResult = result.filter(
        res => res !== null,
      ) as ExchangePrices<UniswapV3Data>;

      if (rpcResults) {
        rpcResults.forEach(r => {
          if (r) {
            notNullResult.push(r);
          }
        });
      }

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
    data: UniswapV3Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { path: rawPath } = data;
    const path = this._encodePath(rawPath, side);

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          path: 'bytes',
          deadline: 'uint256',
        },
      },
      {
        path,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(), // FIXME: more gas efficient to pass block.timestamp in adapter
      },
    );

    return {
      targetExchange: this.config.router,
      payload,
      networkFee: '0',
    };
  }

  getCalldataGasCost(poolPrices: PoolPrices<UniswapV3Data>): number | number[] {
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

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: UniswapV3Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapFunction =
      side === SwapSide.SELL
        ? UniswapV3Functions.exactInput
        : UniswapV3Functions.exactOutput;

    const path = this._encodePath(data.path, side);
    const swapFunctionParams: UniswapV3SimpleSwapParams =
      side === SwapSide.SELL
        ? {
            recipient: this.augustusAddress,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountIn: srcAmount,
            amountOutMinimum: destAmount,
            path,
          }
        : {
            recipient: this.augustusAddress,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountOut: destAmount,
            amountInMaximum: srcAmount,
            path,
          };
    const swapData = this.routerIface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.config.router,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: UniswapV3Data,
    side: SwapSide,
  ): DexExchangeParam {
    const swapFunction =
      side === SwapSide.SELL
        ? UniswapV3Functions.exactInput
        : UniswapV3Functions.exactOutput;

    const path = this._encodePath(data.path, side);

    const swapFunctionParams: UniswapV3SimpleSwapParams =
      side === SwapSide.SELL
        ? {
            recipient,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountIn: srcAmount,
            amountOutMinimum: destAmount,
            path,
          }
        : {
            recipient,
            deadline: getLocalDeadlineAsFriendlyPlaceholder(),
            amountOut: destAmount,
            amountInMaximum: srcAmount,
            path,
          };

    const exchangeData = this.routerIface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.router,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerIface,
              swapFunction,
              'amountOut',
            )
          : undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.config.subgraphURL) return [];

    const _tokenAddress = tokenAddress.toLowerCase();

    const res = await this._querySubgraph(
      `query ($token: Bytes!, $count: Int) {
                pools0: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token0: $token}) {
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
              pools1: pools(first: $count, orderBy: totalValueLockedUSD, orderDirection: desc, where: {token1: $token}) {
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

    const pools0: PoolLiquidity[] = _.map(res.pools0, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token1.id.toLowerCase(),
          decimals: parseInt(pool.token1.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.totalValueLockedUSD),
    }));

    const pools1: PoolLiquidity[] = _.map(res.pools1, pool => ({
      exchange: this.dexKey,
      address: pool.id.toLowerCase(),
      connectorTokens: [
        {
          address: pool.token0.id.toLowerCase(),
          decimals: parseInt(pool.token0.decimals),
        },
      ],
      liquidityUSD: parseFloat(pool.totalValueLockedUSD),
    }));

    const allPools = pools0.concat(pools1);

    if (allPools.length === 0) {
      return [];
    }

    const poolBalances = await this._getPoolBalances(
      allPools.map(p => [
        p.address,
        tokenAddress,
        p.connectorTokens[0].address,
      ]),
    );

    const tokensAmounts = allPools
      .map((p, i) => {
        return [
          [tokenAddress, poolBalances[i][0]],
          [p.connectorTokens[0].address, poolBalances[i][1]],
        ] as [string, bigint | null][];
      })
      .flat();

    const poolUsdBalances = await this.dexHelper.getUsdTokenAmounts(
      tokensAmounts,
    );

    const pools = allPools.map((pool, i) => {
      const tokenUsdBalance = poolUsdBalances[i * 2];
      const connectorTokenUsdBalance = poolUsdBalances[i * 2 + 1];

      let tokenUsdLiquidity = null;

      if (tokenUsdBalance) {
        tokenUsdLiquidity = tokenUsdBalance * PANCAKESWAPV3_EFFICIENCY_FACTOR;
      }

      let connectorTokenUsdLiquidity = null;

      if (connectorTokenUsdBalance) {
        connectorTokenUsdLiquidity =
          connectorTokenUsdBalance * PANCAKESWAPV3_EFFICIENCY_FACTOR;
      }

      // connectorToken.liquidityUSD should specify how much liquidity is available for connectorToken -> token swaps
      // it allows to handle unbalanced pools, when one token has much higher usd liquidity (e.g. 0xA7B3BCC6c88Da2856867d29F11c67C3A85634882)
      if (tokenUsdLiquidity) {
        // there's always only one connectorToken
        pool.connectorTokens[0] = {
          ...pool.connectorTokens[0],
          liquidityUSD: tokenUsdLiquidity,
        };
      }

      // the amount of connectorToken liquidity is the amount available for token -> connectorToken swaps
      // take connectorTokenUsdLiquidity by default, in case there's no usd prices fallback to tokenUsdLiquidity
      const liquidityUSD = connectorTokenUsdLiquidity || tokenUsdLiquidity || 0;

      return {
        ...pool,
        liquidityUSD,
      };
    });

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  private async _getPoolBalances(
    pools: [pool: string, token0: string, token1: string][],
  ): Promise<[balanceToken0: bigint | null, balanceToken1: bigint | null][]> {
    const callData: MultiCallParams<bigint>[] = pools
      .map(pool => [
        {
          target: pool[1],
          callData: this.erc20Interface.encodeFunctionData('balanceOf', [
            pool[0],
          ]),
          decodeFunction: uint256ToBigInt,
        },
        {
          target: pool[2],
          callData: this.erc20Interface.encodeFunctionData('balanceOf', [
            pool[0],
          ]),
          decodeFunction: uint256ToBigInt,
        },
      ])
      .flat();

    const balanceOfCalls =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(false, callData);

    const balances: [bigint | null, bigint | null][] = [];
    for (let i = 0; i < balanceOfCalls.length; i += 2) {
      const balanceToken0 = balanceOfCalls[i];
      const balanceToken1 = balanceOfCalls[i + 1];
      balances.push([
        balanceToken0.success ? balanceToken0.returnData : null,
        balanceToken1.success ? balanceToken1.returnData : null,
      ]);
    }
    return balances;
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
      router: this.config.router.toLowerCase(),
      quoter: this.config.quoter.toLowerCase(),
      factory: this.config.factory.toLowerCase(),
      supportedFees: this.config.supportedFees,
      stateMulticall: this.config.stateMulticall.toLowerCase(),
      chunksCount: this.config.chunksCount,
      initRetryFrequency: this.config.initRetryFrequency,
      uniswapMulticall: this.config.uniswapMulticall,
      deployer: this.config.deployer?.toLowerCase(),
      initHash: this.config.initHash,
      subgraphURL: this.config.subgraphURL,
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
      const outputsResult = pancakeswapV3Math.queryOutputs(
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
    if (!this.config.subgraphURL) return [];

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
