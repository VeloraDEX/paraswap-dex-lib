import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { SwapSide, Network, ETHER_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  EkuboData,
  GetQuoteDataResponse,
  VanillaPoolParameters,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { EkuboConfig } from './config';
import { BasePool } from './pools/base-pool';
import {
  convertEkuboToParaSwap,
  convertParaSwapToEkubo,
  hexStringTokenPair,
  NATIVE_TOKEN_ADDRESS,
  sortAndConvertTokens,
} from './utils';
import Joi from 'joi';
import { Interface } from '@ethersproject/abi';

import CoreABI from '../../abi/ekubo/core.json';
import DataFetcherABI from '../../abi/ekubo/data-fetcher.json';
import { BigNumber, Contract } from 'ethers';
import { FULL_RANGE_TICK_SPACING } from './pools/math/tick';
import { hexlify } from 'ethers/lib/utils';
import RouterABI from '../../abi/ekubo/router.json';
import { isPriceIncreasing } from './pools/math/swap';
import { OraclePool } from './pools/oracle-pool';
import { erc20Iface } from '../../lib/tokens/utils';
import { AsyncOrSync } from 'ts-essentials';
import { MAX_SQRT_RATIO_FLOAT, MIN_SQRT_RATIO_FLOAT } from './pools/math/price';
import { MIN_I256 } from './pools/math/constants';
import { PoolKey, PoolConfig, PoolState } from './pools/pool-utils';

const FALLBACK_POOL_PARAMETERS: VanillaPoolParameters[] = [
  {
    fee: 1844674407370955n,
    tickSpacing: 200,
  },
  {
    fee: 9223372036854775n,
    tickSpacing: 1000,
  },
  {
    fee: 55340232221128654n,
    tickSpacing: 5982,
  },
  {
    fee: 184467440737095516n,
    tickSpacing: 19802,
  },
  {
    fee: 922337203685477580n,
    tickSpacing: 95310,
  },
];

type PairInfo = {
  fee: string;
  tick_spacing: number;
  core_address: string;
  extension: string;
  tvl0_total: string;
  tvl1_total: string;
};

const tokenPairSchema = Joi.object<{
  topPools: PairInfo[];
}>({
  topPools: Joi.array().items(
    Joi.object({
      fee: Joi.string(),
      tick_spacing: Joi.number(),
      extension: Joi.string(),
      tvl0_total: Joi.string(),
      tvl1_total: Joi.string(),
    }),
  ),
});

const allPoolsSchema = Joi.array<
  {
    core_address: string;
    token0: string;
    token1: string;
    fee: string;
    tick_spacing: number;
    extension: string;
  }[]
>().items(
  Joi.object({
    core_address: Joi.string(),
    token0: Joi.string(),
    token1: Joi.string(),
    fee: Joi.string(),
    tick_spacing: Joi.number(),
    extension: Joi.string(),
  }),
);

const MIN_TICK_SPACINGS_PER_POOL = 2;
const MAX_BATCH_SIZE = 100;

const POOL_MAP_UPDATE_INTERVAL_MS = 1 * 60 * 1000;

// Ekubo Protocol https://ekubo.org/
export class Ekubo extends SimpleExchange implements IDex<EkuboData> {
  public readonly hasConstantPriceLargeAmounts = false;
  public readonly needWrapNative = false;
  public readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(EkuboConfig);

  private poolKeys: PoolKey[] | null = [];
  private readonly pools: Map<string, BasePool> = new Map();

  public logger;

  public readonly config;
  public readonly routerIface;

  private readonly core;
  private readonly coreIface;
  private readonly dataFetcher;
  private readonly supportedExtensions;

  private interval?: NodeJS.Timeout;

  // Caches the number of decimals for TVL computation purposes
  private readonly decimals: Record<string, number> = {
    [ETHER_ADDRESS]: 18,
  };

  public constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);

    this.logger = dexHelper.getLogger(dexKey);
    this.config = EkuboConfig[dexKey][network];
    this.core = new Contract(this.config.core, CoreABI, dexHelper.provider);
    this.coreIface = new Interface(CoreABI);
    this.dataFetcher = new Contract(
      this.config.dataFetcher,
      DataFetcherABI,
      dexHelper.provider,
    );
    this.routerIface = new Interface(RouterABI);

    // 0 are vanilla pools
    this.supportedExtensions = [0n, BigInt(this.config.oracle)];
  }

  // Periodically schedules fetching pool keys from the Ekubo API and filling in details with the quote data fetcher
  public async initializePricing(blockNumber: number) {
    await this.updatePoolMap(blockNumber);

    this.interval = setInterval(async () => {
      await this.updatePoolMap(await this.dexHelper.provider.getBlockNumber());
    }, POOL_MAP_UPDATE_INTERVAL_MS);
  }

  // LEGACY
  public getAdapters(
    _side: SwapSide,
  ): { name: string; index: number }[] | null {
    return null;
  }

  public async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const [token0, token1] = sortAndConvertTokens(srcToken, destToken);

    let poolKeys: PoolKey[];
    if (this.poolKeys === null) {
      poolKeys = FALLBACK_POOL_PARAMETERS.map(
        params =>
          new PoolKey(
            token0,
            token1,
            new PoolConfig(params.tickSpacing, params.fee, 0n),
          ),
      );

      if ([token0, token1].includes(NATIVE_TOKEN_ADDRESS)) {
        poolKeys.push(
          new PoolKey(
            token0,
            token1,
            new PoolConfig(
              FULL_RANGE_TICK_SPACING,
              0n,
              BigInt(this.config.oracle),
            ),
          ),
        );
      }
    } else {
      poolKeys = this.poolKeys.filter(
        poolKey => poolKey.token0 === token0 && poolKey.token1 === token1,
      );
    }

    const ids = [];

    for (const poolKey of poolKeys) {
      if (this.pools.has(poolKey.string_id)) {
        ids.push(poolKey.string_id);
      }
    }

    return ids;
  }

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<EkuboData>> {
    const pools = this.getInitializedPools(srcToken, destToken, limitPools);

    const isExactOut = side === SwapSide.BUY;

    const amountToken = isExactOut ? destToken : srcToken;
    const amountTokenAddress = convertParaSwapToEkubo(amountToken.address);
    const unitAmount = getBigIntPow(amountToken.decimals);

    const [token0, token1] = sortAndConvertTokens(srcToken, destToken);

    const exchangePrices = [];

    // eslint-disable-next-line no-restricted-syntax
    poolLoop: for (const pool of pools) {
      const poolId = pool.key.string_id;

      if (pool.key.token0 !== token0 || pool.key.token1 !== token1) {
        // this.logger.error(
        //   `Can't quote pair ${hexStringTokenPair(
        //     token0,
        //     token1,
        //   )} on pool ${poolId}`,
        // );
        continue;
      }

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

          if (isExactOut && quote.consumedAmount !== inputAmount) {
            this.logger.debug(
              `Pool ${poolId} doesn't have enough liquidity to support exact-out swap of ${amount} ${
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
          poolIdentifier: poolId,
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

  public async updatePoolState(): Promise<void> {}

  public async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
    // // The integration tests skip initializePricing, hence this check
    // if (this.pools.size === 0) {
    //   await this.updatePoolMap(await this.dexHelper.provider.getBlockNumber());
    // }
    // const token = convertParaSwapToEkubo(tokenAddress);
    // const settledPromises = await Promise.allSettled(
    //   Array.from(this.pools.entries()).map(async ([poolId, pool]) => {
    //     const tokenPair = [pool.key.token0, pool.key.token1];
    //     if (!tokenPair.includes(token)) {
    //       return null;
    //     }
    //     const tvlRes = pool.computeTvl();
    //     if (tvlRes === null) {
    //       throw new Error(`failed to compute TVL for pool ${poolId}`);
    //     }
    //     const [info0, info1] = await Promise.all(
    //       tokenPair.map((ekuboToken, i) =>
    //         (async () => {
    //           const paraswapToken = convertEkuboToParaSwap(ekuboToken);
    //           const decimals = await this.getDecimals(paraswapToken);
    //           const token = {
    //             address: paraswapToken,
    //             decimals,
    //           };
    //           return {
    //             token,
    //             tvl: await this.dexHelper.getTokenUSDPrice(token, tvlRes[i]),
    //           };
    //         })(),
    //       ),
    //     );
    //     return {
    //       exchange: this.dexKey,
    //       address: this.config.core,
    //       connectorTokens: [
    //         (info0.token.address !== tokenAddress ? info0 : info1).token,
    //       ],
    //       liquidityUSD: info0.tvl + info1.tvl,
    //     };
    //   }),
    // );
    // const poolLiquidities = settledPromises.flatMap(res => {
    //   if (res.status === 'rejected') {
    //     this.logger.error('TVL computation failed:', res.reason);
    //     return [];
    //   }
    //   return res.value ? [res.value] : [];
    // });
    // poolLiquidities
    //   .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
    //   .splice(limit, Infinity);
    // return poolLiquidities;
  }

  // private async getDecimals(paraswapToken: string): Promise<number> {
  //   const cached = this.decimals[paraswapToken];
  //   if (typeof cached === 'number') {
  //     return cached;
  //   }

  //   const decimals: number = await new Contract(
  //     paraswapToken,
  //     erc20Iface,
  //     this.dexHelper.provider,
  //   ).decimals();

  //   this.decimals[paraswapToken] = decimals;

  //   return decimals;
  // }

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
      targetExchange: this.config.router,
      dexFuncHasRecipient: true,
      returnAmountPos: undefined,
    };
  }

  releaseResources(): AsyncOrSync<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private getInitializedPools(
    tokenA: Token,
    tokenB: Token,
    limitPools: string[] | undefined,
  ): BasePool[] {
    if (typeof limitPools === 'undefined') {
      const [token0, token1] = sortAndConvertTokens(tokenA, tokenB);

      return Array.from(
        this.pools
          .values()
          .filter(
            pool => pool.key.token0 === token0 && pool.key.token1 === token1,
          ),
      );
    }

    return limitPools.flatMap(poolId => {
      const pool = this.pools.get(poolId);

      if (typeof pool === 'undefined') {
        this.logger.warn(`Pool ${poolId} requested but not found`);
        return [];
      }

      return [pool];
    });
  }

  private async updatePoolMap(blockNumber: number) {
    try {
      this.poolKeys = await this.fetchAllPoolKeys();
    } catch (err) {
      this.logger.error(`Updating pool map from Ekubo API failed: ${err}`);
      this.poolKeys = null;

      return;
    }

    const uninitializedPoolKeys = this.poolKeys.filter(
      poolKey => !this.pools.has(poolKey.string_id),
    );
    const promises = this.initializePools(uninitializedPoolKeys, blockNumber);

    (await Promise.allSettled(promises)).flatMap(res => {
      if (res.status === 'rejected') {
        this.logger.error(
          `Fetching batch failed. Pool keys: ${res.reason.batch}. Error: ${res.reason.err}`,
        );
      }
    });
  }

  private initializePools(
    poolKeys: PoolKey[],
    blockNumber: number,
  ): Promise<string[]>[] {
    const promises = [];

    for (
      let batchStart = 0;
      batchStart < poolKeys.length;
      batchStart += MAX_BATCH_SIZE
    ) {
      const batch = poolKeys.slice(batchStart, batchStart + MAX_BATCH_SIZE);

      promises.push(
        (async () => {
          const fetchedData: GetQuoteDataResponse =
            await this.dataFetcher.getQuoteData(
              batch.map(poolKey => poolKey.toAbi()),
              MIN_TICK_SPACINGS_PER_POOL,
              {
                blockTag: blockNumber,
              },
            );

          return fetchedData.map((data, i) => {
            const poolKey = poolKeys[batchStart + i];
            const initialState = PoolState.fromQuoter(
              data,
              poolKey.config.tickSpacing === FULL_RANGE_TICK_SPACING,
            );
            const poolId = poolKey.string_id;
            const extension = poolKey.config.extension;

            let poolConstructor;
            if (extension === 0n) {
              poolConstructor = BasePool;
            } else if (extension === BigInt(this.config.oracle)) {
              poolConstructor = OraclePool;
            } else {
              throw new Error(`Unknown pool extension ${hexlify(extension)}`);
            }

            const pool = new poolConstructor(
              this.dexKey,
              this.network,
              this.dexHelper,
              this.logger,
              this.coreIface,
              this.dataFetcher,
              poolKey,
              this.core,
            );

            this.pools.set(poolId, pool);

            // This is fulfilled immediately
            pool.initialize(blockNumber, { state: initialState });

            return poolId;
          });
        })().catch(err => {
          throw {
            batch,
            err,
          };
        }),
      );
    }

    return promises;
  }

  private async fetchAllPoolKeys(): Promise<PoolKey[]> {
    const res = await this.dexHelper.httpRequest.get(
      `${this.config.apiUrl}/v1/poolKeys`,
    );

    const { error, value } = allPoolsSchema.validate(res, {
      allowUnknown: true,
      presence: 'required',
    });

    if (typeof error !== 'undefined') {
      throw new Error(`validating API response: ${error}`);
    }

    return value
      .filter(
        res =>
          this.supportedExtensions.includes(BigInt(res.extension)) &&
          BigInt(res.core_address) === BigInt(this.core.address),
      )
      .map(
        info =>
          new PoolKey(
            BigInt(info.token0),
            BigInt(info.token1),
            new PoolConfig(
              info.tick_spacing,
              BigInt(info.fee),
              BigInt(info.extension),
            ),
          ),
      );
  }
}
