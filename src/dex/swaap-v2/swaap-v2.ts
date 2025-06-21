import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  ExchangeTxInfo,
  OptimalSwapExchange,
  PreprocessTransactionOptions,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  MAX_INT,
  MAX_UINT,
  CACHE_PREFIX,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, isAxiosError } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  SwaapV2Data,
  SwaapV2PriceLevel,
  SwaapV2PriceLevels,
  SwaapV2APIParameters,
  SwaapV2QuoteError,
  TokensMap,
  SwaapV2NotificationResponse,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { Adapters, SwaapV2Config } from './config';
import { RateFetcher } from './rate-fetcher';
import routerAbi from '../../abi/swaap-v2/vault.json';
import BigNumber from 'bignumber.js';
import { BN_0, BN_1, getBigNumberPow } from '../../bignumber-constants';
import { Interface } from 'ethers/lib/utils';
import { AsyncOrSync, assert } from 'ts-essentials';
import {
  SWAAP_RFQ_API_URL,
  SWAAP_RFQ_PRICES_ENDPOINT,
  SWAAP_RFQ_QUOTE_ENDPOINT,
  SWAAP_RFQ_API_PRICES_POLLING_INTERVAL_MS,
  SWAAP_RFQ_PRICES_CACHES_TTL_S,
  STABLE_SWAP_GAS_COST_ESTIMATION,
  VOLATILE_SWAP_GAS_COST_ESTIMATION,
  BATCH_SWAP_SELECTOR,
  CALLER_SLOT,
  SWAAP_403_TTL_S,
  SWAAP_429_TTL_S,
  SWAAP_RFQ_TOKENS_ENDPOINT,
  SWAAP_POOL_RESTRICT_TTL_S,
  SWAAP_RFQ_API_TOKENS_POLLING_INTERVAL_MS,
  SWAAP_RFQ_TOKENS_CACHES_TTL_S,
  SWAAP_PRICES_CACHE_KEY,
  SWAAP_TOKENS_CACHE_KEY,
  SWAAP_ORDER_TYPE_SELL,
  SWAAP_ORDER_TYPE_BUY,
  SWAAP_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION,
  SWAAP_BANNED_CODE,
  SWAAP_NOTIFY_ENDPOINT,
} from './constants';
import {
  getPoolIdentifier,
  normalizeTokenAddress,
  getPairName,
  isStablePair,
} from './utils';
import { Method } from '../../dex-helper/irequest-wrapper';
import {
  SlippageCheckError,
  TooStrictSlippageCheckError,
} from '../generic-rfq/types';
import { BI_MAX_UINT256 } from '../../bigint-constants';
import { SpecialDex } from '../../executor/types';
import { extractReturnAmountPosition } from '../../executor/utils';

const BLACKLISTED = 'blacklisted';

export class SwaapV2 extends SimpleExchange implements IDex<SwaapV2Data> {
  readonly isStatePollingDex = true;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;
  private rateFetcher: RateFetcher;
  private swaapV2AuthToken: string;
  private tokensMap: TokensMap = {};
  private runtimeMMsRestrictHashMapKey: string;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(SwaapV2Config);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    protected routerInterface = new Interface(routerAbi),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    const token = dexHelper.config.data.swaapV2AuthToken;
    assert(
      token !== undefined,
      'SwaapV2 auth token is not specified with env variable',
    );

    this.swaapV2AuthToken = token;

    this.rateFetcher = new RateFetcher(
      this.dexHelper,
      this.dexKey,
      this.logger,
      {
        rateConfig: {
          pricesIntervalMs: SWAAP_RFQ_API_PRICES_POLLING_INTERVAL_MS,
          pricesReqParams: this.getPriceLevelsReqParams(),
          pricesCacheTTLSecs: SWAAP_RFQ_PRICES_CACHES_TTL_S,
          pricesCacheKey: SWAAP_PRICES_CACHE_KEY,
        },
        tokensConfig: {
          tokensIntervalMs: SWAAP_RFQ_API_TOKENS_POLLING_INTERVAL_MS,
          tokensReqParams: this.getTokensReqParams(),
          tokensCacheTTLSecs: SWAAP_RFQ_TOKENS_CACHES_TTL_S,
          tokensCacheKey: SWAAP_TOKENS_CACHE_KEY,
        },
      },
    );

    this.runtimeMMsRestrictHashMapKey =
      `${CACHE_PREFIX}_${this.dexKey}_${this.network}_restricted_mms`.toLowerCase();
  }

  async initializePricing(blockNumber: number): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      await this.rateFetcher.start();
    }

    return;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);

    if (normalizedSrcToken.address === normalizedDestToken.address) {
      return [];
    }

    const poolIdentifier = getPoolIdentifier(
      this.dexKey,
      normalizedSrcToken.address,
      normalizedDestToken.address,
    );

    const levels = await this.getCachedLevels();
    if (levels === null) {
      return [];
    }

    return Object.keys(levels)
      .map((pair: string) => {
        return getPoolIdentifier(
          this.dexKey,
          levels[pair].base!,
          levels[pair].quote!,
        );
      })
      .filter((pi: string) => pi === poolIdentifier);
  }

  computePricesFromLevelsBids(
    amounts: BigNumber[],
    asksAndBids: SwaapV2PriceLevels,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
  ): bigint[] {
    let levels: SwaapV2PriceLevel[] = [];
    if (side === SwapSide.BUY) {
      if (destToken.address === asksAndBids.base!) {
        levels = asksAndBids.asks;
      } else {
        levels = this.invertPrices(asksAndBids.bids);
      }
    } else {
      if (srcToken.address === asksAndBids.base!) {
        levels = asksAndBids.bids;
      } else {
        levels = this.invertPrices(asksAndBids.asks);
      }
    }

    const firstLevelRaw = levels[0];
    const firstLevelAmountBN = new BigNumber(firstLevelRaw.level);

    if (amounts[amounts.length - 1].lt(firstLevelAmountBN)) {
      return [];
    }

    return this.computeLevelsQuote(amounts, levels, srcToken, destToken, side);
  }

  inversePrice(priceLevel: SwaapV2PriceLevel): SwaapV2PriceLevel {
    return {
      level: priceLevel.level * priceLevel.price,
      price: 1 / priceLevel.price,
    };
  }

  invertPrices(levels: SwaapV2PriceLevel[]): SwaapV2PriceLevel[] {
    return levels.map(pl => this.inversePrice(pl));
  }

  computeLevelsQuote(
    amounts: BigNumber[],
    levels: SwaapV2PriceLevel[],
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
  ): bigint[] {
    const size = levels.length;
    if (size === 0) {
      return amounts.map(_ => BigInt(0));
    }

    return amounts.map((amount: BigNumber) => {
      if (amount.isZero()) {
        return BigInt(0);
      }

      let i = 0;
      let output = BN_0;
      let previousLevel = BN_0;
      let remaininig = BigNumber(amount);
      let enoughLiquidity = false;
      while (i < size) {
        const levelDelta = BigNumber(levels[i].level).minus(previousLevel);
        if (levelDelta.lte(remaininig)) {
          output = output.plus(levelDelta.times(levels[i].price));
          remaininig = remaininig.minus(levelDelta);
          previousLevel = BigNumber(levels[i].level);
          i += 1;
        } else {
          output = output.plus(remaininig.times(levels[i].price));
          enoughLiquidity = true;
          break;
        }
      }
      if (enoughLiquidity) {
        return BigInt(
          output
            .multipliedBy(
              getBigNumberPow(
                side === SwapSide.BUY ? srcToken.decimals : destToken.decimals,
              ),
            )
            .toFixed(0),
        );
      }
      return BigInt(0); // not enough liquidity
    });
  }

  async getCachedTokens(): Promise<TokensMap | null> {
    const cachedTokens = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      SWAAP_TOKENS_CACHE_KEY,
      SWAAP_RFQ_API_TOKENS_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedTokens) {
      return JSON.parse(cachedTokens) as TokensMap;
    }

    return null;
  }

  async getCachedLevels(): Promise<Record<string, SwaapV2PriceLevels> | null> {
    const cachedLevels = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      SWAAP_PRICES_CACHE_KEY,
      SWAAP_RFQ_API_PRICES_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedLevels) {
      return JSON.parse(cachedLevels) as Record<string, SwaapV2PriceLevels>;
    }

    return null;
  }

  normalizeToken(token: Token): Token {
    return {
      address: normalizeTokenAddress(token.address),
      decimals: token.decimals,
    };
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<SwaapV2Data>> {
    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);

    const requestedPoolIdentifier: string = getPoolIdentifier(
      this.dexKey,
      normalizedSrcToken.address,
      normalizedDestToken.address,
    );

    try {
      if (await this.isRestrictedPool(requestedPoolIdentifier)) {
        return null;
      }

      this.tokensMap = (await this.getCachedTokens()) || {};

      if (normalizedSrcToken.address === normalizedDestToken.address) {
        return null;
      }

      const pools = limitPools
        ? limitPools.filter(
            p =>
              p ===
                getPoolIdentifier(
                  this.dexKey,
                  normalizedSrcToken.address,
                  normalizedDestToken.address,
                ) ||
              p ===
                getPoolIdentifier(
                  this.dexKey,
                  normalizedDestToken.address,
                  normalizedSrcToken.address,
                ),
          )
        : await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber);

      if (pools.length === 0) {
        return null;
      }

      const levels = await this.getCachedLevels();
      if (levels === null) {
        return null;
      }

      const levelEntries: SwaapV2PriceLevels[] = Object.keys(levels)
        .filter(pair => {
          const { base, quote } = levels[pair];
          if (
            pools.includes(getPoolIdentifier(this.dexKey, quote, base)) ||
            pools.includes(getPoolIdentifier(this.dexKey, base, quote))
          ) {
            return true;
          }

          return false;
        })
        .map(pair => {
          return levels[pair];
        });

      const unitVolume = getBigNumberPow(
        (side === SwapSide.SELL ? normalizedSrcToken : normalizedDestToken)
          .decimals,
      );

      const amountsFloat = amounts.map(a =>
        new BigNumber(a.toString()).dividedBy(unitVolume),
      );

      const prices = levelEntries.map((askAndBids: SwaapV2PriceLevels) => {
        const unitPrice: bigint | undefined = this.computePricesFromLevelsBids(
          [unitVolume],
          askAndBids,
          normalizedSrcToken,
          normalizedDestToken,
          side,
        )[0];

        const prices = this.computePricesFromLevelsBids(
          amountsFloat,
          askAndBids,
          normalizedSrcToken,
          normalizedDestToken,
          side,
        );

        if (!prices.length) {
          return null;
        }

        const gasCost = isStablePair(
          this.network,
          normalizedSrcToken.address,
          normalizedDestToken.address,
        )
          ? STABLE_SWAP_GAS_COST_ESTIMATION
          : VOLATILE_SWAP_GAS_COST_ESTIMATION;

        return {
          gasCost: gasCost,
          exchange: this.dexKey,
          data: {},
          prices,
          unit: unitPrice === undefined ? 0n : unitPrice,
          poolIdentifier: requestedPoolIdentifier,
        } as PoolPrices<SwaapV2Data>;
      });

      return prices.filter((p): p is PoolPrices<SwaapV2Data> => !!p);
    } catch (e) {
      this.logger.error(
        `Error_getPrices ${srcToken}, ${destToken}, ${side}:`,
        e,
      );
      return null;
    }
  }

  getBaseToken(poolIdentifier: string): string {
    return poolIdentifier.split('_')[1];
  }

  getDexParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    recipient: string,
    data: SwaapV2Data,
    side: SwapSide,
  ): AsyncOrSync<DexExchangeParam> {
    const { router, callData } = data;
    const isBatchSwap = callData.slice(0, 10) === BATCH_SWAP_SELECTOR;

    // at the moment of writing, batch swap is not supported by SwappV2 API
    assert(isBatchSwap !== true, 'Batch swap is not supported');

    assert(
      router !== undefined,
      `${this.dexKey}-${this.network}: router undefined`,
    );

    assert(
      callData !== undefined,
      `${this.dexKey}-${this.network}: callData undefined`,
    );

    return {
      needWrapNative: this.needWrapNative,
      specialDexSupportsInsertFromAmount: true,
      dexFuncHasRecipient: true,
      exchangeData: callData,
      specialDexFlag: SpecialDex.SWAP_ON_SWAAP_V2_SINGLE,
      targetExchange: router,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerInterface,
              'swap',
              'amountCalculated',
            )
          : undefined,
    };
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<SwaapV2Data>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<SwaapV2Data>, ExchangeTxInfo]> {
    if (await this.isBlacklisted(options.txOrigin)) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted TX Origin address '${options.txOrigin}' trying to build a transaction. Bailing...`,
      );
      throw new Error(
        `${this.dexKey}-${
          this.network
        }: user=${options.txOrigin.toLowerCase()} is blacklisted`,
      );
    }

    const isSell = side === SwapSide.SELL;

    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);

    const tolerance = (
      options.slippageFactor.gt(BN_1)
        ? options.slippageFactor.minus(BN_1)
        : BN_1.minus(options.slippageFactor)
    ).toNumber();

    let quoteId: string | undefined;

    try {
      const quote = await this.rateFetcher.getQuote(
        this.network,
        normalizedSrcToken,
        normalizedDestToken,
        isSell ? optimalSwapExchange.srcAmount : optimalSwapExchange.destAmount,
        isSell ? SWAAP_ORDER_TYPE_SELL : SWAAP_ORDER_TYPE_BUY,
        options.userAddress,
        options.executionContractAddress,
        options.recipient,
        tolerance,
        this.getQuoteReqParams(),
      );

      quoteId = quote.id;

      if (!quote.success) {
        throw new SwaapV2QuoteError(
          `Failed to fetch RFQ for ${getPairName(
            normalizedSrcToken.address,
            normalizedDestToken.address,
          )}: ${JSON.stringify(quote)}`,
        );
      }
      if (!quote.calldata) {
        throw new SwaapV2QuoteError(
          `Failed to fetch RFQ for ${getPairName(
            normalizedSrcToken.address,
            normalizedDestToken.address,
          )}. Missing quote data`,
        );
      }
      if (!quote.router) {
        throw new SwaapV2QuoteError(
          `Failed to fetch RFQ for ${getPairName(
            normalizedSrcToken.address,
            normalizedDestToken.address,
          )}. Missing router address`,
        );
      }

      const expiryAsBigInt = BigInt(quote.expiration);
      const minDeadline = expiryAsBigInt > 0 ? expiryAsBigInt : BI_MAX_UINT256;

      const srcAmount = optimalSwapExchange.srcAmount;
      const destAmount = optimalSwapExchange.destAmount;
      const quoteTokenAmount = quote.amount;
      const slippageFactor = options.slippageFactor;

      if (side === SwapSide.SELL) {
        const requiredAmountWithSlippage = new BigNumber(destAmount)
          .multipliedBy(slippageFactor)
          .toFixed(0);

        if (BigInt(quoteTokenAmount) < BigInt(requiredAmountWithSlippage)) {
          const isTooStrict = new BigNumber(1)
            .minus(slippageFactor)
            .lt(SWAAP_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION);

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
        const requiredAmountWithSlippage = new BigNumber(srcAmount)
          .multipliedBy(slippageFactor)
          .toFixed(0);

        if (BigInt(quoteTokenAmount) > BigInt(requiredAmountWithSlippage)) {
          const isTooStrict = slippageFactor
            .minus(1)
            .lt(SWAAP_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION);

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
      }

      return [
        {
          ...optimalSwapExchange,
          data: {
            router: quote.router,
            callData: quote.calldata,
          },
        },
        { deadline: minDeadline },
      ];
    } catch (e) {
      const prefix = `${this.dexKey}-${this.network}${
        quoteId ? ` quoteId=${quoteId}` : ''
      }`;

      if (isAxiosError(e)) {
        if (e.response?.status === 403) {
          await this.setBlacklist(options.userAddress, SWAAP_403_TTL_S);
          this.logger.warn(
            `${prefix}: Encountered blacklisted user=${options.userAddress}. Adding to local blacklist cache`,
          );
        }

        if (e.response?.status === 429) {
          await this.setBlacklist(options.userAddress, SWAAP_429_TTL_S);
          this.logger.warn(
            `${prefix}: Encountered restricted user=${options.userAddress}. Adding to local blacklist cache`,
          );
        }
      } else if (e instanceof TooStrictSlippageCheckError) {
        this.logger.warn(
          `${prefix}: Too strict slippage, skipping restriction ${e}`,
        );
      } else {
        const message =
          e instanceof Error ? `${e.name}: ${e.message}` : 'Unknown error';
        this.logger.warn(`${prefix}: Protocol is restricted ${e}`);

        const poolIdentifier = getPoolIdentifier(
          this.dexKey,
          normalizedSrcToken.address,
          normalizedDestToken.address,
        );
        await this.restrictPool(message, poolIdentifier);
      }

      throw e;
    }
  }

  async restrictPool(message: string, poolIdentifier: string): Promise<void> {
    this.logger.warn(
      `${this.dexKey}-${this.network}: ${poolIdentifier} was restricted for ${SWAAP_POOL_RESTRICT_TTL_S} sec. due to fails`,
    );

    // We use timestamp for creation date to later discern if it already expired or not
    await this.dexHelper.cache.hset(
      this.runtimeMMsRestrictHashMapKey,
      poolIdentifier,
      Date.now().toString(),
    );

    this.rateFetcher
      .notify(SWAAP_BANNED_CODE, message, this.getNotifyReqParams())
      .then((answer: SwaapV2NotificationResponse) => {
        if (answer.success) {
          this.logger.info(`Successfully notified Swaap API`);
        } else {
          this.logger.error(`Swaap API was not successfully notified`);
        }
      })
      .catch(e => {
        // Must never happen
        this.logger.error(`Swaap API notification failed: ${e}`);
      });
  }

  async isRestrictedPool(poolIdentifier: string): Promise<boolean> {
    const expirationThreshold = Date.now() - SWAAP_POOL_RESTRICT_TTL_S * 1000;
    const createdAt = await this.dexHelper.cache.hget(
      this.runtimeMMsRestrictHashMapKey,
      poolIdentifier,
    );
    const wasNotRestricted = createdAt === null;
    if (wasNotRestricted) {
      return false;
    }
    const restrictionExpired = +createdAt < expirationThreshold;
    return !restrictionExpired;
  }

  async isBlacklisted(txOrigin: Address): Promise<boolean> {
    const result = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      this.getBlackListKey(txOrigin),
    );
    return result === BLACKLISTED;
  }

  getBlackListKey(address: Address) {
    return `blacklist_${address}`.toLowerCase();
  }

  async setBlacklist(
    txOrigin: Address,
    ttl: number = SWAAP_403_TTL_S,
  ): Promise<boolean> {
    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.getBlackListKey(txOrigin),
      ttl,
      BLACKLISTED,
    );
    return true;
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<SwaapV2Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_LARGE +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> assets[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> funds
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.BOOL +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.BOOL +
      // ParentStruct -> limits[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // ParentStruct -> swaps[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> swaps[0] header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[0] -> poolId
      CALLDATA_GAS_COST.FULL_WORD +
      // ParentStruct -> swaps[0] -> assetInIndex
      CALLDATA_GAS_COST.INDEX +
      // ParentStruct -> swaps[0] -> assetOutIndex
      CALLDATA_GAS_COST.INDEX +
      // ParentStruct -> swaps[0] -> amount
      CALLDATA_GAS_COST.AMOUNT +
      // ParentStruct -> swaps[0] -> userData header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[0] -> userData
      CALLDATA_GAS_COST.ZERO +
      // ParentStruct -> assets[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> assets[0:2]
      CALLDATA_GAS_COST.ADDRESS * 2 +
      // ParentStruct -> limits[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> limits[0:2]
      CALLDATA_GAS_COST.FULL_WORD * 2 +
      // Bool -> IsBatchSwap
      CALLDATA_GAS_COST.BOOL
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SwaapV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { router, callData } = data;

    assert(
      router !== undefined,
      `${this.dexKey}-${this.network}: router undefined`,
    );

    assert(
      callData !== undefined,
      `${this.dexKey}-${this.network}: callData undefined`,
    );

    let payload: string;
    const truncatedCalldata = '0x' + callData.slice(10); // droping the function selector
    const isBatchSwap = callData.slice(0, 10) === BATCH_SWAP_SELECTOR;

    if (isBatchSwap) {
      const batchswapAbi = routerAbi.filter(abi => abi.name === 'batchSwap');

      const callDataStruct = this.abiCoder.decodeParameters(
        batchswapAbi[0].inputs!,
        truncatedCalldata,
      );

      const callerSlots = Array(callDataStruct.swaps.length).fill(160);

      payload = this.abiCoder.encodeParameters(
        [
          'bool',
          'uint256[]',
          {
            ParentStruct: {
              'swaps[]': {
                poolId: 'bytes32',
                assetInIndex: 'uint256',
                assetOutIndex: 'uint256',
                amount: 'uint256',
                userData: 'bytes',
              },
              assets: 'address[]',
              funds: {
                sender: 'address',
                fromInternalBalance: 'bool',
                recipient: 'address',
                toInternalBalance: 'bool',
              },
              limits: 'int256[]',
            },
          },
        ],
        [
          isBatchSwap,
          callerSlots,
          {
            swaps: callDataStruct.swaps,
            assets: callDataStruct.assets,
            funds: callDataStruct.funds,
            limits: callDataStruct.limits.map((_: any) => MAX_INT),
          },
        ],
      );
    } else {
      const swapAbi = routerAbi.filter(abi => abi.name === 'swap');

      const callDataStruct = this.abiCoder.decodeParameters(
        swapAbi[0].inputs!,
        truncatedCalldata,
      );

      const callerSlot = CALLER_SLOT;

      payload = this.abiCoder.encodeParameters(
        [
          'bool',
          'uint256',
          {
            ParentStruct: {
              swap: {
                poolId: 'bytes32',
                kind: 'uint8',
                assetIn: 'address',
                assetOut: 'address',
                amount: 'uint256',
                userData: 'bytes',
              },
              funds: {
                sender: 'address',
                fromInternalBalance: 'bool',
                recipient: 'address',
                toInternalBalance: 'bool',
              },
              limit: 'uint256',
            },
          },
        ],
        [
          isBatchSwap,
          callerSlot,
          {
            swap: {
              poolId: callDataStruct.singleSwap.poolId,
              kind: callDataStruct.singleSwap.kind,
              assetIn: callDataStruct.singleSwap.assetIn,
              assetOut: callDataStruct.singleSwap.assetOut,
              amount: callDataStruct.singleSwap.amount,
              userData: callDataStruct.singleSwap.userData,
            },
            funds: {
              sender: callDataStruct.funds.sender,
              fromInternalBalance: callDataStruct.funds.fromInternalBalance,
              recipient: callDataStruct.funds.recipient,
              toInternalBalance: callDataStruct.funds.toInternalBalance,
            },
            limit: side === SwapSide.BUY ? MAX_UINT : '0',
          },
        ],
      );
    }

    return {
      targetExchange: router,
      payload: payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SwaapV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { router, callData } = data;

    assert(
      router !== undefined,
      `${this.dexKey}-${this.network}: router undefined`,
    );

    assert(
      callData !== undefined,
      `${this.dexKey}-${this.network}: callData undefined`,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      callData,
      router,
    );
  }

  computeMaxLiquidity = (
    levels: SwaapV2PriceLevels,
    tokenAddress: string,
  ): number => {
    if (tokenAddress === levels.base!) {
      return (
        (levels.asks[levels.asks.length - 1]?.level ?? 0) *
        levels.asks[0]?.price
      );
    }
    return (
      (levels.asks[levels.bids.length - 1]?.level ?? 0) * levels.asks[0]?.price
    );
  };

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    this.tokensMap = (await this.getCachedTokens()) || {};
    const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);

    const pLevels = await this.getCachedLevels();

    if (pLevels === null) {
      return [];
    }

    const pLevelsWithRestriction = await Promise.all(
      Object.keys(pLevels).map(async (pair: string) => {
        const { base, quote } = pLevels[pair];

        const levelDoesNotIncludeToken =
          normalizedTokenAddress !== base && normalizedTokenAddress !== quote;

        const poolIdentifier: string = getPoolIdentifier(
          this.dexKey,
          base,
          quote,
        );
        const isRestrictedPool = await this.isRestrictedPool(poolIdentifier);

        return {
          pair,
          levelDoesNotIncludeToken,
          isRestrictedPool,
        };
      }),
    );

    return pLevelsWithRestriction
      .filter(
        ({ levelDoesNotIncludeToken, isRestrictedPool }) =>
          !levelDoesNotIncludeToken && !isRestrictedPool,
      )
      .map(({ pair }) => {
        return {
          exchange: this.dexKey,
          connectorTokens: [
            this.getTokenFromAddress(
              normalizedTokenAddress === pLevels[pair].base
                ? pLevels[pair].quote
                : pLevels[pair].base,
            ),
          ],
          liquidityUSD: this.computeMaxLiquidity(pLevels[pair], tokenAddress),
        } as PoolLiquidity;
      })
      .sort((pl: PoolLiquidity) => {
        return -pl.liquidityUSD;
      })
      .slice(0, limit);
  }

  getTokenFromAddress(address: Address): Token {
    return this.tokensMap[normalizeTokenAddress(address)];
  }

  releaseResources(): void {
    if (this.rateFetcher) {
      this.rateFetcher.stop();
    }
  }

  getPriceLevelsReqParams(): SwaapV2APIParameters {
    return this.getAPIReqParams(SWAAP_RFQ_PRICES_ENDPOINT, 'GET');
  }

  getQuoteReqParams(): SwaapV2APIParameters {
    return this.getAPIReqParams(SWAAP_RFQ_QUOTE_ENDPOINT, 'POST');
  }

  getNotifyReqParams(): SwaapV2APIParameters {
    return this.getAPIReqParams(SWAAP_NOTIFY_ENDPOINT, 'POST');
  }

  getTokensReqParams(): SwaapV2APIParameters {
    return this.getAPIReqParams(SWAAP_RFQ_TOKENS_ENDPOINT, 'GET');
  }

  getAPIReqParams(endpoint: string, method: Method): SwaapV2APIParameters {
    return {
      url: `${SWAAP_RFQ_API_URL}/${endpoint}`,
      params: {
        network_id: this.network,
      },
      headers: { 'x-api-key': this.swaapV2AuthToken },
      method: method,
    };
  }
}
