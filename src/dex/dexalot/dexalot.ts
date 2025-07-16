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
  TransferFeeParams,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  ETHER_ADDRESS,
  NULL_ADDRESS,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, isAxiosError } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  ClobSide,
  DexalotData,
  PairData,
  PairDataMap,
  PriceDataMap,
  DexalotRfqError,
  DexalotAPIParameters,
  RFQResponse,
  RFQResponseError,
  TokenAddrDataMap,
  TokenDataMap,
} from './types';
import {
  SlippageCheckError,
  TooStrictSlippageCheckError,
} from '../generic-rfq/types';
import { SimpleExchange } from '../simple-exchange';
import { Adapters, DexalotConfig } from './config';
import { RateFetcher } from './rate-fetcher';
import mainnetRFQAbi from '../../abi/dexalot/DexalotMainnetRFQ.json';
import { Interface } from 'ethers/lib/utils';
import { assert } from 'ts-essentials';
import {
  DEXALOT_API_URL,
  DEXALOT_API_PRICES_POLLING_INTERVAL_MS,
  DEXALOT_PRICES_CACHES_TTL_S,
  DEXALOT_GAS_COST,
  DEXALOT_PAIRS_CACHES_TTL_S,
  DEXALOT_API_PAIRS_POLLING_INTERVAL_MS,
  DEXALOT_TOKENS_CACHES_TTL_S,
  DEXALOT_API_BLACKLIST_POLLING_INTERVAL_MS,
  DEXALOT_RATE_LIMITED_TTL_S,
  DEXALOT_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION,
  DEXALOT_RESTRICTED_CACHE_KEY,
  DEXALOT_RESTRICT_TTL_S,
  DEXALOT_RATELIMIT_CACHE_VALUE,
  DEXALOT_BLACKLIST_CACHES_TTL_S,
  DEXALOT_FIRM_QUOTE_TIMEOUT_MS,
} from './constants';
import { BI_MAX_UINT256 } from '../../bigint-constants';
import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
import { Method } from '../../dex-helper/irequest-wrapper';
import { SpecialDex } from '../../executor/types';

export class Dexalot extends SimpleExchange implements IDex<DexalotData> {
  readonly isStatePollingDex = true;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;
  private rateFetcher: RateFetcher;

  private dexalotAuthToken: string;

  private pricesCacheKey: string;
  private pairsCacheKey: string;
  private tokensAddrCacheKey: string;
  private tokensCacheKey: string;
  private blacklistCacheKey: string;
  private tokensMap: TokenDataMap = {};

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(DexalotConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    readonly mainnetRFQAddress: string = DexalotConfig['Dexalot'][network]
      .mainnetRFQAddress,
    protected rfqInterface = new Interface(mainnetRFQAbi),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);

    const authToken = dexHelper.config.data.dexalotAuthToken;
    assert(
      authToken !== undefined,
      'Dexalot auth token is not specified with env variable',
    );
    this.dexalotAuthToken = authToken;

    this.pricesCacheKey = 'prices';
    this.pairsCacheKey = 'pairs';
    this.tokensAddrCacheKey = 'tokens_addr';
    this.tokensCacheKey = 'tokens';
    this.blacklistCacheKey = 'blacklist';

    this.rateFetcher = new RateFetcher(
      this.dexHelper,
      this.dexKey,
      this.network,
      this.logger,
      {
        rateConfig: {
          pairsIntervalMs: DEXALOT_API_PAIRS_POLLING_INTERVAL_MS,
          pricesIntervalMs: DEXALOT_API_PRICES_POLLING_INTERVAL_MS,
          blacklistIntervalMs: DEXALOT_API_BLACKLIST_POLLING_INTERVAL_MS,
          pairsReqParams: this.getAPIReqParams('api/rfq/pairs', 'GET'),
          pricesReqParams: this.getAPIReqParams('api/rfq/prices', 'GET'),
          blacklistReqParams: this.getAPIReqParams('api/rfq/blacklist', 'GET'),
          pairsCacheKey: this.pairsCacheKey,
          pairsCacheTTLSecs: DEXALOT_PAIRS_CACHES_TTL_S,
          pricesCacheKey: this.pricesCacheKey,
          pricesCacheTTLSecs: DEXALOT_PRICES_CACHES_TTL_S,
          tokensAddrCacheKey: this.tokensAddrCacheKey,
          tokensCacheKey: this.tokensCacheKey,
          tokensCacheTTLSecs: DEXALOT_TOKENS_CACHES_TTL_S,
          blacklistCacheKey: this.blacklistCacheKey,
          blacklistCacheTTLSecs: DEXALOT_BLACKLIST_CACHES_TTL_S,
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

  getPairString(baseToken: Token, quoteToken: Token): string {
    return `${baseToken.symbol}/${quoteToken.symbol}`.toLowerCase();
  }

  async getPairData(
    srcToken: Token,
    destToken: Token,
  ): Promise<PairData | null> {
    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);
    if (normalizedSrcToken.address === normalizedDestToken.address) {
      return null;
    }

    const cachedTokens = (await this.getCachedTokens()) || {};
    if (
      !(normalizedSrcToken.address in cachedTokens) ||
      !(normalizedDestToken.address in cachedTokens)
    ) {
      return null;
    }
    normalizedSrcToken.symbol = cachedTokens[normalizedSrcToken.address].symbol;
    normalizedDestToken.symbol =
      cachedTokens[normalizedDestToken.address].symbol;

    const cachedPairs = (await this.getCachedPairs()) || {};

    const potentialPairs = [
      {
        identifier: this.getPairString(normalizedSrcToken, normalizedDestToken),
        isSrcBase: true,
      },
      {
        identifier: this.getPairString(normalizedDestToken, normalizedSrcToken),
        isSrcBase: false,
      },
    ];

    for (const pair of potentialPairs) {
      if (pair.identifier in cachedPairs) {
        const pairData = cachedPairs[pair.identifier];
        pairData.isSrcBase = pair.isSrcBase;
        return pairData;
      }
    }
    return null;
  }

  getIdentifier(srcAddress: Address, destAddress: Address) {
    const sortedAddresses =
      srcAddress < destAddress
        ? [srcAddress, destAddress]
        : [destAddress, srcAddress];

    return `${
      this.dexKey
    }_${sortedAddresses[0].toLowerCase()}_${sortedAddresses[1].toLowerCase()}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!srcToken || !destToken) {
      return [];
    }
    const pairData = await this.getPairData(srcToken, destToken);
    if (!pairData) {
      return [];
    }

    const tokensAddr = (await this.getCachedTokensAddr()) || {};

    return [
      this.getIdentifier(
        tokensAddr[pairData.base.toLowerCase()],
        tokensAddr[pairData.quote.toLowerCase()],
      ),
    ];
  }

  async getCachedPairs(): Promise<PairDataMap | null> {
    const cachedPairs = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.pairsCacheKey,
      // as local cache just uses passed ttl (instead of getting actual ttl from cache)
      // pass shorter interval to avoid getting stale data
      // (same logic is used in other places)
      DEXALOT_API_PAIRS_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedPairs) {
      return JSON.parse(cachedPairs) as PairDataMap;
    }

    return null;
  }

  async getCachedPrices(): Promise<PriceDataMap | null> {
    const cachedPrices = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.pricesCacheKey,
      DEXALOT_API_PRICES_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedPrices) {
      return JSON.parse(cachedPrices) as PriceDataMap;
    }

    return null;
  }

  async getCachedTokensAddr(): Promise<TokenAddrDataMap | null> {
    const cachedTokensAddr = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.tokensAddrCacheKey,
      DEXALOT_API_PAIRS_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedTokensAddr) {
      return JSON.parse(cachedTokensAddr) as TokenAddrDataMap;
    }

    return null;
  }

  async getCachedTokens(): Promise<TokenDataMap | null> {
    const cachedTokens = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.tokensCacheKey,
      DEXALOT_API_PAIRS_POLLING_INTERVAL_MS / 1000,
    );

    if (cachedTokens) {
      return JSON.parse(cachedTokens) as TokenDataMap;
    }

    return null;
  }

  normalizeAddress(address: string): string {
    return address.toLowerCase() === ETHER_ADDRESS
      ? NULL_ADDRESS
      : address.toLowerCase();
  }

  denormalizeAddress(address: string): string {
    return address.toLowerCase() === NULL_ADDRESS
      ? ETHER_ADDRESS
      : address.toLowerCase();
  }

  // Dexalot protocol for native token expects 0x00000... instead of 0xeeeee...
  normalizeToken(token: Token): Token {
    return {
      address: this.normalizeAddress(token.address),
      decimals: token.decimals,
    };
  }

  denormalizeToken(token: Token): Token {
    return {
      address: this.denormalizeAddress(token.address),
      decimals: token.decimals,
    };
  }

  calculateOrderPrice(
    amounts: bigint[],
    orderbook: string[][],
    baseToken: Token,
    quoteToken: Token,
    isInputQuote: boolean,
  ) {
    let result = [];

    for (let i = 0; i < amounts.length; i++) {
      let amt = amounts[i];
      if (amt === 0n) {
        result.push(amt);
        continue;
      }

      let left = 0,
        right = orderbook.length;
      let qty = BigInt(0);

      while (left < right) {
        let mid = Math.floor((left + right) / 2);
        qty = BigInt(
          ethers.utils
            .parseUnits(orderbook[mid][1], quoteToken.decimals)
            .toString(),
        );
        if (isInputQuote) {
          const price = BigInt(
            ethers.utils
              .parseUnits(orderbook[mid][0], baseToken.decimals)
              .toString(),
          );
          qty =
            (qty * BigInt(10 ** (baseToken.decimals * 2))) /
            (price * BigInt(10 ** quoteToken.decimals));
        }
        if (qty <= amt) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }

      let price = BigInt(0),
        amount = BigInt(0);
      if (amounts[i] === qty) {
        price = BigInt(
          ethers.utils
            .parseUnits(orderbook[left][0], baseToken.decimals)
            .toString(),
        );
        amount = amounts[i];
      } else if (left === 0) {
        price = 0n;
      } else if (left < orderbook.length) {
        const lPrice = BigInt(
          ethers.utils
            .parseUnits(orderbook[left - 1][0], baseToken.decimals)
            .toString(),
        );
        const rPrice = BigInt(
          ethers.utils
            .parseUnits(orderbook[left][0], baseToken.decimals)
            .toString(),
        );
        let lQty = BigInt(
          ethers.utils
            .parseUnits(orderbook[left - 1][1], quoteToken.decimals)
            .toString(),
        );
        let rQty = BigInt(
          ethers.utils
            .parseUnits(orderbook[left][1], quoteToken.decimals)
            .toString(),
        );
        if (isInputQuote) {
          lQty =
            (lQty * BigInt(10 ** (baseToken.decimals * 2))) /
            (lPrice * BigInt(10 ** quoteToken.decimals));
          rQty =
            (rQty * BigInt(10 ** (baseToken.decimals * 2))) /
            (rPrice * BigInt(10 ** quoteToken.decimals));
        }
        price = lPrice + ((rPrice - lPrice) * (amt - lQty)) / (rQty - lQty);
        amount = amounts[i];
      }

      if (isInputQuote) {
        result.push(
          (price * amount * BigInt(10 ** quoteToken.decimals)) /
            BigInt(10 ** (baseToken.decimals * 2)),
        );
      } else {
        result.push(
          price !== 0n // To avoid division by zero error
            ? (amount * BigInt(10 ** (baseToken.decimals * 2))) /
                (price * BigInt(10 ** quoteToken.decimals))
            : 0n,
        );
      }
    }
    return result;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<DexalotData>> {
    try {
      const normalizedSrcToken = this.normalizeToken(srcToken);
      const normalizedDestToken = this.normalizeToken(destToken);

      this.tokensMap = (await this.getCachedTokens()) || {};
      if (normalizedSrcToken.address === normalizedDestToken.address) {
        return null;
      }

      let pools = limitPools
        ? limitPools.filter(
            p =>
              p ===
              this.getIdentifier(
                normalizedSrcToken.address,
                normalizedDestToken.address,
              ),
          )
        : await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber);

      pools = await Promise.all(
        pools.map(async p => !(await this.isRestrictedPool(p))),
      ).then(res => pools.filter((_v, i) => res[i]));
      if (pools.length === 0) {
        return null;
      }

      const pairData = await this.getPairData(
        normalizedSrcToken,
        normalizedDestToken,
      );
      if (!pairData) {
        return null;
      }

      const priceMap = await this.getCachedPrices();
      if (!priceMap) {
        return null;
      }

      const tokensAddr = (await this.getCachedTokensAddr()) || {};
      const pairKey = `${pairData.base}/${pairData.quote}`.toLowerCase();
      if (
        !(pairKey in priceMap) ||
        !pools.includes(
          this.getIdentifier(
            tokensAddr[pairData.base.toLowerCase()],
            tokensAddr[pairData.quote.toLowerCase()],
          ),
        )
      ) {
        return null;
      }

      const priceData = priceMap[pairKey];
      const baseToken = pairData.isSrcBase
        ? normalizedSrcToken
        : normalizedDestToken;
      const quoteToken = pairData.isSrcBase
        ? normalizedDestToken
        : normalizedSrcToken;

      // convert from swap to clob side
      let orderbook = priceData.asks;
      let clobSide = ClobSide.BID;
      if (pairData.isSrcBase) {
        orderbook = priceData.bids;
        clobSide = ClobSide.ASK;
      }
      if (orderbook.length === 0) {
        throw new Error(`Empty orderbook for ${pairKey}`);
      }

      const isInputQuote =
        (clobSide === ClobSide.ASK && side === SwapSide.SELL) ||
        (clobSide === ClobSide.BID && side === SwapSide.BUY);

      const prices = this.calculateOrderPrice(
        amounts,
        orderbook,
        baseToken,
        quoteToken,
        isInputQuote,
      );
      const outDecimals =
        clobSide === ClobSide.BID ? baseToken.decimals : quoteToken.decimals;
      const poolIdentifier = this.getIdentifier(pairData.base, pairData.quote);

      return [
        {
          prices,
          unit: BigInt(outDecimals),
          data: {},
          poolIdentifier: poolIdentifier,
          exchange: this.dexKey,
          gasCost: DEXALOT_GAS_COST,
          poolAddresses: [this.mainnetRFQAddress],
        },
      ];
    } catch (e: unknown) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.address || srcToken.symbol}, ${
          destToken.address || destToken.symbol
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  generateRFQError(errorStr: string, swapIdentifier: string) {
    const message = `${this.dexKey}-${this.network}: Failed to fetch RFQ for ${swapIdentifier}. ${errorStr}`;
    this.logger.warn(message);
    throw new DexalotRfqError(message);
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<DexalotData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<DexalotData>, ExchangeTxInfo]> {
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

    if (BigInt(optimalSwapExchange.srcAmount) === 0n) {
      throw new Error('getFirmRate failed with srcAmount === 0');
    }

    const normalizedSrcToken = this.normalizeToken(srcToken);
    const normalizedDestToken = this.normalizeToken(destToken);
    const swapIdentifier = `${this.getIdentifier(
      normalizedSrcToken.address,
      normalizedDestToken.address,
    )}_${side}`;

    try {
      const makerToken = normalizedDestToken;
      const takerToken = normalizedSrcToken;

      const isSell = side === SwapSide.SELL;
      const isBuy = side === SwapSide.BUY;

      const slippageBps = isSell
        ? BigNumber(1)
            .minus(options.slippageFactor)
            .multipliedBy(10000)
            .toFixed(0)
        : options.slippageFactor.minus(1).multipliedBy(10000).toFixed(0);

      const rfqParams = {
        makerAsset: ethers.utils.getAddress(makerToken.address),
        takerAsset: ethers.utils.getAddress(takerToken.address),
        makerAmount: isBuy ? optimalSwapExchange.destAmount : undefined,
        takerAmount: isSell ? optimalSwapExchange.srcAmount : undefined,
        userAddress: options.userAddress,
        chainid: this.network,
        executor: options.executionContractAddress,
        partner: options.partner,
        slippage: slippageBps,
      };

      const rfq: RFQResponse = await this.dexHelper.httpRequest.post(
        `${DEXALOT_API_URL}/api/rfq/firm`,
        rfqParams,
        DEXALOT_FIRM_QUOTE_TIMEOUT_MS,
        { 'x-apikey': this.dexalotAuthToken },
      );
      if (!rfq) {
        this.generateRFQError(
          'Missing quote data',
          `RFQ ${swapIdentifier} ${JSON.stringify(rfq)}`,
        );
      } else if (!rfq.signature) {
        this.generateRFQError('Missing signature', swapIdentifier);
      }
      rfq.order.signature = rfq.signature;

      const { order } = rfq;

      assert(
        order.makerAsset.toLowerCase() === makerToken.address,
        `QuoteData makerAsset=${order.makerAsset} is different from Paraswap makerAsset=${makerToken.address}`,
      );
      assert(
        order.takerAsset.toLowerCase() === takerToken.address,
        `QuoteData takerAsset=${order.takerAsset} is different from Paraswap takerAsset=${takerToken.address}`,
      );
      if (isSell) {
        assert(
          order.takerAmount === optimalSwapExchange.srcAmount,
          `QuoteData takerAmount=${order.takerAmount} is different from Paraswap srcAmount=${optimalSwapExchange.srcAmount}`,
        );
      } else {
        assert(
          order.makerAmount === optimalSwapExchange.destAmount,
          `QuoteData makerAmount=${order.makerAmount} is different from Paraswap destAmount=${optimalSwapExchange.destAmount}`,
        );
      }

      const expiryAsBigInt = BigInt(order.expiry);
      const minDeadline = expiryAsBigInt > 0 ? expiryAsBigInt : BI_MAX_UINT256;

      const slippageFactor = options.slippageFactor;

      const destAmount = optimalSwapExchange.destAmount;
      const srcAmount = optimalSwapExchange.srcAmount;

      const takerAmount = order.takerAmount;
      const makerAmount = order.makerAmount;

      if (isSell) {
        const requiredAmountWithSlippage = new BigNumber(destAmount)
          .multipliedBy(slippageFactor)
          .toFixed(0);

        if (BigInt(makerAmount) < BigInt(requiredAmountWithSlippage)) {
          const isTooStrict = BigNumber(1)
            .minus(slippageFactor)
            .lt(DEXALOT_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION);

          const SlippageError = isTooStrict
            ? TooStrictSlippageCheckError
            : SlippageCheckError;

          throw new SlippageError(
            this.dexKey,
            this.network,
            side,
            requiredAmountWithSlippage,
            makerAmount,
            slippageFactor,
          );
        }
      } else {
        const requiredAmountWithSlippage = new BigNumber(srcAmount)
          .multipliedBy(slippageFactor)
          .toFixed(0);

        if (BigInt(takerAmount) > BigInt(requiredAmountWithSlippage)) {
          const isTooStrict = slippageFactor
            .minus(1)
            .lt(DEXALOT_MIN_SLIPPAGE_FACTOR_THRESHOLD_FOR_RESTRICTION);

          const SlippageError = isTooStrict
            ? TooStrictSlippageCheckError
            : SlippageCheckError;

          throw new SlippageError(
            this.dexKey,
            this.network,
            side,
            requiredAmountWithSlippage,
            takerAmount,
            slippageFactor,
          );
        }
      }

      return [
        {
          ...optimalSwapExchange,
          data: {
            quoteData: order,
          },
        },
        { deadline: minDeadline },
      ];
    } catch (e) {
      if (isAxiosError(e) && e.response && e.response.data) {
        const errorData = e.response.data as RFQResponseError;
        if (errorData.ReasonCode === 'FQ-009') {
          this.logger.warn(
            `${this.dexKey}-${this.network}: Encountered rate limited user=${options.userAddress}. Adding to local rate limit cache`,
          );
          await this.setRateLimited(options.userAddress, errorData.RetryAfter);
        } else {
          await this.setBlacklist(options.userAddress);
          this.logger.error(
            `${this.dexKey}-${this.network}: Failed to fetch RFQ for ${swapIdentifier}: ${errorData.Reason}`,
          );
        }
      } else {
        if (e instanceof TooStrictSlippageCheckError) {
          this.logger.warn(
            `${this.dexKey}-${this.network}: failed to build transaction on side ${side} with too strict slippage. Skipping restriction`,
          );
        } else {
          const poolIdentifiers = await this.getPoolIdentifiers(
            srcToken,
            destToken,
            side,
            0,
          );
          this.logger.warn(
            `${this.dexKey}-${this.network}: protocol is restricted for pools ${poolIdentifiers} due to swap: ${swapIdentifier}`,
          );
          await Promise.all(
            poolIdentifiers.map(async p => await this.restrictPool(p)),
          );
        }
      }

      throw e;
    }
  }

  getCalldataGasCost(poolPrices: PoolPrices<DexalotData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      // addresses: makerAsset, takerAsset, maker, taker
      CALLDATA_GAS_COST.ADDRESS * 4 +
      // uint256: expiry
      CALLDATA_GAS_COST.wordNonZeroBytes(16) +
      // uint256: nonceAndMeta, makerAmount, takerAmount
      CALLDATA_GAS_COST.AMOUNT * 3 +
      // bytes: _signature (65 bytes)
      CALLDATA_GAS_COST.FULL_WORD * 2 +
      CALLDATA_GAS_COST.OFFSET_SMALL
    );
  }

  getTokenFromAddress(address: Address): Token {
    return this.tokensMap[this.normalizeAddress(address)];
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: DexalotData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { quoteData } = data;

    assert(
      quoteData !== undefined,
      `${this.dexKey}-${this.network}: quoteData undefined`,
    );

    const params = [
      {
        nonceAndMeta: quoteData.nonceAndMeta,
        expiry: quoteData.expiry,
        makerAsset: quoteData.makerAsset,
        takerAsset: quoteData.takerAsset,
        maker: quoteData.maker,
        taker: quoteData.taker,
        makerAmount: quoteData.makerAmount,
        takerAmount: quoteData.takerAmount,
      },
      quoteData.signature,
    ];

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          order: {
            nonceAndMeta: 'uint256',
            expiry: 'uint128',
            makerAsset: 'address',
            takerAsset: 'address',
            maker: 'address',
            taker: 'address',
            makerAmount: 'uint256',
            takerAmount: 'uint256',
          },
          signature: 'bytes',
        },
      },
      {
        order: params[0],
        signature: params[1],
      },
    );

    return {
      targetExchange: this.mainnetRFQAddress,
      payload,
      networkFee: '0',
    };
  }

  getRestrictedPoolKey(poolIdentifier: string): string {
    return `${DEXALOT_RESTRICTED_CACHE_KEY}-${poolIdentifier}`;
  }

  async restrictPool(
    poolIdentifier: string,
    ttl: number = DEXALOT_RESTRICT_TTL_S,
  ): Promise<boolean> {
    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.getRestrictedPoolKey(poolIdentifier),
      ttl,
      'true',
    );
    return true;
  }

  async isRestrictedPool(poolIdentifier: string): Promise<boolean> {
    const result = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      this.getRestrictedPoolKey(poolIdentifier),
    );

    return result === 'true';
  }

  async setBlacklist(
    txOrigin: Address,
    ttl: number = DEXALOT_BLACKLIST_CACHES_TTL_S,
  ): Promise<boolean> {
    const cachedBlacklist = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      this.blacklistCacheKey,
    );

    let blacklist: string[] = [];
    if (cachedBlacklist) {
      blacklist = JSON.parse(cachedBlacklist);
    }

    blacklist.push(txOrigin.toLowerCase());

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.blacklistCacheKey,
      ttl,
      JSON.stringify(blacklist),
    );

    return true;
  }

  async isBlacklisted(txOrigin: Address): Promise<boolean> {
    const [cachedBlacklist, isRateLimited] = await Promise.all([
      this.dexHelper.cache.get(
        this.dexKey,
        this.network,
        this.blacklistCacheKey,
      ),
      this.isRateLimited(txOrigin),
    ]);

    if (isRateLimited) {
      return true;
    }

    if (cachedBlacklist) {
      const blacklist = JSON.parse(cachedBlacklist) as string[];
      return blacklist.includes(txOrigin.toLowerCase());
    }

    return false;
  }

  getRateLimitedKey(address: Address) {
    return `rate_limited_${address}`.toLowerCase();
  }

  async isRateLimited(txOrigin: Address): Promise<boolean> {
    const result = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      this.getRateLimitedKey(txOrigin),
    );
    return result === DEXALOT_RATELIMIT_CACHE_VALUE;
  }

  async setRateLimited(txOrigin: Address, ttl = DEXALOT_RATE_LIMITED_TTL_S) {
    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.getRateLimitedKey(txOrigin),
      ttl,
      DEXALOT_RATELIMIT_CACHE_VALUE,
    );
    return true;
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: DexalotData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { quoteData } = data;

    assert(
      quoteData !== undefined,
      `${this.dexKey}-${this.network}: quoteData undefined`,
    );

    const swapFunction = 'simpleSwap';
    const swapFunctionParams = [
      [
        quoteData.nonceAndMeta,
        quoteData.expiry,
        quoteData.makerAsset,
        quoteData.takerAsset,
        quoteData.maker,
        quoteData.taker,
        quoteData.makerAmount,
        quoteData.takerAmount,
      ],
      quoteData.signature,
    ];

    const swapData = this.rfqInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.mainnetRFQAddress,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: DexalotData,
    side: SwapSide,
  ): DexExchangeParam {
    const { quoteData } = data;

    assert(
      quoteData !== undefined,
      `${this.dexKey}-${this.network}: quoteData undefined`,
    );

    const swapFunction = 'partialSwap';
    const swapFunctionParams = [
      [
        quoteData.nonceAndMeta,
        quoteData.expiry,
        quoteData.makerAsset,
        quoteData.takerAsset,
        quoteData.maker,
        quoteData.taker,
        quoteData.makerAmount,
        quoteData.takerAmount,
      ],
      quoteData.signature,
      // might be overwritten on Executors
      quoteData.takerAmount,
    ];

    const exchangeData = this.rfqInterface.encodeFunctionData(
      swapFunction,
      swapFunctionParams,
    );

    return {
      exchangeData,
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      targetExchange: this.mainnetRFQAddress,
      returnAmountPos: undefined,
      specialDexFlag: SpecialDex.SWAP_ON_DEXALOT,
      // cannot modify amount due to signature checks
      specialDexSupportsInsertFromAmount: false,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const normalizedTokenAddress = this.normalizeAddress(tokenAddress);
    const pairs = (await this.getCachedPairs()) || {};
    this.tokensMap = (await this.getCachedTokens()) || {};
    const tokensAddr = (await this.getCachedTokensAddr()) || {};
    const token = this.getTokenFromAddress(normalizedTokenAddress);
    if (!token) {
      return [];
    }

    const tokenSymbol = token.symbol?.toLowerCase() || '';

    let pairsByLiquidity = [];
    for (const pairName of Object.keys(pairs)) {
      if (!pairName.includes(tokenSymbol)) {
        continue;
      }

      const tokensInPair = pairName.split('/');
      if (tokensInPair.length !== 2) {
        continue;
      }

      const [baseToken, quoteToken] = tokensInPair;
      const addr = tokensAddr[baseToken.toLowerCase()];
      let outputToken = this.getTokenFromAddress(addr);
      if (baseToken === tokenSymbol) {
        const addr = tokensAddr[quoteToken.toLowerCase()];
        outputToken = this.getTokenFromAddress(addr);
      }

      const denormalizedToken = this.denormalizeToken(outputToken);

      pairsByLiquidity.push({
        exchange: this.dexKey,
        address: this.mainnetRFQAddress,
        connectorTokens: [
          {
            address: denormalizedToken.address,
            decimals: denormalizedToken.decimals,
          },
        ],
        liquidityUSD: pairs[pairName].liquidityUSD,
      });
    }

    pairsByLiquidity.sort(
      (a: PoolLiquidity, b: PoolLiquidity) => b.liquidityUSD - a.liquidityUSD,
    );

    return pairsByLiquidity.slice(0, limit);
  }

  getAPIReqParams(endpoint: string, method: Method): DexalotAPIParameters {
    return {
      url: `${DEXALOT_API_URL}/${endpoint}`,
      headers: { 'x-apikey': this.dexalotAuthToken },
      params: {
        chainid: this.network,
      },
      method: method,
    };
  }

  releaseResources(): void {
    if (this.rateFetcher) {
      this.rateFetcher.stop();
    }
  }
}
