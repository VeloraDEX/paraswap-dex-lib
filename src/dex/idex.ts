import { AsyncOrSync } from 'ts-essentials';
import {
  Address,
  SimpleExchangeParam,
  AdapterExchangeParam,
  DexExchangeParam,
  TxInfo,
  NumberAsString,
  Token,
  ExchangePrices,
  PoolPrices,
  PoolLiquidity,
  OptimalSwapExchange,
  ExchangeTxInfo,
  PreprocessTransactionOptions,
  TransferFeeParams,
  Config,
} from '../types';
import { SwapSide, Network } from '../constants';
import { IDexHelper } from '../dex-helper/idex-helper';
import { OptimalRate, OptimalSwap } from '@paraswap/core';

export type Context = {
  isGlobalSrcToken: boolean;
  isGlobalDestToken: boolean;
};

export type NeedWrapNativeFunc = (
  priceRoute: OptimalRate,
  swap: OptimalSwap,
  se: OptimalSwapExchange<any>,
) => boolean;

export interface IDexTxBuilderV5<ExchangeData, DirectParam = null> {
  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: NOT used, pass a placeholder
  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString, // required for buy case
    data: ExchangeData,
    side: SwapSide,
  ): AdapterExchangeParam;

  // Encode call data used by simpleSwap like routers
  // V5: Used for simpleSwap & simpleBuy
  // V6: NOT used, don't implement
  getSimpleParam?(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: ExchangeData,
    side: SwapSide,
  ): AsyncOrSync<SimpleExchangeParam>;

  // Returns params required by direct swap method.
  // Only Dexes which have a direct method should implement this
  // Used if there is a possibility for direct swap (Eg. UniswapV2,
  // 0xV2/V4, etc)
  getDirectParam?(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    expectedAmount: NumberAsString,
    data: ExchangeData,
    side: SwapSide,
    permit: string,
    uuid: string,
    feePercent: NumberAsString,
    deadline: NumberAsString,
    partner: string,
    beneficiary: string,
    contractMethod: string,
  ): TxInfo<DirectParam>;
}

export interface IDexTxBuilderV6<ExchangeData, DirectParam = null> {
  // Returns params required by generic method
  getDexParam?(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ExchangeData,
    side: SwapSide,
    context: Context,
    executorAddress: Address,
  ): AsyncOrSync<DexExchangeParam>;

  // Returns params for direct method
  getDirectParamV6?(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: ExchangeData,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ): TxInfo<DirectParam>;
}

export interface IDexTxBuilder<ExchangeData, DirectParam = null>
  extends IDexTxBuilderV5<ExchangeData, DirectParam>,
    IDexTxBuilderV6<ExchangeData, DirectParam> {
  needWrapNative: boolean | NeedWrapNativeFunc;
  needsSequentialPreprocessing?: boolean;

  // Returns the ETH fee required to swap
  // It is optional for a DEX to implement this
  // This is a legacy function and will be removed soon
  getNetworkFee?(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: ExchangeData,
    side: SwapSide,
  ): NumberAsString;

  // If exists, called before getAdapterParam to use async calls and receive data if needed
  preProcessTransaction?(
    optimalSwapExchange: OptimalSwapExchange<ExchangeData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): AsyncOrSync<[OptimalSwapExchange<ExchangeData>, ExchangeTxInfo]>;

  // This is helper a function to support testing if preProcessTransaction is implemented
  getTokenFromAddress?(address: Address): Token;
}

export interface IDexPricing<ExchangeData> {
  readonly dexKey: string;
  // This is true if the the DEX is simply
  // wrapping/ unwrapping like weth, lending pools, etc
  // or has a pool where arbitrarily large amounts has
  // constant price.
  readonly hasConstantPriceLargeAmounts: boolean;

  // Specify if current Dex integration can handle fee on transfer tokens
  readonly isFeeOnTransferSupported: boolean;

  readonly cacheStateKey: string;

  // Used to determine if current dex is state polling type or not
  // Set to true if there are many pools polling state and there is no
  // event base support for this Dex
  readonly isStatePollingDex?: boolean;

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]>;

  // Returns generated state of the pool by its identifier for
  // a given block number. If the pool is not found or
  // cannot generate state, return null.
  // This is optional for a DEX to implement this function

  generateStateByPoolId?(
    poolId: string,
    blockNumber: number,
  ): AsyncOrSync<unknown>;

  // Returns on-chain pricing for a specific pool.
  // Return values:
  // - null: unsupported token pair or direction
  // - 0n: supported pair but price is not available
  // - bigint > 0n: actual price
  // Used for comparing on-chain vs off-chain pricing.
  // This is optional for a DEX to implement this function
  getOnChainPriceByPoolId?(
    poolId: string,
    srcToken: Token,
    destToken: Token,
    amount: bigint,
    side: SwapSide,
    blockNumber: number,
  ): Promise<bigint | null>;

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    // list of pool identifiers to use for pricing, if undefined use all pools
    limitPools?: string[],

    // I don't like putting this as new params, but in order to not change interface
    // across all integrations, done it like this
    transferFees?: TransferFeeParams,
    isFirstSwap?: boolean,
  ): Promise<ExchangePrices<ExchangeData> | null>;

  // Returns estimated gas cost for calldata for DEX when used in multiSwap.
  // Output type/length corresponds to that of gasCost inside the poolPrices.
  getCalldataGasCost(poolPrices: PoolPrices<ExchangeData>): number | number[];

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  initializePricing?(blockNumber: number): AsyncOrSync<void>;

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null;

  // If you have any timers or other resources that are need to be released,
  // you must put it here
  releaseResources?(): AsyncOrSync<void>;

  // Build an event based pool with all the info to create inside
  // a cache key name poolKey
  addMasterPool?(poolKey: string, blockNumber: number): AsyncOrSync<boolean>;
  // return true if the userAddress is is blacklisted from the exchange
  // useful for RFQ system
  isBlacklisted?(userAddress?: Address): AsyncOrSync<boolean>;

  // blacklist a specific userAddress from exchange
  setBlacklist?(userAddress?: Address): AsyncOrSync<boolean>;
}

export interface IDexPooltracker {
  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  updatePoolState?(): AsyncOrSync<void>;

  // Returns list of top pools based on liquidity. Max
  // limit pools should be returned.
  getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): AsyncOrSync<PoolLiquidity[]>;
}

// Combine IDexTxBuilder, IDexPricing & IDexPooltracker in
// a single interface
export interface IDex<
  ExchangeData,
  DirectParam = null,
  OptimizedExchangeData = ExchangeData,
> extends IDexTxBuilder<OptimizedExchangeData, DirectParam>,
    IDexPricing<ExchangeData>,
    IDexPooltracker {}

// Defines the static objects of the IDex class
export interface DexConstructor<
  ExchangeData,
  DirectParam = null,
  OptimizedExchangeData = ExchangeData,
> {
  new (network: Network, dexKey: string, dexHelper: IDexHelper): IDex<
    ExchangeData,
    DirectParam,
    OptimizedExchangeData
  >;

  // static dexKeysWithNetwork has the list of dex keys
  // and networks they are supported. This is useful for using
  // same DEX implementation for multiple forks supported
  // in different set of networks.
  dexKeysWithNetwork?: { key: string; networks: Network[] }[];

  builderDexKeysWithNetwork?(dexHelper: Config): void;
}

export type IRouteOptimizer<T> = (formaterRate: T) => T;
