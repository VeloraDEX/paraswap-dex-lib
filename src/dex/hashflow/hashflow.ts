import { ChainId } from '@hashflow/sdk';
import { Chain, ChainType, HashflowApi } from '@hashflow/taker-js';
import {
  MarketMakersResponse,
  PriceLevelsResponse,
  RfqResponse,
} from '@hashflow/taker-js/dist/types/rest';
import BigNumber from 'bignumber.js';
import { Interface } from 'ethers/lib/utils';
import { assert } from 'ts-essentials';
import routerAbi from '../../abi/hashflow/HashflowRouter.abi.json';
import { BI_MAX_UINT256 } from '../../bigint-constants';
import { BN_0, BN_1, getBigNumberPow } from '../../bignumber-constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { CACHE_PREFIX, Network, NULL_ADDRESS, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IDex } from '../../dex/idex';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  ExchangeTxInfo,
  Logger,
  NumberAsString,
  OptimalSwapExchange,
  PoolLiquidity,
  PoolPrices,
  PreprocessTransactionOptions,
  SimpleExchangeParam,
  Token,
} from '../../types';
import { getDexKeysWithNetwork, Utils } from '../../utils';
import {
  BlacklistError,
  SlippageCheckError,
  TooStrictSlippageCheckError,
} from '../generic-rfq/types';
import { SimpleExchangeWithRestrictions } from '../simple-exchange-with-restrictions';
import { Adapters, HashflowConfig } from './config';
import {
  CONSECUTIVE_ERROR_THRESHOLD,
  CONSECUTIVE_ERROR_TIMESPAN_MS,
  ERROR_CODE_TO_RESTRICT_TTL,
  HASHFLOW_API_CLIENT_NAME,
  HASHFLOW_API_MARKET_MAKERS_POLLING_INTERVAL_MS,
  HASHFLOW_API_PRICES_POLLING_INTERVAL_MS,
  HASHFLOW_API_URL,
  HASHFLOW_BLACKLIST_TTL_S,
  HASHFLOW_GAS_COST,
  HASHFLOW_MARKET_MAKERS_CACHES_TTL_S,
  HASHFLOW_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION,
  HASHFLOW_MM_RESTRICT_TTL_S,
  HASHFLOW_PRICES_CACHES_TTL_S,
  UNKNOWN_ERROR_CODE,
} from './constants';
import { RateFetcher } from './rate-fetcher';
import {
  CacheErrorCodesData,
  ErrorCode,
  HashflowData,
  PriceLevel,
  RfqError,
} from './types';
import { SpecialDex } from '../../executor/types';

export class Hashflow
  extends SimpleExchangeWithRestrictions
  implements IDex<HashflowData>
{
  readonly isStatePollingDex = true;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly needsSequentialPreprocessing = true;
  readonly isFeeOnTransferSupported = false;
  private api: HashflowApi;
  private rateFetcher: RateFetcher;

  private hashFlowAuthToken: string;
  private disabledMMs: Set<string>;
  private runtimeMMsRestrictHashMapKey: string;
  private runtimeMMsRestrictHashMapErrorCodesKey: string;

  private pricesCacheKey: string;
  private marketMakersCacheKey: string;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(HashflowConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly routerAddress: string = HashflowConfig['Hashflow'][network]
      .routerAddress,
    protected routerInterface = new Interface(routerAbi),
  ) {
    super(dexHelper, dexKey, { blacklistedTTL: HASHFLOW_BLACKLIST_TTL_S });
    this.logger = dexHelper.getLogger(`${dexKey}-${network}`);
    const token = dexHelper.config.data.hashFlowAuthToken;
    assert(
      token !== undefined,
      'Hashflow auth token is not specified with env variable',
    );

    this.hashFlowAuthToken = token;
    this.api = new HashflowApi(
      'taker',
      HASHFLOW_API_CLIENT_NAME,
      this.hashFlowAuthToken,
    );

    this.pricesCacheKey = `${CACHE_PREFIX}_${this.dexHelper.config.data.network}_${this.dexKey}_prices`;
    this.marketMakersCacheKey = `${CACHE_PREFIX}_${this.dexHelper.config.data.network}_${this.dexKey}_mms`;

    this.disabledMMs = new Set(dexHelper.config.data.hashFlowDisabledMMs);
    this.runtimeMMsRestrictHashMapKey =
      `${CACHE_PREFIX}_${this.dexKey}_${this.network}_restricted_mms`.toLowerCase();
    this.runtimeMMsRestrictHashMapErrorCodesKey =
      `${CACHE_PREFIX}_${this.dexKey}_${this.network}_restricted_mms_error_codes`.toLowerCase();

    this.rateFetcher = new RateFetcher(
      this.dexHelper,
      this.dexKey,
      this.network,
      this.logger,
      {
        rateConfig: {
          pricesIntervalMs: HASHFLOW_API_PRICES_POLLING_INTERVAL_MS,
          markerMakersIntervalMs:
            HASHFLOW_API_MARKET_MAKERS_POLLING_INTERVAL_MS,
          marketMakersReqParams: {
            url: `${HASHFLOW_API_URL}/taker/v3/market-makers`,
            params: {
              baseChainId: this.network,
              source: HASHFLOW_API_CLIENT_NAME,
              baseChainType: 'evm',
            },
            headers: { Authorization: this.hashFlowAuthToken },
          },
          pricesReqParams: {
            url: `${HASHFLOW_API_URL}/taker/v3/price-levels`,
            params: {
              baseChainId: this.network,
              source: HASHFLOW_API_CLIENT_NAME,
              marketMakers: [],
              baseChainType: 'evm',
            },
            headers: { Authorization: this.hashFlowAuthToken },
          },
          getCachedMarketMakers: this.getCachedMarketMakers.bind(this),
          filterMarketMakers: this.getFilteredMarketMakers.bind(this),
          pricesCacheKey: this.pricesCacheKey,
          pricesCacheTTLSecs: HASHFLOW_PRICES_CACHES_TTL_S,
          marketMakersCacheKey: this.marketMakersCacheKey,
          marketMakersCacheTTLSecs: HASHFLOW_MARKET_MAKERS_CACHES_TTL_S,
        },
      },
    );
  }

  async initializePricing(blockNumber: number): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
    }

    return;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  getPairName = (srcAddress: Address, destAddress: Address) =>
    `${srcAddress}_${destAddress}`.toLowerCase();

  getIdentifierPrefix(srcAddress: Address, destAddress: Address) {
    return `${this.dexKey}_${this.getPairName(
      srcAddress,
      destAddress,
    )}`.toLowerCase();
  }

  getPoolIdentifier(srcAddress: Address, destAddress: Address, mm: string) {
    return `${this.getIdentifierPrefix(
      srcAddress,
      destAddress,
    )}_${mm}`.toLowerCase();
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    if (_srcToken.address === _destToken.address) {
      return [];
    }

    const levels = (await this.getCachedLevels()) || {};
    const makers = Object.keys(levels);

    return makers
      .filter(m => {
        const pairs = levels[m]?.map(entry => entry.pair) ?? [];
        return pairs.some(
          p =>
            _srcToken.address.toLowerCase() === p.baseToken.toLowerCase() &&
            _destToken.address.toLowerCase() === p.quoteToken.toLowerCase(),
        );
      })
      .map(m =>
        this.getPoolIdentifier(_srcToken.address, _destToken.address, m),
      );
  }

  private async getFilteredMarketMakers(makers: string[]): Promise<string[]> {
    const cachedRestrictionUnparsed = await this.dexHelper.cache.hgetAll(
      this.runtimeMMsRestrictHashMapKey,
    );

    const runtimeRestrictedMMs = this.parseCacheRestrictionAndExpiryIfNeeded(
      cachedRestrictionUnparsed,
    );

    return makers.filter(
      mm => !(this.disabledMMs.has(mm) || runtimeRestrictedMMs.has(mm)),
    );
  }

  parseCacheRestrictionAndExpiryIfNeeded(
    cachedValues: Record<string, string>,
  ): Set<string> {
    const restrictedMMs = new Set<string>();
    const toDelete: string[] = [];
    const expirationThreshold = Date.now() - HASHFLOW_MM_RESTRICT_TTL_S * 1000;

    // For log message
    let stringifiedRestrictedMMs = '';

    Object.entries(cachedValues).forEach(([mm, createdAt]) => {
      if (+createdAt < expirationThreshold) {
        toDelete.push(mm);
      } else {
        restrictedMMs.add(mm);
        stringifiedRestrictedMMs += `${mm}, `;
      }
    });

    if (restrictedMMs.size > 0) {
      this.logger.debug(
        `${this.dexKey}-${
          this.network
        }: pricing is skipped for ${stringifiedRestrictedMMs.slice(
          0,
          -2,
        )} due to restriction`,
      );
    }

    if (toDelete.length > 0) {
      this.logger.debug(
        `${this.dexKey}-${this.network}: Deleting expired keys: `,
        toDelete.join(`,`),
      );

      // No need to await since we don't care about when it executes
      // And we don't want to stop pricing request because of this
      this.dexHelper.cache
        .hdel(this.runtimeMMsRestrictHashMapKey, toDelete)
        .catch(e => {
          this.logger.error(
            `${this.dexKey}-${this.network}: Failed to delete expired keys: `,
            e,
          );
        });
    }

    return restrictedMMs;
  }

  computePricesFromLevels(
    amounts: BigNumber[],
    levels: PriceLevel[],
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
  ): bigint[] {
    const outputs = new Array<BigNumber>(amounts.length).fill(BN_0);
    // FIXME: There is still case when last amount is fillable, but in between
    // we may have splits that are less than min. amount. I assume that case is very
    // and not addressing in current fix. If someone will look into that case, just be aware
    // that it is not addressed

    for (const [i, amount] of amounts.entries()) {
      if (amount.isZero()) {
        outputs[i] = BN_0;
      } else {
        const output =
          side === SwapSide.SELL
            ? this.computeLevelsQuote(levels, amount, undefined)
            : this.computeLevelsQuote(levels, undefined, amount);

        if (output === undefined) {
          // If current amount was unfillable, then bigger amounts are unfillable as well
          break;
        } else {
          outputs[i] = output;
        }
      }
    }

    const decimals =
      side === SwapSide.SELL ? destToken.decimals : srcToken.decimals;

    return outputs.map(o =>
      BigInt(o.multipliedBy(getBigNumberPow(decimals)).toFixed(0)),
    );
  }

  toPriceLevelsBN = (
    priceLevels: PriceLevel[],
  ): { level: BigNumber; price: BigNumber }[] =>
    priceLevels.map(l => ({
      level: new BigNumber(l.q),
      price: new BigNumber(l.p),
    }));

  computeLevelsQuote(
    priceLevels: PriceLevel[],
    reqBaseAmount?: BigNumber,
    reqQuoteAmount?: BigNumber,
  ): BigNumber | undefined {
    if (reqBaseAmount && reqQuoteAmount) {
      return undefined;
    }

    const levels = this.toPriceLevelsBN(priceLevels);
    if (!levels.length) {
      return undefined;
    }

    const quote = {
      baseAmount: levels[0]!.level,
      quoteAmount: levels[0]!.level.multipliedBy(levels[0]!.price),
    };
    if (
      (reqBaseAmount && reqBaseAmount.lt(quote.baseAmount)) ||
      (reqQuoteAmount && reqQuoteAmount.lt(quote.quoteAmount))
    ) {
      return undefined;
    }

    for (let i = 1; i < levels.length; i++) {
      const nextLevel = levels[i]!;
      const nextLevelDepth = nextLevel.level;
      const nextLevelQuote = quote.quoteAmount.plus(
        nextLevelDepth.multipliedBy(nextLevel.price),
      );
      if (
        reqBaseAmount &&
        reqBaseAmount.lte(quote.baseAmount.plus(nextLevel.level))
      ) {
        const baseDifference = reqBaseAmount.minus(quote.baseAmount);
        const quoteAmount = quote.quoteAmount.plus(
          baseDifference.multipliedBy(nextLevel.price),
        );
        return quoteAmount;
      } else if (reqQuoteAmount && reqQuoteAmount.lte(nextLevelQuote)) {
        const quoteDifference = reqQuoteAmount.minus(quote.quoteAmount);
        const baseAmount = quote.baseAmount.plus(
          quoteDifference.dividedBy(nextLevel.price),
        );
        return baseAmount;
      }

      quote.baseAmount = quote.baseAmount.plus(nextLevel.level);
      quote.quoteAmount = nextLevelQuote;
    }

    return undefined;
  }

  async getCachedMarketMakers(): Promise<
    MarketMakersResponse['marketMakers'] | null
  > {
    const cachedMarketMakers = await this.dexHelper.cache.rawget(
      this.marketMakersCacheKey,
    );

    if (cachedMarketMakers) {
      return JSON.parse(
        cachedMarketMakers,
      ) as MarketMakersResponse['marketMakers'];
    }

    return null;
  }

  async getCachedLevels(): Promise<PriceLevelsResponse['levels'] | null> {
    const cachedLevels = await this.dexHelper.cache.rawget(this.pricesCacheKey);

    if (cachedLevels) {
      return JSON.parse(cachedLevels) as PriceLevelsResponse['levels'];
    }

    return null;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<HashflowData>> {
    try {
      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      if (_srcToken.address === _destToken.address) {
        return null;
      }

      const prefix = this.getIdentifierPrefix(
        _srcToken.address,
        _destToken.address,
      );

      const pools =
        limitPools ??
        (await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber));

      const marketMakersToUse = pools.map(p => p.split(`${prefix}_`).pop());

      const levelsMap = (await this.getCachedLevels()) || {};

      Object.keys(levelsMap).forEach(mmKey => {
        if (!marketMakersToUse.includes(mmKey)) {
          delete levelsMap[mmKey];
        }
      });

      const levelEntries: {
        mm: string;
        levels: PriceLevel[];
      }[] = Object.keys(levelsMap)
        .map(mm => {
          const entry = levelsMap[mm]?.find(
            e =>
              `${e.pair.baseToken}_${e.pair.quoteToken}` ===
              this.getPairName(_srcToken.address, _destToken.address),
          );
          if (entry === undefined) {
            return undefined;
          } else {
            return { mm, levels: entry.levels };
          }
        })
        .filter(o => o !== undefined)
        .map(o => o!);

      const prices = levelEntries.map(lEntry => {
        const { mm, levels } = lEntry;

        if (levels.length === 0) {
          return null;
        }

        const divider = getBigNumberPow(
          side === SwapSide.SELL ? _srcToken.decimals : _destToken.decimals,
        );

        const amountsRaw = amounts.map(a =>
          new BigNumber(a.toString()).dividedBy(divider),
        );
        const firstLevelRaw = levels[0];
        const firstLevelAmountBN = new BigNumber(firstLevelRaw.q);

        if (amountsRaw[amountsRaw.length - 1].lt(firstLevelAmountBN)) {
          return null;
        }

        const unitPrice = this.computePricesFromLevels(
          [BN_1],
          levels,
          _srcToken,
          _destToken,
          side,
        )[0];

        const prices = this.computePricesFromLevels(
          amountsRaw,
          levels,
          _srcToken,
          _destToken,
          side,
        );

        return {
          gasCost: HASHFLOW_GAS_COST,
          exchange: this.dexKey,
          data: {
            mm,
          },
          prices,
          unit: unitPrice,
          poolIdentifiers: [
            this.getPoolIdentifier(_srcToken.address, _destToken.address, mm),
          ],
          poolAddresses: [this.routerAddress],
        } as PoolPrices<HashflowData>;
      });

      return prices.filter((p): p is PoolPrices<HashflowData> => !!p);
    } catch (e: unknown) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<HashflowData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<HashflowData>, ExchangeTxInfo]> {
    if (await this.isBlacklisted(options.txOrigin)) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted TX Origin address '${options.txOrigin}' trying to build a transaction. Bailing...`,
      );
      throw new BlacklistError(this.dexKey, this.network, options.txOrigin);
    }
    const mm = optimalSwapExchange.data?.mm;
    assert(
      mm !== undefined,
      `${this.dexKey}-${this.network}: MM was not provided in data`,
    );
    const chainId = this.network as ChainId;
    let chainType: ChainType = 'evm';
    const chain = { chainType, chainId } as Chain;

    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const _srcTokenAddress = _srcToken.address.toLowerCase();
    const _destTokenAddress = _destToken.address.toLowerCase();

    let rfq: RfqResponse;
    let quoteId: string | undefined;

    try {
      rfq = await this.api.requestQuote({
        // sender is not passed, so for now ignore executionContractAddress
        baseChain: chain,
        baseToken: _srcTokenAddress,
        quoteToken: _destTokenAddress,
        ...(side === SwapSide.SELL
          ? {
              baseTokenAmount: optimalSwapExchange.srcAmount,
            }
          : { quoteTokenAmount: optimalSwapExchange.destAmount }),
        // receiver address
        wallet: options.recipient.toLowerCase(),
        effectiveTrader: options.userAddress.toLowerCase(),
        marketMakers: [mm],
      });

      quoteId = rfq.rfqId;

      this.logger.info(`Received quote: ${JSON.stringify(rfq)}`);

      if (rfq.status !== 'success') {
        throw new RfqError(
          `Failed to fetch RFQ for ${this.getPairName(
            _srcTokenAddress,
            _destTokenAddress,
          )}: ${JSON.stringify(rfq)}`,
          `${rfq?.error?.code}` as ErrorCode,
        );
      }

      if (!rfq.quotes[0].quoteData) {
        throw new RfqError(
          `Failed to fetch RFQ for ${this.getPairName(
            _srcTokenAddress,
            _destTokenAddress,
          )}. Missing quote data`,
          'MISSING_QUOTE_DATA',
        );
      }

      if (!rfq.quotes[0].signature) {
        throw new RfqError(
          `Failed to fetch RFQ for ${this.getPairName(
            _srcTokenAddress,
            _destTokenAddress,
          )}. Missing signature`,
          'MISSING_SIGNATURE_DATA',
        );
      }

      assert(
        rfq.quotes[0].quoteData.baseToken === _srcTokenAddress,
        `QuoteData baseToken=${rfq.quotes[0].quoteData.baseToken} is different from srcToken=${_srcTokenAddress}`,
      );
      assert(
        rfq.quotes[0].quoteData.quoteToken === _destTokenAddress,
        `QuoteData baseToken=${rfq.quotes[0].quoteData.quoteToken} is different from srcToken=${_destTokenAddress}`,
      );

      const expiryAsBigInt = BigInt(rfq.quotes[0].quoteData.quoteExpiry);
      const minDeadline = expiryAsBigInt > 0 ? expiryAsBigInt : BI_MAX_UINT256;

      const baseTokenAmount = rfq.quotes[0].quoteData.baseTokenAmount;
      const quoteTokenAmount = rfq.quotes[0].quoteData.quoteTokenAmount;

      const srcAmount = optimalSwapExchange.srcAmount;
      const destAmount = optimalSwapExchange.destAmount;

      const slippageFactor = options.slippageFactor;

      if (side === SwapSide.SELL) {
        const requiredAmountWithSlippage = new BigNumber(destAmount)
          .multipliedBy(slippageFactor)
          .toFixed(0);

        if (BigInt(quoteTokenAmount) < BigInt(requiredAmountWithSlippage)) {
          const isTooStrict = BigNumber(1)
            .minus(slippageFactor)
            .lt(HASHFLOW_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION);

          const SlippageError = isTooStrict
            ? TooStrictSlippageCheckError
            : SlippageCheckError;

          throw new SlippageError(
            this.dexKey,
            this.network,
            side,
            requiredAmountWithSlippage,
            quoteTokenAmount,
            slippageFactor,
          );
        }
      } else {
        if (BigInt(quoteTokenAmount) < BigInt(destAmount)) {
          throw new SlippageCheckError(
            this.dexKey,
            this.network,
            side,
            destAmount,
            quoteTokenAmount,
            slippageFactor,
            true,
          );
        }

        const requiredAmountWithSlippage = new BigNumber(srcAmount.toString())
          .multipliedBy(slippageFactor)
          .toFixed(0);

        if (BigInt(baseTokenAmount) > BigInt(requiredAmountWithSlippage)) {
          const isTooStrict = slippageFactor
            .minus(1)
            .lt(HASHFLOW_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION);

          const SlippageError = isTooStrict
            ? TooStrictSlippageCheckError
            : SlippageCheckError;

          throw new SlippageError(
            this.dexKey,
            this.network,
            side,
            requiredAmountWithSlippage,
            baseTokenAmount,
            slippageFactor,
          );
        }
      }

      return [
        {
          ...optimalSwapExchange,
          data: {
            mm,
            quoteData: rfq.quotes[0].quoteData,
            signature: rfq.quotes[0].signature,
          },
        },
        { deadline: minDeadline },
      ];
    } catch (e) {
      const prefix = `${this.dexKey}-${this.network}${
        quoteId ? ` quoteId=${quoteId}` : ''
      }`;

      if (
        e instanceof Error &&
        e.message?.toLowerCase().includes('user is restricted')
      ) {
        this.logger.warn(
          `${prefix}: Encountered restricted user=${options.userAddress}. Adding to local blacklist cache`,
        );
        await this.addBlacklistedAddress(options.userAddress);
        throw new BlacklistError(
          this.dexKey,
          this.network,
          options.userAddress,
        );
      } else if (e instanceof TooStrictSlippageCheckError) {
        this.logger.warn(
          `${prefix}: Market Maker ${mm} failed to build transaction on side ${side} with too strict slippage. Skipping restriction ${e}`,
        );
      } else {
        this.logger.warn(`${prefix}: MM preprocess error ${e}`);

        const code =
          e instanceof RfqError || e instanceof SlippageCheckError
            ? e.code || UNKNOWN_ERROR_CODE
            : UNKNOWN_ERROR_CODE;

        await this.restrictMM(mm, code).catch(err =>
          this.logger.warn(`${prefix}: Failed to restrict MM ${mm}: ${err}`),
        );
      }

      throw e;
    }
  }

  async restrictMM(mm: string, errorCode: ErrorCode): Promise<void> {
    const errorCodesRaw = await this.dexHelper.cache.hget(
      this.runtimeMMsRestrictHashMapErrorCodesKey,
      mm,
    );

    const errorCodes: CacheErrorCodesData = Utils.Parse(errorCodesRaw) || {};

    const error = errorCodes?.[errorCode];

    if (
      !error ||
      error.addedDatetimeMS + CONSECUTIVE_ERROR_TIMESPAN_MS < Date.now()
    ) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: First encounter of error code=${errorCode} for ${mm} OR error ocurred outside of threshold, setting up counter`,
      );
      const data: CacheErrorCodesData = {
        ...errorCodes,
        [errorCode]: {
          count: 1,
          addedDatetimeMS: Date.now(),
        },
      };
      await this.dexHelper.cache.hset(
        this.runtimeMMsRestrictHashMapErrorCodesKey,
        mm,
        Utils.Serialize(data),
      );
      return;
    } else {
      const restrictTTLMs =
        ERROR_CODE_TO_RESTRICT_TTL[errorCode] ||
        ERROR_CODE_TO_RESTRICT_TTL[UNKNOWN_ERROR_CODE];

      if (error.count + 1 > CONSECUTIVE_ERROR_THRESHOLD) {
        this.logger.warn(
          `${this.dexKey}-${this.network}: ${mm} was restricted for ${
            restrictTTLMs / 1000
          } sec. due to ${errorCode} happening ${
            error.count + 1
          } times within last ${Math.floor(
            CONSECUTIVE_ERROR_TIMESPAN_MS / 1000 / 60,
          )} minutes`,
        );

        // date added is checked against HASHFLOW_MM_RESTRICT_TTL_S, as a hack we set a date so that it's checked against specific ttls based on error type to not change parsing logic for mms
        //
        // Example1: ttl for a particular error is 20 minutes (< default 60 minutes)
        // Meaning we need to set `addedDatetimeMS` for restrict hash as Date.now() - 40 minutes (diff between default restrict ttl=1h and particular error restrict ttl = 20 minutes). So the `addedDatetimeMS` is in the past, and after 20 minutes mm will not be considered as restricted
        //
        // Example 2: ttl for a particular error is 80 minutes (> default 60 minutes)
        // Meaning we need to set `addedDatetimeMS` for restrict hash as Date.now() + 20 minutes (in the future), then after an hour (default) it'll still be 20 minutes left for restriction to be cleared

        const defaultRestrictTTLMS = Math.floor(
          HASHFLOW_MM_RESTRICT_TTL_S * 1000,
        );
        const dateModifierMS =
          defaultRestrictTTLMS > restrictTTLMs
            ? -(defaultRestrictTTLMS - restrictTTLMs)
            : restrictTTLMs - defaultRestrictTTLMS;

        const date = (Date.now() + dateModifierMS).toString();

        // We use timestamp for creation date to later discern if it already expired or not
        await this.dexHelper.cache.hset(
          this.runtimeMMsRestrictHashMapKey,
          mm,
          date,
        );

        // resetting error count
        const data: CacheErrorCodesData = {
          ...errorCodes,
          [errorCode]: {
            count: 1,
            addedDatetimeMS: Date.now(),
          },
        };
        await this.dexHelper.cache.hset(
          this.runtimeMMsRestrictHashMapErrorCodesKey,
          mm,
          Utils.Serialize(data),
        );

        return;
      } else {
        const newCount = +error.count + 1;
        this.logger.warn(
          `${this.dexKey}-${this.network}: ${mm} Error with code: ${errorCode} happened ${newCount} times (below or equal to the limit: ${CONSECUTIVE_ERROR_THRESHOLD}), updating counter`,
        );
        const data: CacheErrorCodesData = {
          ...errorCodes,
          [errorCode]: {
            count: newCount,
            addedDatetimeMS: error.addedDatetimeMS, // initial date stays
          },
        };
        await this.dexHelper.cache.hset(
          this.runtimeMMsRestrictHashMapErrorCodesKey,
          mm,
          Utils.Serialize(data),
        );
      }
    }
  }

  getCalldataGasCost(poolPrices: PoolPrices<HashflowData>): number | number[] {
    // I am not sure if that is correct. If anybody know how to fix it,
    // please, go ahead :)
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      // addresses: pool, quoteToken, externalAccount
      CALLDATA_GAS_COST.ADDRESS * 3 +
      // uint256: baseTokenAmount, quoteTokenAmount, quoteExpiry, nonce
      CALLDATA_GAS_COST.AMOUNT * 4 +
      // bytes32 txid;
      CALLDATA_GAS_COST.FULL_WORD +
      // I don't know how big is it, but from google results, I see 65 bytes for signature
      // bytes signature
      CALLDATA_GAS_COST.FULL_WORD * 2 +
      CALLDATA_GAS_COST.OFFSET_SMALL
    );
  }

  getTokenFromAddress?(address: Address): Token {
    // We don't have predefined set of tokens with decimals
    // Anyway we don't use decimals, so it is fine to do this
    return { address, decimals: 0 };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: HashflowData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { quoteData, signature } = data;

    assert(
      quoteData !== undefined,
      `${this.dexKey}-${this.network}: quoteData undefined`,
    );

    const payload = this.routerInterface._abiCoder.encode(
      [
        'tuple(address pool, address quoteToken, address externalAccount, uint256 baseTokenAmount, uint256 quoteTokenAmount, uint256 quoteExpiry, uint256 nonce, bytes32 txid, bytes signature)',
      ],
      [
        {
          pool: quoteData.pool,
          quoteToken: quoteData.quoteToken,
          externalAccount: quoteData.externalAccount ?? NULL_ADDRESS,
          baseTokenAmount: quoteData.baseTokenAmount,
          quoteTokenAmount: quoteData.quoteTokenAmount,
          quoteExpiry: quoteData.quoteExpiry,
          nonce: quoteData.nonce ?? 0,
          txid: quoteData.txid,
          signature,
        },
      ],
    );

    return {
      targetExchange: this.routerAddress,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: HashflowData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { quoteData, signature } = data;

    assert(
      quoteData !== undefined,
      `${this.dexKey}-${this.network}: quoteData undefined`,
    );

    // Encode here the transaction arguments
    const swapData = this.routerInterface.encodeFunctionData('tradeRFQT', [
      [
        quoteData.pool,
        quoteData.externalAccount ?? NULL_ADDRESS,
        quoteData.trader,
        quoteData.effectiveTrader ?? quoteData.trader,
        quoteData.baseToken,
        quoteData.quoteToken,
        quoteData.baseTokenAmount,
        quoteData.baseTokenAmount,
        quoteData.quoteTokenAmount,
        quoteData.quoteExpiry,
        quoteData.nonce ?? 0,
        quoteData.txid,
        signature,
      ],
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      quoteData.baseTokenAmount,
      destToken,
      quoteData.quoteTokenAmount,
      swapData,
      this.routerAddress,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: HashflowData,
    side: SwapSide,
  ): DexExchangeParam {
    try {
      const { quoteData, signature } = data;

      assert(
        quoteData !== undefined,
        `${this.dexKey}-${this.network}: quoteData undefined`,
      );

      // Encode here the transaction arguments
      const sig = signature?.startsWith('0x') ? signature : `0x${signature}`;
      const exchangeData = this.routerInterface.encodeFunctionData(
        'tradeRFQT',
        [
          [
            quoteData.pool,
            quoteData.externalAccount ?? NULL_ADDRESS,
            quoteData.trader,
            quoteData.effectiveTrader ?? quoteData.trader,
            quoteData.baseToken,
            quoteData.quoteToken,
            quoteData.baseTokenAmount,
            quoteData.baseTokenAmount,
            quoteData.quoteTokenAmount,
            quoteData.quoteExpiry,
            quoteData.nonce ?? 0,
            quoteData.txid,
            sig,
          ],
        ],
      );

      return {
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.routerAddress,
        returnAmountPos: undefined,
        specialDexFlag: SpecialDex.SWAP_ON_HASHFLOW,
        // cannot modify amount due to signature checks
        specialDexSupportsInsertFromAmount: false,
      };
    } catch (error) {
      this.logger.error(
        `Failed to build with ${JSON.stringify(data)}: `,
        error,
      );
      throw error;
    }
  }

  extractQuoteToken = (pair: {
    baseToken: string;
    baseTokenName: string;
    quoteToken: string;
    quoteTokenName: string;
    baseTokenDecimals: number;
    quoteTokenDecimals: number;
  }): Token => ({
    address: pair.quoteToken,
    symbol: pair.quoteTokenName,
    decimals: pair.quoteTokenDecimals,
  });

  computeMaxLiquidity = (
    levels: PriceLevel[],
    baseTokenPriceUsd: number,
  ): number => {
    const maxLevel = new BigNumber(levels[levels.length - 1]?.q ?? '0');
    return maxLevel.multipliedBy(baseTokenPriceUsd).toNumber();
  };

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const _tokenAddress = this.dexHelper.config
      .wrapETH(tokenAddress)
      .toLowerCase();

    const makers = (await this.getCachedMarketMakers()) || [];
    const filteredMakers = await this.getFilteredMarketMakers(makers);
    const pLevels = (await this.getCachedLevels()) || {};

    let baseToken: Token | undefined = undefined;
    // TODO: Improve efficiency of this part. Quite inefficient way to determine
    // Token address and decimals. But since it is not called frequently, not worth
    // optimizing now
    for (const maker of filteredMakers) {
      const baseTokenEntry = pLevels[maker]?.find(
        entry => entry.pair.baseToken.toLowerCase() === _tokenAddress,
      );
      if (baseTokenEntry) {
        baseToken = {
          address: _tokenAddress,
          decimals: baseTokenEntry.pair.baseTokenDecimals,
        };
        break;
      }
    }

    if (baseToken === undefined) {
      return [];
    }

    const baseTokenPriceUsd = await this.dexHelper.getTokenUSDPrice(
      baseToken,
      BigInt(getBigNumberPow(baseToken.decimals).toFixed(0)),
    );

    const pools = makers
      .map(
        m =>
          pLevels[m]
            ?.filter(
              entry => entry.pair.baseToken.toLowerCase() === _tokenAddress,
            )
            .map(
              entry =>
                ({
                  exchange: this.dexKey,
                  address: this.routerAddress,
                  connectorTokens: [this.extractQuoteToken(entry.pair)],
                  liquidityUSD: this.computeMaxLiquidity(
                    entry.levels,
                    baseTokenPriceUsd,
                  ),
                } as PoolLiquidity),
            ) ?? [],
      )
      .flatMap(pl => pl);

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  releaseResources(): void {
    if (this.rateFetcher) {
      this.rateFetcher.stop();
    }
  }
}
