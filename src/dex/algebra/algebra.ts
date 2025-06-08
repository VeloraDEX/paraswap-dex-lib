import { DeepReadonly } from 'ts-essentials';
import { AbiItem } from 'web3-utils';
import _ from 'lodash';
import {
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  Logger,
  TransferFeeParams,
  Address,
  PoolLiquidity,
  Token,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { SwapSide, Network, CACHE_PREFIX } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import {
  _require,
  getBigIntPow,
  getDexKeysWithNetwork,
  interpolate,
  isDestTokenTransferFeeToBeExchanged,
  isSrcTokenTransferFeeToBeExchanged,
} from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  AlgebraData,
  AlgebraFunctions,
  DexParams,
  IAlgebraPoolState,
} from './types';
import {
  SimpleExchange,
  getLocalDeadlineAsFriendlyPlaceholder,
} from '../simple-exchange';
import { AlgebraConfig, Adapters } from './config';
import { Contract } from 'web3-eth-contract';
import { AbiCoder, Interface, solidityPacked } from 'ethers';
import SwapRouter from '../../abi/algebra/SwapRouter.json';
import AlgebraQuoterABI from '../../abi/algebra/AlgebraQuoter.abi.json';
import UniswapV3MultiABI from '../../abi/uniswap-v3/UniswapMulti.abi.json';
import AlgebraStateMulticallABI from '../../abi/algebra/AlgebraStateMulticall.abi.json';
import { OutputResult } from '../uniswap-v3/types';
import { AlgebraMath } from './lib/AlgebraMath';
import { AlgebraEventPoolV1_1 } from './algebra-pool-v1_1';
import { AlgebraEventPoolV1_9 } from './algebra-pool-v1_9';
import { AlgebraFactory, OnPoolCreatedCallback } from './algebra-factory';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import { AlgebraEventPoolV1_9_bidirectional_fee } from './algebra-pool-v1_9_bidirectional_fee';
import { extractReturnAmountPosition } from '../../executor/utils';

type PoolPairsInfo = {
  token0: Address;
  token1: Address;
};

const PoolsRegistryHashKey = `${CACHE_PREFIX}_poolsRegistry`;

const ALGEBRA_CLEAN_NOT_EXISTING_POOL_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const ALGEBRA_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS = 24 * 60 * 60 * 1000; // Once in a day
const ALGEBRA_EFFICIENCY_FACTOR = 3;
const ALGEBRA_TICK_GAS_COST = 24_000; // Ceiled
const ALGEBRA_TICK_BASE_OVERHEAD = 75_000;
const ALGEBRA_POOL_SEARCH_OVERHEAD = 10_000;
const ALGEBRA_QUOTE_GASLIMIT = 2_000_000;

type IAlgebraEventPool =
  | AlgebraEventPoolV1_1
  | AlgebraEventPoolV1_9
  | AlgebraEventPoolV1_9_bidirectional_fee;

export class Algebra extends SimpleExchange implements IDex<AlgebraData> {
  private readonly factory: AlgebraFactory;
  readonly isFeeOnTransferSupported: boolean = true;
  protected eventPools: Record<string, IAlgebraEventPool | null> = {};

  private newlyCreatedPoolKeys: Set<string> = new Set();

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  intervalTask?: NodeJS.Timeout;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AlgebraConfig);

  logger: Logger;

  private uniswapMulti: Contract;
  private stateMultiContract: Contract;

  private notExistingPoolSetKey: string;

  private AlgebraPoolImplem:
    | typeof AlgebraEventPoolV1_1
    | typeof AlgebraEventPoolV1_9
    | typeof AlgebraEventPoolV1_9_bidirectional_fee;

  readonly SRC_TOKEN_DEX_TRANSFERS = 1;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly routerIface = new Interface(SwapRouter),
    readonly quoterIface = new Interface(AlgebraQuoterABI),
    readonly config = AlgebraConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey + '-' + network);
    this.uniswapMulti = new this.dexHelper.web3Provider.eth.Contract(
      UniswapV3MultiABI as AbiItem[],
      this.config.uniswapMulticall,
    );
    this.stateMultiContract = new this.dexHelper.web3Provider.eth.Contract(
      AlgebraStateMulticallABI as AbiItem[],
      this.config.algebraStateMulticall,
    );

    this.dexHelper.web3Provider.eth.handleRevert = false;

    this.config = this._toLowerForAllConfigAddresses();
    // External configuration has priority over internal
    this.config.forceRPC = dexHelper.config.data.forceRpcFallbackDexs.includes(
      dexKey.toLowerCase(),
    );

    this.notExistingPoolSetKey =
      `${CACHE_PREFIX}_${network}_${dexKey}_not_existings_pool_set`.toLowerCase();

    this.AlgebraPoolImplem =
      config.version === 'v1.1'
        ? AlgebraEventPoolV1_1
        : config.version === 'v1.9-bidirectional-fee'
        ? AlgebraEventPoolV1_9_bidirectional_fee
        : AlgebraEventPoolV1_9;

    this.factory = new AlgebraFactory(
      dexHelper,
      dexKey,
      this.config.factory,
      this.logger,
      this.onPoolCreatedDeleteFromNonExistingSet,
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  getPoolIdentifier(srcAddress: Address, destAddress: Address) {
    const tokenAddresses = this._sortTokens(srcAddress, destAddress).join('_');
    return `${this.dexKey}_${tokenAddresses}`;
  }

  async initializePricing(blockNumber: number) {
    // Init listening to new pools creation
    await this.factory.initialize(blockNumber);

    if (!this.dexHelper.config.isSlave) {
      const cleanExpiredNotExistingPoolsKeys = async () => {
        const maxTimestamp =
          Date.now() - ALGEBRA_CLEAN_NOT_EXISTING_POOL_TTL_MS;
        await this.dexHelper.cache.zremrangebyscore(
          this.notExistingPoolSetKey,
          0,
          maxTimestamp,
        );
      };

      void cleanExpiredNotExistingPoolsKeys();

      this.intervalTask = setInterval(
        cleanExpiredNotExistingPoolsKeys.bind(this),
        ALGEBRA_CLEAN_NOT_EXISTING_POOL_INTERVAL_MS,
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
  }) => {
    const logPrefix = '[onPoolCreatedDeleteFromNonExistingSet]';
    const [_token0, _token1] = this._sortTokens(token0, token1);
    const poolKey = `${_token0}_${_token1}`.toLowerCase();

    this.newlyCreatedPoolKeys.add(poolKey);

    // consider doing it only from master pool for less calls to distant cache

    // delete entry locally to let local instance discover the pool
    delete this.eventPools[this.getPoolIdentifier(_token0, _token1)];

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
    blockNumber: number,
  ): Promise<IAlgebraEventPool | null> {
    let pool = this.eventPools[
      this.getPoolIdentifier(srcAddress, destAddress)
    ] as IAlgebraEventPool | null | undefined;

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

    const key = `${token0}_${token1}`.toLowerCase();

    // no need to run this logic on retry initialisation scenario
    if (!pool) {
      const notExistingPoolScore = await this.dexHelper.cache.zscore(
        this.notExistingPoolSetKey,
        key,
      );

      const poolDoesNotExist = notExistingPoolScore !== null;

      if (poolDoesNotExist) {
        this.eventPools[this.getPoolIdentifier(srcAddress, destAddress)] = null;
        return null;
      }
    }

    this.logger.trace(`starting to listen to new pool: ${key}`);
    pool =
      pool ||
      new this.AlgebraPoolImplem(
        this.dexHelper,
        this.dexKey,
        this.stateMultiContract,
        this.erc20Interface,
        this.config.factory,
        token0,
        token1,
        this.logger,
        this.cacheStateKey,
        this.config.initHash,
        this.config.deployer,
        this.config.forceManualStateGenerate,
      );

    try {
      await pool.initialize(blockNumber, {
        initCallback: state => {
          //really hacky, we need to push poolAddress so that we subscribeToLogs in StatefulEventSubscriber
          pool!.addressesSubscribed[0] = state.pool;
          pool!.poolAddress = state.pool;
          pool!.initFailed = false;
          pool!.initRetryAttemptCount = 0;
        },
      });

      if (this.newlyCreatedPoolKeys.has(key)) {
        this.newlyCreatedPoolKeys.delete(key);
      }
    } catch (e) {
      if (e instanceof Error && e.message.endsWith('Pool does not exist')) {
        /*
         protection against 2 race conditions
          1/ if pool.initialize() promise rejects after the Pool creation event got treated
          2/ if the rpc node we hit on the http request is lagging behind the one we got event from (websocket)
        */
        if (this.newlyCreatedPoolKeys.has(key)) {
          this.logger.warn(
            `[block=${blockNumber}][Pool=${key}] newly created pool failed to initialise, trying on next request`,
          );
        } else {
          this.logger.info(
            `[block=${blockNumber}][Pool=${key}] pool failed to initialize so it's marked as non existing`,
            e,
          );

          // no need to await we want the set to have the pool key but it's not blocking
          this.dexHelper.cache.zadd(
            this.notExistingPoolSetKey,
            [Date.now(), key],
            'NX',
          );

          // Pool does not exist for this pair, so we can set it to null
          // to prevent more requests for this pool
          pool = null;
        }
      } else {
        // on unknown error mark as failed and increase retryCount for retry init strategy
        // note: state would be null by default which allows to fallback
        this.logger.warn(
          `[block=${blockNumber}][Pool=${key}] Can not generate pool state for srcAddress=${srcAddress}, destAddress=${destAddress} pool fallback to rpc and retry every ${this.config.initRetryFrequency} times, initRetryAttemptCount=${pool.initRetryAttemptCount}`,
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

    this.eventPools[this.getPoolIdentifier(srcAddress, destAddress)] = pool;
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

    const pool = await this.getPool(_srcAddress, _destAddress, blockNumber);
    if (!pool) return [];
    return [this.getPoolIdentifier(_srcAddress, _destAddress)];
  }

  async getPricingFromRpc(
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    pool: IAlgebraEventPool,
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<ExchangePrices<AlgebraData> | null> {
    if (!this.config.forceRPC) {
      this.logger.warn(
        `fallback to rpc for ${from.address}_${to.address}_${pool.name}_${pool.poolAddress} pool(s)`,
      );
    }

    const _isSrcTokenTransferFeeToBeExchanged =
      isSrcTokenTransferFeeToBeExchanged(transferFees);
    const _isDestTokenTransferFeeToBeExchanged =
      isDestTokenTransferFeeToBeExchanged(transferFees);

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

    const _amountsWithFee = _isSrcTokenTransferFeeToBeExchanged
      ? applyTransferFee(
          _amounts,
          side,
          transferFees.srcDexFee,
          this.SRC_TOKEN_DEX_TRANSFERS,
        )
      : _amounts;

    const calldata = _amountsWithFee.map(_amount => ({
      target: this.config.quoter,
      gasLimit: ALGEBRA_QUOTE_GASLIMIT,
      callData:
        side === SwapSide.SELL
          ? this.quoterIface.encodeFunctionData('quoteExactInputSingle', [
              from.address,
              to.address,
              _amount.toString(),
              0, //sqrtPriceLimitX96
            ])
          : this.quoterIface.encodeFunctionData('quoteExactOutputSingle', [
              from.address,
              to.address,
              _amount.toString(),
              0, //sqrtPriceLimitX96
            ]),
    }));

    const data = await this.uniswapMulti.methods.multicall(calldata).call();

    let totalGasCost = 0;
    let totalSuccessFullSwaps = 0;
    const decode = (j: number): bigint => {
      const { success, gasUsed, returnData } = data.returnData[j];

      if (!success) {
        return 0n;
      }
      const decoded = AbiCoder.defaultAbiCoder().decode(
        ['uint256'],
        returnData,
      );
      totalGasCost += +gasUsed;
      totalSuccessFullSwaps++;

      return BigInt(decoded[0].toString());
    };

    const averageGasCost = !totalSuccessFullSwaps
      ? ALGEBRA_QUOTE_GASLIMIT
      : Math.round(totalGasCost / totalSuccessFullSwaps);

    let i = 0;
    const _rates = _amountsWithFee.map(() => decode(i++));

    const _ratesWithFee = _isDestTokenTransferFeeToBeExchanged
      ? applyTransferFee(
          _rates,
          side,
          transferFees.destDexFee,
          this.DEST_TOKEN_DEX_TRANSFERS,
        )
      : _rates;

    const unit: bigint = _ratesWithFee[0];

    const prices = interpolate(
      _amountsWithFee.slice(1),
      _ratesWithFee.slice(1),
      amounts,
      side,
    );

    return [
      {
        prices,
        unit,
        data: {
          feeOnTransfer: _isSrcTokenTransferFeeToBeExchanged,
          path: [
            {
              tokenIn: from.address,
              tokenOut: to.address,
            },
          ],
        },
        poolIdentifier: this.getPoolIdentifier(pool.token0, pool.token1),
        exchange: this.dexKey,
        gasCost: prices.map(p => (p === 0n ? 0 : averageGasCost)),
        poolAddresses: [pool.poolAddress],
      },
    ];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
  ): Promise<null | ExchangePrices<AlgebraData>> {
    try {
      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      const [_srcAddress, _destAddress] = this._getLoweredAddresses(
        _srcToken,
        _destToken,
      );

      const _isSrcTokenTransferFeeToBeExchanged =
        isSrcTokenTransferFeeToBeExchanged(transferFees);
      const _isDestTokenTransferFeeToBeExchanged =
        isDestTokenTransferFeeToBeExchanged(transferFees);

      if (_srcAddress === _destAddress) return null;

      if (
        !limitPools?.includes(this.getPoolIdentifier(_srcAddress, _destAddress))
      )
        return null;

      const pool = await this.getPool(_srcAddress, _destAddress, blockNumber);
      if (!pool) return null;

      if (_isSrcTokenTransferFeeToBeExchanged && side == SwapSide.BUY) {
        this.logger.error(
          `pool: ${pool.poolAddress} doesn't support buy for tax srcToken ${srcToken.address}`,
        );
        return null;
      }

      if (this.config.forceRPC) {
        const rpcPrice = await this.getPricingFromRpc(
          _srcToken,
          _destToken,
          amounts,
          side,
          pool,
          transferFees,
        );

        return rpcPrice;
      }

      let state = pool.getState(blockNumber);

      if (state === null) {
        const rpcPrice = await this.getPricingFromRpc(
          _srcToken,
          _destToken,
          amounts,
          side,
          pool,
          transferFees,
        );

        return rpcPrice;
      }

      if (!state) return null;

      const unitAmount = getBigIntPow(
        side == SwapSide.SELL ? _srcToken.decimals : _destToken.decimals,
      );

      const _amounts = [...amounts.slice(1)];

      const [token0] = this._sortTokens(_srcAddress, _destAddress);

      const zeroForOne = token0 === _srcAddress ? true : false;

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

      const [unitAmountWithFee, ...amountsWithFee] =
        _isSrcTokenTransferFeeToBeExchanged
          ? applyTransferFee(
              [unitAmount, ..._amounts],
              side,
              transferFees.srcDexFee,
              this.SRC_TOKEN_DEX_TRANSFERS,
            )
          : [unitAmount, ..._amounts];

      const unitResult = this._getOutputs(
        state,
        [unitAmountWithFee],
        zeroForOne,
        side,
        balanceDestToken,
      );
      const pricesResult = this._getOutputs(
        state,
        amountsWithFee,
        zeroForOne,
        side,
        balanceDestToken,
      );

      if (!unitResult || !pricesResult) {
        this.logger.debug('Prices or unit is not calculated');
        return null;
      }

      const [unitResultWithFee, ...pricesResultWithFee] =
        _isDestTokenTransferFeeToBeExchanged
          ? applyTransferFee(
              [unitResult.outputs[0], ...pricesResult.outputs],
              side,
              transferFees.destDexFee,
              this.DEST_TOKEN_DEX_TRANSFERS,
            )
          : [unitResult.outputs[0], ...pricesResult.outputs];

      const prices = [0n, ...pricesResultWithFee];
      const gasCost = [
        0,
        ...pricesResultWithFee.map((p, index) => {
          if (p == 0n) {
            return 0;
          } else {
            return (
              ALGEBRA_POOL_SEARCH_OVERHEAD +
              ALGEBRA_TICK_BASE_OVERHEAD +
              pricesResult.tickCounts[index] * ALGEBRA_TICK_GAS_COST
            );
          }
        }),
      ];

      return [
        {
          unit: unitResultWithFee,
          prices,
          data: {
            feeOnTransfer: _isSrcTokenTransferFeeToBeExchanged,
            path: [
              {
                tokenIn: _srcAddress,
                tokenOut: _destAddress,
              },
            ],
          },
          poolIdentifier: this.getPoolIdentifier(pool.token0, pool.token1),
          exchange: this.dexKey,
          gasCost: gasCost,
          poolAddresses: [pool.poolAddress],
        },
      ];
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
    data: AlgebraData,
    side: SwapSide,
  ): AdapterExchangeParam {
    let path = this._encodePath(data.path, side);

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          path: 'bytes',
          deadline: 'uint256',
          feeOnTransfer: 'bool',
        },
      },
      {
        path,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(), // FIXME: more gas efficient to pass block.timestamp in adapter
        feeOnTransfer: data.feeOnTransfer,
      },
    );

    return {
      targetExchange: this.config.router,
      payload,
      networkFee: '0',
    };
  }

  getCalldataGasCost(poolPrices: PoolPrices<AlgebraData>): number | number[] {
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
    data: AlgebraData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    let swapFunction;
    let swapParams;

    if (data.feeOnTransfer) {
      _require(
        data.path.length === 1,
        `LOGIC ERROR: multihop is not supported for feeOnTransfer token, passed: ${data.path
          .map(p => `${p?.tokenIn}->${p?.tokenOut}`)
          .join(' ')}`,
      );
      swapFunction = AlgebraFunctions.exactInputWithFeeToken;
      swapParams = {
        limitSqrtPrice: '0',
        recipient: this.augustusAddress,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(),
        amountIn: srcAmount,
        amountOutMinimum: destAmount,
        tokenIn: data.path[0].tokenIn,
        tokenOut: data.path[0].tokenOut,
      };
    } else {
      swapFunction =
        side === SwapSide.SELL
          ? AlgebraFunctions.exactInput
          : AlgebraFunctions.exactOutput;
      const path = this._encodePath(data.path, side);
      swapParams =
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
    }

    const swapData = this.routerIface.encodeFunctionData(swapFunction, [
      swapParams,
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
    data: AlgebraData,
    side: SwapSide,
  ): DexExchangeParam {
    let swapFunction;
    let swapFunctionParams;

    if (data.feeOnTransfer) {
      _require(
        data.path.length === 1,
        `LOGIC ERROR: multihop is not supported for feeOnTransfer token, passed: ${data.path
          .map(p => `${p?.tokenIn}->${p?.tokenOut}`)
          .join(' ')}`,
      );
      swapFunction = AlgebraFunctions.exactInputWithFeeToken;
      swapFunctionParams = {
        limitSqrtPrice: '0',
        recipient: recipient,
        deadline: getLocalDeadlineAsFriendlyPlaceholder(),
        amountIn: srcAmount,
        amountOutMinimum: destAmount,
        tokenIn: data.path[0].tokenIn,
        tokenOut: data.path[0].tokenOut,
      };
    } else {
      swapFunction =
        side === SwapSide.SELL
          ? AlgebraFunctions.exactInput
          : AlgebraFunctions.exactOutput;
      const path = this._encodePath(data.path, side);
      swapFunctionParams =
        side === SwapSide.SELL
          ? {
              recipient: recipient,
              deadline: getLocalDeadlineAsFriendlyPlaceholder(),
              amountIn: srcAmount,
              amountOutMinimum: destAmount,
              path,
            }
          : {
              recipient: recipient,
              deadline: getLocalDeadlineAsFriendlyPlaceholder(),
              amountOut: destAmount,
              amountInMaximum: srcAmount,
              path,
            };
    }

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
        parseFloat(pool.totalValueLockedUSD) * ALGEBRA_EFFICIENCY_FACTOR,
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
        parseFloat(pool.totalValueLockedUSD) * ALGEBRA_EFFICIENCY_FACTOR,
    }));

    const pools = _.slice(
      _.sortBy(_.concat(pools0, pools1), [pool => -1 * pool.liquidityUSD]),
      0,
      limit,
    );
    return pools;
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
      algebraStateMulticall: this.config.algebraStateMulticall.toLowerCase(),
      chunksCount: this.config.chunksCount,
      initRetryFrequency: this.config.initRetryFrequency,
      uniswapMulticall: this.config.uniswapMulticall,
      deployer: this.config.deployer?.toLowerCase(),
      initHash: this.config.initHash,
      subgraphURL: this.config.subgraphURL,
      version: this.config.version,
      forceRPC: this.config.forceRPC,
      forceManualStateGenerate: this.config.forceManualStateGenerate,
    };
    return newConfig;
  }

  private _getOutputs(
    state: DeepReadonly<IAlgebraPoolState>,
    amounts: bigint[],
    zeroForOne: boolean,
    side: SwapSide,
    destTokenBalance: bigint,
  ): OutputResult | null {
    try {
      const outputsResult = AlgebraMath.queryOutputs(
        this.network,
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
    }[],
    side: SwapSide,
  ): string {
    if (path.length === 0) {
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
            types: ['address', 'address'],
            _path: [curr.tokenIn, curr.tokenOut],
          };
        } else {
          return {
            types: [...types, 'address'],
            _path: [..._path, curr.tokenOut],
          };
        }
      },
      { _path: [], types: [] },
    );

    return side === SwapSide.BUY
      ? solidityPacked(types.reverse(), _path.reverse())
      : solidityPacked(types, _path);
  }

  releaseResources() {
    if (this.intervalTask !== undefined) {
      clearInterval(this.intervalTask);
      this.intervalTask = undefined;
    }
  }
}
