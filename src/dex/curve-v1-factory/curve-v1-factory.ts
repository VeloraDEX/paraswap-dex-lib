import _ from 'lodash';
import { AbiItem } from 'web3-utils';
import {
  NumberAsString,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
  SwapSide,
} from '@paraswap/core';
import { assert, AsyncOrSync } from 'ts-essentials';
import { Interface, JsonFragment } from '@ethersproject/abi';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  ExchangeTxInfo,
  Logger,
  PoolLiquidity,
  PoolPrices,
  PreprocessTransactionOptions,
  SimpleExchangeParam,
  Token,
  TransferFeeParams,
  TxInfo,
} from '../../types';
import {
  Network,
  NULL_ADDRESS,
  SRC_TOKEN_PARASWAP_TRANSFERS,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import {
  getBigIntPow,
  getDexKeysWithNetwork,
  isETHAddress,
  isSrcTokenTransferFeeToBeExchanged,
  uuidToBytes16,
} from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  CurveRouterPoolType,
  CurveRouterSwapType,
  CurveSwapFunctions,
  CurveV1FactoryData,
  CurveV1FactoryDirectSwap,
  CurveV1FactoryIfaces,
  CurveV1RouterParam,
  CurveV1RouterSwapParam,
  CurveV1SwapType,
  CustomImplementationNames,
  DirectCurveV1FactoryParamV6,
  DirectCurveV1Param,
  FactoryImplementationNames,
  ImplementationNames,
  PoolConstants,
} from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { Adapters, CurveV1FactoryConfig } from './config';
import {
  DIRECT_METHOD_NAME,
  DIRECT_METHOD_NAME_V6,
  FACTORY_MAX_PLAIN_COINS,
  FACTORY_MAX_PLAIN_IMPLEMENTATIONS_FOR_COIN,
  MIN_AMOUNT_TO_RECEIVE,
  POOL_EXCHANGE_GAS_COST,
} from './constants';
import { CurveV1FactoryPoolManager } from './curve-v1-pool-manager';
import CurveABI from '../../abi/Curve.json';
import CurveV1RouterABI from '../../abi/curve-v1-factory/CurveV1Router.abi.json';
import DirectSwapABI from '../../abi/DirectSwap.json';
import FactoryCurveV1ABI from '../../abi/curve-v1-factory/FactoryCurveV1.json';
import ThreePoolABI from '../../abi/curve-v1-factory/ThreePool.json';
import ERC20ABI from '../../abi/erc20.json';
import {
  addressDecode,
  generalDecoder,
  uint256DecodeToNumber,
  uint8ToNumber,
} from '../../lib/decoders';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { BigNumber, BytesLike } from 'ethers';
import { FactoryStateHandler } from './state-polling-pools/factory-pool-polling';
import { PoolPollingBase } from './state-polling-pools/pool-polling-base';
import { CustomBasePoolForFactory } from './state-polling-pools/custom-pool-polling';
import ImplementationConstants from './price-handlers/functions/constants';
import { applyTransferFee } from '../../lib/token-transfer-fee';
import { PriceHandler } from './price-handlers/price-handler';
import { hexConcat, hexlify, hexZeroPad } from 'ethers/lib/utils';
import { packCurveData } from '../../lib/curve/encoder';
import { encodeCurveAssets } from '../curve-v1/packer';
import { extractReturnAmountPosition } from '../../executor/utils';

export const DefaultCoinsABI: AbiItem = {
  type: 'function',
  name: 'coins',
  inputs: [
    {
      name: '',
      type: 'uint256',
    },
  ],
  outputs: [
    {
      name: '',
      type: 'address',
    },
  ],
};

export class CurveV1Factory
  extends SimpleExchange
  implements
    IDex<CurveV1FactoryData, DirectCurveV1Param | CurveV1FactoryDirectSwap>
{
  readonly hasConstantPriceLargeAmounts = false;

  needWrapNative = (
    priceRoute: OptimalRate,
    swap: OptimalSwap,
    se: OptimalSwapExchange<any>,
  ) => {
    const swapSrc = swap.srcToken;
    const swapDest = swap.destToken;

    return this._needWrapNative(swapSrc, swapDest, se.data);
  };
  needWrapNativeForPricing = false;

  readonly isFeeOnTransferSupported = true;
  readonly isStatePollingDex = true;

  private factoryAddresses: string[];

  readonly poolManager: CurveV1FactoryPoolManager;
  readonly ifaces: CurveV1FactoryIfaces;

  private areFactoryPoolsFetched: boolean = false;
  private areCustomPoolsFetched: boolean = false;

  readonly SRC_TOKEN_DEX_TRANSFERS = 1;
  readonly DEST_TOKEN_DEX_TRANSFERS = 1;

  readonly directSwapIface = new Interface(DirectSwapABI);

  protected factoryImplementationsSupportBuySide = new Set<ImplementationNames>(
    [
      FactoryImplementationNames.FACTORY_PLAIN_2_CRV_EMA,
      FactoryImplementationNames.FACTORY_STABLE_NG,
    ],
  );

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(CurveV1FactoryConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    protected config = CurveV1FactoryConfig[dexKey][network],
    // This type is used to support different encoding for uint128 and uint256 args
    protected coinsTypeTemplate: AbiItem = DefaultCoinsABI,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(`${this.dexKey}-${this.network}`);
    this.factoryAddresses =
      this.config.factories?.map(e => e.address.toLowerCase()) || [];
    this.ifaces = {
      exchangeRouter: new Interface(CurveABI),
      curveV1Router: new Interface(CurveV1RouterABI),
      factory: new Interface(FactoryCurveV1ABI as JsonFragment[]),
      erc20: new Interface(ERC20ABI as JsonFragment[]),
      threePool: new Interface(ThreePoolABI as JsonFragment[]),
    };

    // I had to put this initialization into CurveV1 because I have to have access to mapping
    // from address to custom pool
    const allPriceHandlers = Object.values(
      this.config.factoryPoolImplementations,
    ).reduce<Record<string, PriceHandler>>((acc, curr) => {
      let baseImplementationName: ImplementationNames | undefined;
      if (curr.basePoolAddress) {
        const customBasePool = this.config.customPools[curr.basePoolAddress];
        if (customBasePool === undefined) {
          this.logger.error(
            `${this.dexKey} on ${this.dexHelper.config.data.network}: can not get customBasePool from basePoolAddress`,
          );
          return acc;
        } else {
          baseImplementationName = customBasePool.name;
        }
      }
      acc[curr.address] = new PriceHandler(
        this.logger,
        curr.name,
        baseImplementationName,
      );
      return acc;
    }, {});

    Object.values(this.config.customPools).reduce((acc, curr) => {
      if (curr.useForPricing) {
        acc[curr.address] = new PriceHandler(this.logger, curr.name);
      }

      return acc;
    }, allPriceHandlers);

    this.poolManager = new CurveV1FactoryPoolManager(
      this.dexKey,
      // should be the same as we use for FactoryStateHandler (4th param) and others
      this.cacheStateKey,
      dexHelper.getLogger(`${this.dexKey}-state-manager`),
      dexHelper,
      allPriceHandlers,
      // should be the same as we use for FactoryStateHandler (8th param) and others
      this.config.stateUpdatePeriodMs,
    );
  }

  private _needWrapNative(
    srcToken: Address,
    destToken: Address,
    data: CurveV1FactoryData,
  ): boolean {
    const wethAddress =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();

    const path = data.path;

    const tokenIn = data.path[0].tokenIn;
    const tokenOut = data.path[path.length - 1].tokenOut;

    let needWrapNative = false;
    if (
      (isETHAddress(srcToken) && tokenIn.toLowerCase() === wethAddress) ||
      (isETHAddress(destToken) && tokenOut.toLowerCase() === wethAddress)
    ) {
      needWrapNative = true;
    }

    return needWrapNative;
  }

  async initializePricing(blockNumber: number) {
    // This is only to start timer, each pool is initialized with updated state
    this.poolManager.initializePollingPools();
    await this.fetchFactoryPools(blockNumber);
    await this.poolManager.fetchLiquiditiesFromApi();
    await this.poolManager.updatePollingPoolsInBatch();
    this.logger.info(`${this.dexKey}: successfully initialized`);
  }

  async initializeCustomPollingPools(
    factoryAddresses: string[],
    blockNumber?: number,
    // We don't want to initialize state for PoolTracker. It doesn't make any sense
    initializeInitialState: boolean = true,
  ) {
    if (this.areCustomPoolsFetched) {
      return;
    }

    await Promise.all(
      factoryAddresses.map(async factoryAddress => {
        try {
          await Promise.all(
            Object.values(this.config.customPools).map(async customPool => {
              const poolIdentifier = this.getPoolIdentifier(
                customPool.address,
                false,
              );

              const poolContextConstants =
                ImplementationConstants[customPool.name];
              const {
                N_COINS: nCoins,
                USE_LENDING: useLending,
                isLending,
              } = poolContextConstants;

              const coinsAndImplementations =
                await this.dexHelper.multiWrapper.aggregate(
                  _.range(0, nCoins)
                    .map(i => ({
                      target: customPool.address,
                      callData: this.abiCoder.encodeFunctionCall(
                        this._getCoinsABI(customPool.coinsInputType),
                        [i.toString()],
                      ),
                      decodeFunction: addressDecode,
                    }))
                    .concat([
                      {
                        target: factoryAddress,
                        callData: this.ifaces.factory.encodeFunctionData(
                          'get_implementation_address',
                          [customPool.address],
                        ),
                        decodeFunction: addressDecode,
                      },
                    ]),
                );
              const COINS = coinsAndImplementations.slice(0, -1);
              const implementationAddress =
                coinsAndImplementations.slice(-1)[0];

              const coins_decimals = (
                await this.dexHelper.multiWrapper.tryAggregate(
                  true,
                  COINS.map(c => ({
                    target: c,
                    callData: this.ifaces.erc20.encodeFunctionData(
                      'decimals',
                      [],
                    ),
                    decodeFunction: uint8ToNumber,
                  })),
                )
              ).map(r => r.returnData);

              const poolConstants: PoolConstants = {
                COINS,
                coins_decimals,
                rate_multipliers: this._calcRateMultipliers(coins_decimals),
                lpTokenAddress: customPool.lpTokenAddress,
              };

              let newPool: PoolPollingBase;
              if (
                Object.values<ImplementationNames>(
                  CustomImplementationNames,
                ).includes(customPool.name)
              ) {
                // We don't want custom pools to be used for pricing, unless explicitly specified
                newPool = new CustomBasePoolForFactory(
                  this.logger,
                  this.dexKey,
                  this.dexHelper.config.data.network,
                  this.cacheStateKey,
                  customPool.name as CustomImplementationNames,
                  implementationAddress,
                  customPool.address,
                  this.config.stateUpdatePeriodMs,
                  poolIdentifier,
                  poolConstants,
                  poolContextConstants,
                  customPool.liquidityApiSlug,
                  customPool.lpTokenAddress,
                  isLending,
                  customPool.balancesInputType,
                  useLending,
                  customPool.useForPricing,
                );
              } else {
                // Use for pricing pools from factory
                newPool = new CustomBasePoolForFactory(
                  this.logger,
                  this.dexKey,
                  this.dexHelper.config.data.network,
                  this.cacheStateKey,
                  customPool.name as CustomImplementationNames,
                  implementationAddress,
                  customPool.address,
                  this.config.stateUpdatePeriodMs,
                  poolIdentifier,
                  poolConstants,
                  poolContextConstants,
                  customPool.liquidityApiSlug,
                  customPool.lpTokenAddress,
                  isLending,
                  customPool.balancesInputType,
                  useLending,
                  true,
                );
              }

              this.poolManager.initializeNewPoolForState(
                poolIdentifier,
                newPool,
              );

              if (initializeInitialState) {
                await this.poolManager.initializeIndividualPollingPoolState(
                  poolIdentifier,
                  CustomBasePoolForFactory.IS_SRC_FEE_ON_TRANSFER_SUPPORTED,
                  blockNumber,
                );
              }
            }),
          );
        } catch (e) {
          this.logger.error(
            `Error initializing custom polling pools for factory ${factoryAddress}: `,
            e,
          );
          throw e;
        }
      }),
    );

    this.areCustomPoolsFetched = true;
  }

  async fetchFactoryPools(
    blockNumber?: number,
    // Variable initializeInitialState is only for poolTracker. We don't want to keep state updated with scheduler
    // We just want to initialize factory pools and send request to CurveAPI
    // Other values are not used
    initializeInitialState: boolean = false,
  ) {
    if (this.areFactoryPoolsFetched) {
      return;
    }

    if (!this.factoryAddresses || this.factoryAddresses.length == 0) {
      this.logger.warn(`No factory address specified in configs`);
      return;
    }

    // There is no scenario when we need to call initialize custom pools without factory pools
    // So I put it here to not forget call, because custom pools must be initialised before factory pools
    // This function may be called multiple times, but will execute only once
    await this.initializeCustomPollingPools(
      this.factoryAddresses,
      blockNumber,
      initializeInitialState,
    );

    await Promise.all(
      this.factoryAddresses.map(async factoryAddress => {
        try {
          const poolCountResult =
            await this.dexHelper.multiWrapper!.tryAggregate(true, [
              {
                target: factoryAddress,
                callData: this.ifaces.factory.encodeFunctionData('pool_count'),
                decodeFunction: uint256DecodeToNumber,
              },
              // This is used later to request all available implementations. In particular meta implementations
              {
                target: factoryAddress,
                callData:
                  this.ifaces.factory.encodeFunctionData('base_pool_count'),
                decodeFunction: uint256DecodeToNumber,
              },
            ]);

          const poolCount = poolCountResult[0].returnData;
          const basePoolCount = poolCountResult[1].returnData;

          const calldataGetPoolAddresses = _.range(0, poolCount).map(i => ({
            target: factoryAddress,
            callData: this.ifaces.factory.encodeFunctionData('pool_list', [i]),
            decodeFunction: addressDecode,
          }));

          const calldataGetBasePoolAddresses = _.range(0, basePoolCount).map(
            i => ({
              target: factoryAddress,
              callData: this.ifaces.factory.encodeFunctionData(
                'base_pool_list',
                [i],
              ),
              decodeFunction: addressDecode,
            }),
          );

          const allPoolAddresses = (
            await this.dexHelper.multiWrapper.tryAggregate(
              true,
              calldataGetPoolAddresses.concat(calldataGetBasePoolAddresses),
            )
          ).map(e => e.returnData);

          const poolAddresses = allPoolAddresses.slice(0, poolCount);
          const basePoolAddresses = allPoolAddresses.slice(poolCount);

          const customPoolAddresses = Object.values(
            this.config.customPools,
          ).map(customPool => customPool.address);
          basePoolAddresses.forEach(basePool => {
            if (
              !customPoolAddresses.includes(basePool) &&
              !this.config.disabledPools.has(basePool)
            ) {
              this._reportForUnspecifiedCustomPool(basePool);
            }
          });

          const factoryConfig = this.config.factories?.find(
            ({ address }) =>
              factoryAddress.toLowerCase() === address.toLowerCase(),
          );

          let callDataFromFactoryPools: MultiCallParams<
            string[] | number[] | string
          >[] = poolAddresses
            .map(p => [
              {
                target: factoryAddress,
                callData: this.ifaces.factory.encodeFunctionData(
                  'get_implementation_address',
                  [p],
                ),
                decodeFunction: addressDecode,
              },
              {
                target: factoryAddress,
                callData: this.ifaces.factory.encodeFunctionData('get_coins', [
                  p,
                ]),
                decodeFunction: (
                  result: MultiResult<BytesLike> | BytesLike,
                ): string[] =>
                  generalDecoder<string[]>(
                    result,
                    [
                      `address[${
                        factoryConfig?.maxPlainCoins?.toString() || ''
                      }]`,
                    ],
                    new Array(4).fill(NULL_ADDRESS),
                    parsed => parsed[0].map((p: string) => p.toLowerCase()),
                  ),
              },
              {
                target: factoryAddress,
                callData: this.ifaces.factory.encodeFunctionData(
                  'get_decimals',
                  [p],
                ),
                decodeFunction: (
                  result: MultiResult<BytesLike> | BytesLike,
                ): number[] =>
                  generalDecoder<number[]>(
                    result,
                    [
                      `uint256[${
                        factoryConfig?.maxPlainCoins?.toString() || ''
                      }]`,
                    ],
                    [0, 0, 0, 0],
                    parsed =>
                      parsed[0].map((p: BigNumber) => Number(p.toString())),
                  ),
              },
            ])
            .flat();

          // This is divider between pools related results and implementations
          const factoryResultsDivider = callDataFromFactoryPools.length;

          const metaPoolImplementations = factoryConfig?.isStableNg
            ? []
            : basePoolAddresses.map(basePoolAddress => ({
                target: factoryAddress,
                callData: this.ifaces.factory.encodeFunctionData(
                  'metapool_implementations',
                  [basePoolAddress],
                ),
                decodeFunction: (
                  result: MultiResult<BytesLike> | BytesLike,
                ): string[] =>
                  generalDecoder<string[]>(
                    result,
                    ['address[10]'],
                    new Array(10).fill(NULL_ADDRESS),
                    parsed => parsed[0].map((p: string) => p.toLowerCase()),
                  ),
              }));

          const plainImplementations = factoryConfig?.isStableNg
            ? []
            : _.flattenDeep(
                _.range(2, FACTORY_MAX_PLAIN_COINS + 1).map(coinNumber =>
                  _.range(FACTORY_MAX_PLAIN_IMPLEMENTATIONS_FOR_COIN).map(
                    implInd => ({
                      target: factoryAddress,
                      callData: this.ifaces.factory.encodeFunctionData(
                        'plain_implementations',
                        [coinNumber, implInd],
                      ),
                      decodeFunction: addressDecode,
                    }),
                  ),
                ),
              );

          // Implementations must be requested from factory, but it accepts as arg basePool address
          // for metaPools
          callDataFromFactoryPools = callDataFromFactoryPools.concat(
            ...metaPoolImplementations,
            // To receive plain pool implementation address, you have to call plain_implementations
            // with two variables: N_COINS and implementations_index
            // N_COINS is between 2-4. Currently more than 4 coins is not supported
            // as for implementation index, there are only 0-9 indexes
            ...plainImplementations,
          );

          const allResultsFromFactory = (
            await this.dexHelper.multiWrapper.tryAggregate<
              string[] | number[] | string
              // decrease batch size to 450 to avoid 'out-of-limit' error on gnosis
            >(true, callDataFromFactoryPools, undefined, 450)
          ).map(r => r.returnData);

          const resultsFromFactory = allResultsFromFactory.slice(
            0,
            factoryResultsDivider,
          );

          const allAvailableImplementations = _.flattenDeep(
            allResultsFromFactory.slice(factoryResultsDivider) as string[],
          ).filter(
            implementation =>
              implementation !== NULL_ADDRESS &&
              !this.config.disabledImplementations.has(implementation),
          );

          allAvailableImplementations.forEach(implementation => {
            const currentImplementation =
              this.config.factoryPoolImplementations[implementation];
            if (currentImplementation === undefined) {
              this._reportForUnspecifiedImplementation(implementation);
            }
          });

          const stateInitializePromises: Promise<void>[] = [];
          _.chunk(resultsFromFactory, 3).forEach((result, i) => {
            if (this.config.disabledPools.has(poolAddresses[i])) {
              this.logger.trace(`Filtering disabled pool ${poolAddresses[i]}`);
              return;
            }

            let [implementationAddress, coins, coins_decimals] = result as [
              string,
              string[],
              number[],
            ];

            implementationAddress = implementationAddress.toLowerCase();
            const filteredPairs = coins
              .map((c, idx) => ({
                coin: c.toLowerCase(),
                decimals: coins_decimals[idx],
              }))
              .filter(
                ({ coin, decimals }) => coin !== NULL_ADDRESS && decimals > 0,
              );

            coins = filteredPairs.map(p => p.coin);
            coins_decimals = filteredPairs.map(p => p.decimals);

            const factoryImplementationFromConfig =
              this.config.factoryPoolImplementations[implementationAddress];

            if (
              factoryImplementationFromConfig === undefined &&
              !this.config.disabledImplementations.has(implementationAddress)
            ) {
              this._reportForUnspecifiedImplementation(
                implementationAddress,
                poolAddresses[i],
              );
              return;
            }

            const factoryImplementationConstants =
              ImplementationConstants[factoryImplementationFromConfig.name];

            let isMeta: boolean = false;
            let basePoolStateFetcher: PoolPollingBase | undefined;
            if (factoryImplementationFromConfig.basePoolAddress !== undefined) {
              isMeta = true;
              const basePoolIdentifier = this.getPoolIdentifier(
                factoryImplementationFromConfig.basePoolAddress,
                false,
              );
              const basePool = this.poolManager.getPool(
                basePoolIdentifier,
                false,
              );
              if (basePool === null) {
                this.logger.error(
                  `${this.dexKey}_${this.dexHelper.config.data.network}: custom base pool ${basePoolIdentifier} was not initialized properly. ` +
                    `You must call initializeCustomPollingPools before fetching factory`,
                );
                return;
              }
              basePoolStateFetcher = basePool;
            }

            const poolConstants: PoolConstants = {
              COINS: coins,
              coins_decimals,
              rate_multipliers: this._calcRateMultipliers(coins_decimals),
            };

            const poolIdentifier = this.getPoolIdentifier(
              poolAddresses[i],
              isMeta,
            );

            const newPool = new FactoryStateHandler(
              this.logger,
              this.dexKey,
              this.dexHelper.config.data.network,
              this.cacheStateKey,
              factoryImplementationFromConfig.name,
              implementationAddress.toLowerCase(),
              poolAddresses[i],
              this.config.stateUpdatePeriodMs,
              this.config.factories,
              factoryAddress,
              poolIdentifier,
              poolConstants,
              factoryImplementationConstants,
              factoryImplementationConstants.isFeeOnTransferSupported,
              factoryImplementationFromConfig.liquidityApiSlug ?? '/factory',
              basePoolStateFetcher,
              factoryImplementationFromConfig.customGasCost,
              factoryImplementationFromConfig.isStoreRateSupported,
            );

            this.poolManager.initializeNewPool(poolIdentifier, newPool);

            if (initializeInitialState) {
              stateInitializePromises.push(
                this.poolManager.initializeIndividualPollingPoolState(
                  poolIdentifier,
                  factoryImplementationConstants.isFeeOnTransferSupported,
                ),
              );
            }
          });

          await Promise.all(stateInitializePromises);
        } catch (e) {
          this.logger.error(
            `Error fetching factory pools for ${factoryAddress}: `,
            e,
          );
          throw e;
        }
      }),
    );

    this.areFactoryPoolsFetched = true;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  getPoolIdentifier(poolAddress: string, isMeta: boolean): string {
    return `${this.dexKey}_${poolAddress}_${isMeta}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (
      this.dexHelper.config.wrapETH(srcToken).address.toLowerCase() ===
      this.dexHelper.config.wrapETH(destToken).address.toLowerCase()
    ) {
      return [];
    }

    const _srcToken = this.needWrapNativeForPricing
      ? this.dexHelper.config.wrapETH(srcToken)
      : srcToken;
    const _destToken = this.needWrapNativeForPricing
      ? this.dexHelper.config.wrapETH(destToken)
      : destToken;

    const srcTokenAddress = _srcToken.address.toLowerCase();
    const destTokenAddress = _destToken.address.toLowerCase();
    const wethAddress =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();

    let pools = this.poolManager.getPoolsForPair(
      srcTokenAddress,
      destTokenAddress,
    );

    if (!this.needWrapNativeForPricing && isETHAddress(_srcToken.address)) {
      pools = pools.concat(
        this.poolManager.getPoolsForPair(wethAddress, destTokenAddress),
      ); // discover WETH pools for ETH src
    }

    if (!this.needWrapNativeForPricing && isETHAddress(_destToken.address)) {
      pools = pools.concat(
        this.poolManager.getPoolsForPair(srcTokenAddress, wethAddress),
      ); // discover WETH pools for ETH dest
    }

    if (side === SwapSide.BUY) {
      pools = pools.filter(pool =>
        this.factoryImplementationsSupportBuySide.has(pool.implementationName),
      );
    }

    return pools
      .filter(pool => {
        // same filtering as on pricing ./curve-v1-factory.ts#L975
        let poolData = pool.getPoolData(srcTokenAddress, destTokenAddress);
        const state = pool.getState();

        if (!state) {
          return false;
        }

        if (poolData === null && !this.needWrapNativeForPricing) {
          if (isETHAddress(srcTokenAddress)) {
            poolData = pool.getPoolData(wethAddress, destTokenAddress);
          } else if (isETHAddress(destTokenAddress)) {
            poolData = pool.getPoolData(srcTokenAddress, wethAddress);
          }
        }

        if (poolData === null) {
          return false;
        }

        const j = poolData.path[0].j;
        // same as for price-handlers/price-handler.ts#L104
        return state.balances[j] > 0n;
      })
      .map(pool => this.getPoolIdentifier(pool.address, pool.isMetaPool));
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
  ): Promise<null | ExchangePrices<CurveV1FactoryData>> {
    try {
      if (
        this.dexHelper.config.wrapETH(srcToken).address.toLowerCase() ===
        this.dexHelper.config.wrapETH(destToken).address.toLowerCase()
      ) {
        return [];
      }

      const _isSrcTokenTransferFeeToBeExchanged =
        isSrcTokenTransferFeeToBeExchanged(transferFees);

      const _srcToken = this.needWrapNativeForPricing
        ? this.dexHelper.config.wrapETH(srcToken)
        : srcToken;

      const _destToken = this.needWrapNativeForPricing
        ? this.dexHelper.config.wrapETH(destToken)
        : destToken;

      const wethAddress =
        this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
      const srcTokenAddress = _srcToken.address.toLowerCase();
      const destTokenAddress = _destToken.address.toLowerCase();

      let pools: PoolPollingBase[] = [];
      if (limitPools !== undefined) {
        pools = limitPools
          .map(poolIdentifier =>
            this.poolManager.getPool(
              poolIdentifier,
              _isSrcTokenTransferFeeToBeExchanged,
            ),
          )
          .filter((pool): pool is PoolPollingBase => {
            if (pool === null) return false;

            const isPoolWithData =
              pool.getPoolData(srcTokenAddress, destTokenAddress) !== null;

            if (
              !this.needWrapNativeForPricing &&
              isETHAddress(srcTokenAddress)
            ) {
              return (
                isPoolWithData ||
                pool.getPoolData(wethAddress, destTokenAddress) !== null
              );
            }

            if (
              !this.needWrapNativeForPricing &&
              isETHAddress(destTokenAddress)
            ) {
              return (
                isPoolWithData ||
                pool.getPoolData(srcTokenAddress, wethAddress) !== null
              );
            }

            return isPoolWithData;
          });
      } else {
        pools = this.poolManager.getPoolsForPair(
          srcTokenAddress,
          destTokenAddress,
          _isSrcTokenTransferFeeToBeExchanged,
        );

        if (!this.needWrapNativeForPricing && isETHAddress(_srcToken.address)) {
          pools = pools.concat(
            this.poolManager.getPoolsForPair(wethAddress, destTokenAddress),
          ); // discover WETH pools for ETH src
        }

        if (
          !this.needWrapNativeForPricing &&
          isETHAddress(_destToken.address)
        ) {
          pools = pools.concat(
            this.poolManager.getPoolsForPair(srcTokenAddress, wethAddress),
          ); // discover WETH pools for ETH dest
        }
      }

      if (side === SwapSide.BUY) {
        pools = pools.filter(pool =>
          this.factoryImplementationsSupportBuySide.has(
            pool.implementationName,
          ),
        );
      }

      if (pools.length <= 0) {
        return null;
      }

      if (pools.length > 10) {
        // I expect this to not happen
        this.logger.warn(
          `${this.dexKey}: There are more than 10 pools found for pair: ${srcTokenAddress}-${destTokenAddress}`,
        );
      }

      const amountsWithUnit = [
        getBigIntPow(_srcToken.decimals),
        ...amounts.slice(1),
      ];
      const amountsWithUnitAndFee = _isSrcTokenTransferFeeToBeExchanged
        ? applyTransferFee(
            applyTransferFee(
              amountsWithUnit,
              side,
              transferFees.srcFee,
              SRC_TOKEN_PARASWAP_TRANSFERS,
            ),
            side,
            transferFees.srcDexFee,
            this.SRC_TOKEN_DEX_TRANSFERS,
          )
        : amountsWithUnit;

      const results = await Promise.all(
        pools.map(
          async (pool): Promise<PoolPrices<CurveV1FactoryData> | null> => {
            let state = pool.getState();
            if (!state) {
              await this.poolManager.updateManuallyPollingPools(
                pool.baseStatePoolPolling
                  ? [pool.baseStatePoolPolling, pool]
                  : [pool],
              );
              state = pool.getState();
              if (!state) {
                return null;
              }
            }

            if (state.balances.every(b => b === 0n)) {
              this.logger.trace(
                `${this.dexKey} on ${this.dexHelper.config.data.network}: State balances equal to 0 in pool ${pool.address}`,
              );
              return null;
            }

            let poolData = pool.getPoolData(srcTokenAddress, destTokenAddress);

            if (poolData === null && !this.needWrapNativeForPricing) {
              if (isETHAddress(srcTokenAddress)) {
                poolData = pool.getPoolData(wethAddress, destTokenAddress);
              } else if (isETHAddress(destTokenAddress)) {
                poolData = pool.getPoolData(srcTokenAddress, wethAddress);
              }
            }

            if (poolData === null) {
              this.logger.error(
                `${pool.fullName}: one or both tokens can not be exchanged in pool ${pool.address}: ${srcTokenAddress} -> ${destTokenAddress}`,
              );
              return null;
            }

            let outputs: bigint[] = this.poolManager
              .getPriceHandler(pool.implementationAddress)
              .getOutputs(
                side,
                state,
                amountsWithUnitAndFee,
                poolData.path[0].i,
                poolData.path[0].j,
                poolData.path[0].underlyingSwap,
              );

            outputs = applyTransferFee(
              outputs,
              side,
              transferFees.destDexFee,
              this.DEST_TOKEN_DEX_TRANSFERS,
            );

            return {
              prices: [0n, ...outputs.slice(1)],
              unit: side === SwapSide.SELL ? outputs[0] : 0n,
              data: poolData,
              exchange: this.dexKey,
              poolIdentifiers: [
                this.getPoolIdentifier(pool.address, pool.isMetaPool),
              ],
              gasCost: POOL_EXCHANGE_GAS_COST,
              poolAddresses: [pool.address],
            };
          },
        ),
      );

      return results.filter(
        (
          r: PoolPrices<CurveV1FactoryData> | null,
        ): r is PoolPrices<CurveV1FactoryData> => r !== null,
      );
    } catch (e) {
      if (blockNumber === 0)
        this.logger.error(
          `Error_${this.dexKey}_${this.dexHelper.config.data.network}_getPrices: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(
        `Error_${this.dexKey}_${this.dexHelper.config.data.network}_getPrices`,
        e,
      );
      return null;
    }
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<CurveV1FactoryData>,
  ): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.INDEX +
      CALLDATA_GAS_COST.INDEX +
      CALLDATA_GAS_COST.TIMESTAMP +
      CALLDATA_GAS_COST.BOOL
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: CurveV1FactoryData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // Multihop encoding
    const {
      path,
      swapParams,
      srcAmount: amount,
      min_dy,
      pools,
    } = this.getMultihopParam(srcAmount, destAmount, data, side);

    const needWrapNative = this._needWrapNative(srcToken, destToken, data);
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          needWrap: 'bool',
          needUnwrap: 'bool',
          route: 'address[11]',
          swap_params: 'uint256[5][5]',
          amount: 'uint256',
          min_dy: 'uint256',
          pools: 'address[5]',
          receiver: 'address',
        },
      },
      {
        needWrap: needWrapNative,
        needUnwrap: needWrapNative,
        route: path,
        swap_params: swapParams,
        amount,
        min_dy,
        pools,
        receiver: this.augustusAddress,
      },
    );

    return {
      targetExchange: this.config.router,
      payload,
      networkFee: '0',
    };
  }

  getTokenFromAddress(address: Address): Token {
    // In this Dex decimals are not used
    return { address, decimals: 0 };
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<CurveV1FactoryData>,
    srcToken: Token,
    _0: Token,
    _1: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<CurveV1FactoryData>, ExchangeTxInfo]> {
    if (!options.isDirectMethod) {
      return [
        optimalSwapExchange,
        {
          deadline: BigInt(getLocalDeadlineAsFriendlyPlaceholder()),
        },
      ];
    }

    assert(
      optimalSwapExchange.data !== undefined,
      `preProcessTransaction: data field is missing`,
    );

    let isApproved: boolean | undefined;

    try {
      isApproved = await this.dexHelper.augustusApprovals.hasApproval(
        options.executionContractAddress,
        this.dexHelper.config.wrapETH(srcToken).address,
        optimalSwapExchange.data.path[0].exchange,
      );
    } catch (e) {
      this.logger.error(
        `preProcessTransaction failed to retrieve allowance info: `,
        e,
      );
    }

    return [
      {
        ...optimalSwapExchange,
        data: {
          ...optimalSwapExchange.data,
          isApproved,
        },
      },
      {
        deadline: BigInt(getLocalDeadlineAsFriendlyPlaceholder()),
      },
    ];
  }

  getDirectParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    expectedAmount: NumberAsString,
    data: CurveV1FactoryData,
    side: SwapSide,
    permit: string,
    uuid: string,
    feePercent: NumberAsString,
    deadline: NumberAsString,
    partner: string,
    beneficiary: string,
    contractMethod: string,
  ): TxInfo<DirectCurveV1Param> {
    if (contractMethod !== DIRECT_METHOD_NAME) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    if (data.path.length > 1) {
      throw new Error('Multihop is not supported by v5');
    }

    assert(side === SwapSide.SELL, 'Buy not supported');

    let isApproved: boolean = !!data.isApproved;
    if (data.isApproved === undefined) {
      this.logger.warn(`isApproved is undefined, defaulting to false`);
    }

    const needWrapNative = this._needWrapNative(srcToken, destToken, data);

    const swapParams: DirectCurveV1Param = [
      srcToken,
      destToken,
      data.path[0].exchange,
      srcAmount,
      destAmount,
      expectedAmount,
      feePercent,
      data.path[0].i.toString(),
      data.path[0].j.toString(),
      partner,
      isApproved,
      data.path[0].underlyingSwap
        ? CurveV1SwapType.EXCHANGE_UNDERLYING
        : CurveV1SwapType.EXCHANGE,
      beneficiary,
      // For CurveV1 we work as it is, without wrapping and unwrapping
      needWrapNative,
      permit,
      uuidToBytes16(uuid),
    ];

    const encoder = (...params: DirectCurveV1Param) => {
      return this.directSwapIface.encodeFunctionData(DIRECT_METHOD_NAME, [
        params,
      ]);
    };

    return {
      params: swapParams,
      encoder,
      networkFee: '0',
    };
  }

  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: CurveV1FactoryData,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ) {
    if (contractMethod !== DIRECT_METHOD_NAME_V6) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    if (data.path.length > 1) {
      throw new Error('Multihop is not supported by direct method');
    }

    assert(side === SwapSide.SELL, 'Buy not supported');

    const metadata = hexConcat([
      hexZeroPad(uuidToBytes16(uuid), 16),
      hexZeroPad(hexlify(blockNumber), 16),
    ]);

    let wrapFlag = 0;
    const needWrapNative = this._needWrapNative(srcToken, destToken, data);

    if (needWrapNative && isETHAddress(srcToken)) {
      wrapFlag = 1; // wrap src eth
    } else if (!needWrapNative && isETHAddress(srcToken)) {
      wrapFlag = 3; // add msg.value to router call
    } else if (needWrapNative && isETHAddress(destToken)) {
      wrapFlag = 2; // unwrap dest eth
    }

    const swapParams: DirectCurveV1FactoryParamV6 = [
      packCurveData(
        data.path[0].exchange,
        !data.isApproved, // approve flag, if not approved then set to true
        wrapFlag,
        data.path[0].underlyingSwap
          ? CurveV1SwapType.EXCHANGE_UNDERLYING
          : CurveV1SwapType.EXCHANGE,
      ).toString(),
      encodeCurveAssets(data.path[0].i, data.path[0].j).toString(),
      srcToken,
      destToken,
      fromAmount,
      toAmount,
      quotedAmount,
      metadata,
      beneficiary,
    ];

    const encodeParams: CurveV1FactoryDirectSwap = [
      swapParams,
      partnerAndFee,
      permit,
    ];

    const encoder = (...params: CurveV1FactoryDirectSwap) => {
      return this.augustusV6Interface.encodeFunctionData(
        DIRECT_METHOD_NAME_V6,
        [...params],
      );
    };

    return {
      encoder,
      params: encodeParams,
      networkFee: '0',
    };
  }

  static getDirectFunctionName(): string[] {
    return [DIRECT_METHOD_NAME];
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: CurveV1FactoryData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    // Multihop encoding
    const {
      path,
      swapParams,
      srcAmount: amount,
      min_dy,
      pools,
    } = this.getMultihopParam(srcAmount, destAmount, data, side);

    const swapData = this.ifaces.curveV1Router.encodeFunctionData(
      `exchange(address[11], uint256[5][5], uint256, uint256, address[5], address)`,
      [path, swapParams, amount, min_dy, pools, this.augustusAddress],
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.config.router,
    );
  }

  static getDirectFunctionNameV6(): string[] {
    return [DIRECT_METHOD_NAME_V6];
  }

  // Multihop case encoding for CurveRouter
  // Curve Ng Router exchange function params description https://github.com/curvefi/curve-router-ng/blob/master/contracts/Router.vy#L180
  getMultihopParam(
    srcAmount: string,
    destAmount: string,
    data: CurveV1FactoryData,
    side: SwapSide,
  ): CurveV1RouterParam {
    const pathLength = 11;
    const swapParamsLength = 5;
    const poolsLength = 5;

    const path = data.path
      .map((item, index) =>
        index === 0
          ? [item.tokenIn, item.exchange, item.tokenOut] // we need tokenIn only for the first item because there is no prev pool
          : [item.exchange, item.tokenOut],
      )
      .flat();

    while (path.length < pathLength) {
      path.push(NULL_ADDRESS);
    }

    const swapParams: CurveV1RouterSwapParam[] = data.path.map(item => [
      item.i,
      item.j,
      item.underlyingSwap
        ? CurveRouterSwapType.exchange_underlying
        : CurveRouterSwapType.exchange,
      CurveRouterPoolType.stable,
      item.n_coins,
    ]);

    while (swapParams.length < swapParamsLength) {
      swapParams.push([0, 0, 0, 0, 0]);
    }

    const pools = [];

    let i = 0;
    while (pools.length < poolsLength) {
      pools.push(data.path[i] ? data.path[i].exchange : NULL_ADDRESS);
      i++;
    }

    return {
      path,
      swapParams,
      srcAmount,
      min_dy:
        side === SwapSide.SELL ? MIN_AMOUNT_TO_RECEIVE.toString() : destAmount,
      pools,
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: CurveV1FactoryData,
    side: SwapSide,
  ): DexExchangeParam {
    if (data.path.length === 1) {
      // Single pool encoding
      const { exchange, i, j, underlyingSwap } = data.path[0];

      const minAmountToReceive =
        side === SwapSide.SELL ? MIN_AMOUNT_TO_RECEIVE : destAmount;
      const defaultArgs = [i, j, srcAmount, minAmountToReceive];

      const swapMethod = underlyingSwap
        ? CurveSwapFunctions.exchange_underlying
        : CurveSwapFunctions.exchange;

      const exchangeData = this.ifaces.exchangeRouter.encodeFunctionData(
        swapMethod,
        defaultArgs,
      );

      return {
        exchangeData,
        needWrapNative: this.needWrapNative,
        sendEthButSupportsInsertFromAmount: true,
        dexFuncHasRecipient: false,
        targetExchange: exchange,
        returnAmountPos: undefined,
      };
    }

    // Multihop encoding
    const {
      path,
      swapParams,
      srcAmount: amount,
      min_dy,
      pools,
    } = this.getMultihopParam(srcAmount, destAmount, data, side);

    const exchangeData = this.ifaces.curveV1Router.encodeFunctionData(
      `exchange(address[11], uint256[5][5], uint256, uint256, address[5], address)`,
      [path, swapParams, amount, min_dy, pools, recipient],
    );

    return {
      exchangeData,
      needWrapNative: this.needWrapNative,
      sendEthButSupportsInsertFromAmount: true,
      dexFuncHasRecipient: true,
      targetExchange: this.config.router,
      returnAmountPos: extractReturnAmountPosition(
        this.ifaces.curveV1Router,
        `exchange(address[11], uint256[5][5], uint256, uint256, address[5], address)`,
      ),
    };
  }

  async updatePoolState(): Promise<void> {
    if (!this.areFactoryPoolsFetched) {
      await this.fetchFactoryPools(undefined, false);
    }

    await this.poolManager.fetchLiquiditiesFromApi();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.areFactoryPoolsFetched) {
      this.logger.error(
        `${this.dexKey}: received getTopPools while factory pools are not fetched`,
      );
      return [];
    }
    const _tokenAddress = tokenAddress.toLowerCase();
    const poolsWithToken = this.poolManager.getPoolsWithToken(_tokenAddress);

    if (poolsWithToken.length === 0) {
      return [];
    }

    return poolsWithToken
      .reduce<PoolLiquidity[]>((acc, pool) => {
        let inCoins = false;
        let inUnderlying = false;
        const inCoinConnectors: Token[] = [];
        for (const [i, coin] of pool.poolConstants.COINS.entries()) {
          if (coin === _tokenAddress) {
            inCoins = true;
          } else {
            inCoinConnectors.push({
              address: coin,
              decimals: pool.poolConstants.coins_decimals[i],
            });
          }
        }

        const underlyingConnectors: Token[] = [];
        for (const [underlying, i] of Object.entries(
          pool.underlyingCoinsToIndices,
        )) {
          if (underlying === _tokenAddress) {
            inUnderlying = true;
          } else {
            underlyingConnectors.push({
              address: underlying,
              decimals: pool.underlyingDecimals[i],
            });
          }
        }
        let connectorTokens: Token[] = [];
        if (inCoins) {
          connectorTokens = connectorTokens.concat(inCoinConnectors);
        }
        if (inUnderlying) {
          connectorTokens = connectorTokens.concat(underlyingConnectors);
        }
        if (connectorTokens.length) {
          acc.push({
            exchange: this.dexKey,
            address: pool.address,
            liquidityUSD: pool.liquidityUSD,
            connectorTokens: _.uniqBy(connectorTokens, 'address'),
          });
        }
        return acc;
      }, [])
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  releaseResources(): AsyncOrSync<void> {
    this.poolManager.releaseResources();
  }

  private _calcRateMultipliers(coins_decimals: number[]): bigint[] {
    return coins_decimals.map(coinDecimal => getBigIntPow(36 - coinDecimal));
  }

  private _reportForUnspecifiedImplementation(
    implementation: Address,
    pool?: Address,
  ) {
    this.logger.warn(
      `${this.dexKey}: on network ${this.dexHelper.config.data.network} ` +
        `found unspecified implementation: ${implementation} for ${pool} pool. Skipping pool`,
    );
  }

  private _reportForUnspecifiedCustomPool(pool: Address) {
    this.logger.error(
      `${this.dexKey}: on network ${this.dexHelper.config.data.network} ` +
        `found unspecified custom pool: ${pool}`,
    );
  }

  private _getCoinsABI(type: string): AbiItem {
    const newCoinsType = _.cloneDeep(this.coinsTypeTemplate);
    newCoinsType.inputs![0].type = type;
    return newCoinsType;
  }
}
