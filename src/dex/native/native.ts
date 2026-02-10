import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { BN_0, BN_1, getBigNumberPow } from '../../bignumber-constants';
import { Network, SwapSide } from '../../constants';
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
  Token,
} from '../../types';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { RateFetcher } from './rate-fetcher';
import { NativeConfig } from './config';
import {
  NativeData,
  NativeFirmQuoteResponse,
  NativeOrderbookEntry,
  NativeOrderbookLevel,
  NativeRateFetcherConfig,
  NativeTxRequest,
} from './types';
import {
  NATIVE_API_URL,
  NATIVE_BLACKLIST_POLLING_INTERVAL_MS,
  NATIVE_FIRM_QUOTE_EXPIRY_S,
  NATIVE_FIRM_QUOTE_VERSION,
  NATIVE_GAS_COST,
  NATIVE_ORDERBOOK_CACHE_TTL_S,
  NATIVE_ORDERBOOK_POLLING_INTERVAL_MS,
} from './constants';
import { BytesLike, formatUnits, parseUnits } from 'ethers/lib/utils';
import { uint8ToNumber } from '../../lib/decoders';
import { MultiResult } from '../../lib/multi-wrapper';
import { SimpleExchangeWithRestrictions } from '../simple-exchange-with-restrictions';
import { BlacklistError, SlippageCheckError } from '../generic-rfq/types';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';

export class Native
  extends SimpleExchangeWithRestrictions
  implements IDex<NativeData>
{
  readonly isStatePollingDex = true;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;
  readonly needsSequentialPreprocessing = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(NativeConfig);

  protected logger: Logger;
  private rateFetcher: RateFetcher;
  private orderbookCacheKey: string;
  private nativeApiKey: string;
  private chainName: string;
  private routerAddress: Address;
  private addressToTokenMap: Record<Address, Token> = {};

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey, {
      enableDexRestriction: true,
      restrictCountThreshold: 10,
    });

    const dexConfig = NativeConfig[this.dexKey]?.[network];
    assert(
      dexConfig,
      `${this.dexKey}-${network}: Missing network configuration for Native`,
    );

    this.routerAddress = dexConfig.routerAddress;
    this.chainName = dexConfig.chainName;

    this.logger = dexHelper.getLogger(`${dexKey}-${network}`);

    const apiKey = dexHelper.config.data.nativeApiKey;
    assert(
      apiKey && apiKey.length > 0,
      'Native API key is not specified. Please set API_KEY_NATIVE',
    );
    this.nativeApiKey = apiKey;

    this.orderbookCacheKey = `orderbook`;

    const rateFetcherConfig: NativeRateFetcherConfig = {
      rateConfig: {
        orderbookReqParams: {
          url: `${NATIVE_API_URL}/orderbook`,
          params: {
            chain: this.chainName,
          },
          headers: {
            apikey: this.nativeApiKey,
          },
        },
        orderbookCacheKey: this.orderbookCacheKey,
        orderbookCacheTTLSecs: NATIVE_ORDERBOOK_CACHE_TTL_S,
        orderbookIntervalMs: NATIVE_ORDERBOOK_POLLING_INTERVAL_MS,
        blacklistReqParams: {
          url: `${NATIVE_API_URL}/blacklist`,
          headers: {
            apikey: this.nativeApiKey,
          },
        },
        blacklistIntervalMs: NATIVE_BLACKLIST_POLLING_INTERVAL_MS,
        setBlacklist: this.setBlacklist.bind(this),
      },
    };

    this.rateFetcher = new RateFetcher(
      this.dexKey,
      this.dexHelper,
      this.logger,
      rateFetcherConfig,
    );
  }

  async initializePricing(_blockNumber: number): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
    }
  }

  releaseResources(): void {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.stop();
    }
  }

  getAdapters(): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) {
      return [];
    }

    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    if (_srcToken.address.toLowerCase() === _destToken.address.toLowerCase()) {
      return [];
    }

    const entries = await this.getEntriesForPair(
      _srcToken.address,
      _destToken.address,
    );

    return entries.map(entry => this.serializePoolIdentifier(entry));
  }

  private serializePoolIdentifier(entry: NativeOrderbookEntry): string {
    return `${this.dexKey}_${entry.base_address}_${entry.quote_address}_${entry.side}`.toLowerCase();
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    _blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<NativeData> | null> {
    // Native DEX only supports SELL side for now
    if (side === SwapSide.BUY) {
      return null;
    }

    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    if (_srcToken.address.toLowerCase() === _destToken.address.toLowerCase()) {
      return null;
    }

    const orderbook = await this.getCachedOrderbook();
    if (!orderbook) {
      return null;
    }

    let entries = await this.getEntriesForPair(
      _srcToken.address,
      _destToken.address,
      orderbook,
    );

    if (limitPools && limitPools.length > 0) {
      entries = entries.filter(entry =>
        limitPools.includes(this.serializePoolIdentifier(entry)),
      );
    }

    if (entries.length === 0) {
      return null;
    }

    const poolPrices = entries
      .map(entry =>
        this.buildPoolPrices(entry, _srcToken, _destToken, amounts, side),
      )
      .filter((price): price is PoolPrices<NativeData> => price !== null);

    return poolPrices.length ? poolPrices : null;
  }

  getTokenFromAddress(address: Address): Token {
    return this.dexHelper.config.wrapETH({
      address,
      decimals: 18,
    });
  }

  getCalldataGasCost(_: PoolPrices<NativeData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.OFFSET_LARGE +
      CALLDATA_GAS_COST.AMOUNT + // actualSellerAmount
      CALLDATA_GAS_COST.AMOUNT + // actualMinOutputAmount
      CALLDATA_GAS_COST.ADDRESS * 5 + // pool, signer, recipient, sellerToken, buyerToken
      CALLDATA_GAS_COST.AMOUNT * 3 + // sellerTokenAmount, buyerTokenAmount, amountOutMinimum
      CALLDATA_GAS_COST.TIMESTAMP + // deadlineTimestamp
      CALLDATA_GAS_COST.AMOUNT * 5 + // nonce + confidenceT,N,E,M
      CALLDATA_GAS_COST.UUID + // quoteId
      CALLDATA_GAS_COST.BOOL + // multiHop
      CALLDATA_GAS_COST.OFFSET_LARGE * 2 +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.FULL_WORD * 3 + // signature
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.AMOUNT + // widgetFee
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.FULL_WORD * 3 // widgetFeeSignature
    );
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<NativeData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<NativeData>, ExchangeTxInfo]> {
    if (await this.isBlacklisted(options.txOrigin)) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted TX Origin address '${options.txOrigin}' trying to build a transaction. Bailing...`,
      );
      throw new BlacklistError(this.dexKey, this.network, options.txOrigin);
    }

    if (
      options.userAddress !== options.txOrigin &&
      (await this.isBlacklisted(options.userAddress))
    ) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted user address '${options.userAddress}' trying to build a transaction. Bailing...`,
      );
      throw new BlacklistError(this.dexKey, this.network, options.userAddress);
    }

    // Native DEX only supports SELL side for now
    if (side === SwapSide.BUY) {
      throw new Error(`${this.dexKey}-${this.network}: BUY not supported`);
    }

    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const amountIn = BigInt(optimalSwapExchange.srcAmount);
    const formattedAmount = formatUnits(amountIn, _srcToken.decimals);

    const executionAddress = isETHAddress(destToken.address)
      ? options.executionContractAddress.toLowerCase()
      : options.recipient.toLowerCase();

    const firmQuoteParams: Record<string, string> = {
      src_chain: this.chainName,
      dst_chain: this.chainName,
      token_in: _srcToken.address.toLowerCase(),
      token_out: _destToken.address.toLowerCase(),
      amount: formattedAmount,
      from_address: executionAddress,
      version: NATIVE_FIRM_QUOTE_VERSION,
      expiry_time: NATIVE_FIRM_QUOTE_EXPIRY_S.toString(),
    };

    if (options.userAddress) {
      firmQuoteParams.beneficiary_address = options.userAddress.toLowerCase();
    }

    try {
      const response = await this.fetchFirmQuote(firmQuoteParams);

      if (!response?.success || !response.txRequest) {
        throw new Error(
          `${this.dexKey}-${this.network}: Firm quote failed ${
            response?.errorMessage || ''
          }`,
        );
      }

      if (
        response.txRequest.value &&
        response.txRequest.value !== '0' &&
        response.txRequest.value !== '0x0'
      ) {
        throw new Error(
          `${this.dexKey}-${this.network}: Non-zero tx value is not supported`,
        );
      }

      const deadline =
        response.orders?.[0]?.deadlineTimestamp !== undefined
          ? BigInt(response.orders[0].deadlineTimestamp)
          : undefined;

      const destAmount = BigInt(optimalSwapExchange.destAmount);

      const slippageFactor = options.slippageFactor;

      const requiredAmountWithSlippage = new BigNumber(destAmount.toString())
        .multipliedBy(slippageFactor)
        .toFixed(0);

      if (BigInt(response.amountOut) < BigInt(requiredAmountWithSlippage)) {
        throw new SlippageCheckError(
          this.dexKey,
          this.network,
          side,
          requiredAmountWithSlippage,
          response.amountOut.toString(),
          slippageFactor,
        );
      }

      return [
        {
          ...optimalSwapExchange,
          destAmount: response.amountOut,
          data: {
            quote: response,
          },
        },
        {
          deadline,
        },
      ];
    } catch (error: any) {
      this.logger.error(
        `Failed to preprocess transaction for quote ${JSON.stringify(
          firmQuoteParams,
        )} with error: ${(error as Error).message}, `,
        error,
      );

      if (!error?.isSlippageError) {
        this.restrict();
      }

      throw new Error(error);
    }
  }

  getAdapterParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    data: NativeData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    throw new Error('V5 is not supported for Native DEX');
  }

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _recipient: Address,
    data: NativeData,
    _side: SwapSide,
  ): DexExchangeParam {
    const txRequest = data.quote?.txRequest;
    assert(
      txRequest,
      `${this.dexKey}-${this.network}: Missing txRequest for dex param`,
    );

    const { calldata, target } = this.normalizeTxRequest(txRequest);

    const selector = calldata.slice(0, 10); // 0x + 4 bytes of function selector

    let insertFromAmountPos;

    // function selectof for tradeRFQT
    if (selector === '0x0947c2d9') {
      insertFromAmountPos = 36; // position of actualSellerAmount in calldata
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: calldata,
      targetExchange: target,
      insertFromAmountPos,
    };
  }

  async updatePoolState() {
    // load orderbook data once from cache and save locally for future use in getTopPoolsForToken
    const orderbook = await this.getCachedOrderbook();

    if (!orderbook) return;

    const tokenAddresses = new Set<Address>();
    for (const entry of orderbook) {
      tokenAddresses.add(entry.base_address.toLowerCase());
      tokenAddresses.add(entry.quote_address.toLowerCase());
    }

    const addressToTokenMap: Record<Address, Token> = {};
    const tokens = Array.from(tokenAddresses);

    const calls: {
      target: Address;
      callData: string;
      decodeFunction: (str: BytesLike | MultiResult<BytesLike>) => number;
    }[] = [];
    const callToTokenIndex: number[] = [];

    tokens.forEach((token, i) => {
      if (isETHAddress(token)) {
        addressToTokenMap[token] = {
          address: token,
          decimals: 18,
        };
      } else {
        calls.push({
          target: token,
          callData: this.erc20Contract.methods.decimals().encodeABI(),
          decodeFunction: uint8ToNumber,
        });
        callToTokenIndex.push(i);
      }
    });

    const decimalsArray = await this.dexHelper.multiWrapper.aggregate(calls);

    decimalsArray.forEach((decimals, i) => {
      const address = tokens[callToTokenIndex[i]];

      addressToTokenMap[address] = {
        address,
        decimals,
      };
    });

    this.addressToTokenMap = addressToTokenMap;
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const orderbook = await this.getCachedOrderbook();

    if (!orderbook) return [];

    const tokenLower = tokenAddress.toLowerCase();

    const poolPromises = orderbook.map(async entry => {
      const base = entry.base_address.toLowerCase();
      const quote = entry.quote_address.toLowerCase();

      const isBase = base === tokenLower;
      const isQuote = quote === tokenLower;

      if (!isBase && !isQuote) {
        return null;
      }

      const baseToken = this.addressToTokenMap[base];
      const quoteToken = this.addressToTokenMap[quote];

      const [liq0, liq1] = this.computeMaxLiquidity(
        entry.levels,
        baseToken.decimals,
        quoteToken.decimals,
      );

      const usdAmounts = await this.dexHelper.getUsdTokenAmounts([
        [base, liq0],
        [quote, liq1],
      ]);

      const pool: PoolLiquidity = {
        exchange: this.dexKey,
        address: this.routerAddress,
        connectorTokens: [],
        liquidityUSD: 0,
      };

      if (isBase) {
        pool.connectorTokens.push({
          address: entry.quote_address,
          decimals: quoteToken.decimals,
          liquidityUSD: usdAmounts[1],
        });
        pool.liquidityUSD = usdAmounts[0];
      } else {
        pool.connectorTokens.push({
          address: entry.base_address,
          decimals: baseToken.decimals,
          liquidityUSD: usdAmounts[0],
        });
        pool.liquidityUSD = usdAmounts[1];
      }

      return pool;
    });

    const allPools = (await Promise.all(poolPromises)).filter(
      (p): p is PoolLiquidity => p !== null,
    );

    return allPools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  private computeMaxLiquidity(
    levels: NativeOrderbookLevel[],
    decimals0: number,
    decimals1: number,
  ): [bigint, bigint] {
    return levels.reduce(
      ([sum0, sum1], [v0, v1]) => [
        sum0 + BigInt(Math.round(v0 * 10 ** decimals0)),
        sum1 + BigInt(Math.round(v1 * 10 ** decimals1)),
      ],
      [0n, 0n],
    );
  }

  private async getEntriesForPair(
    baseAddress: Address,
    quoteAddress: Address,
    customOrderbook?: NativeOrderbookEntry[] | null,
  ): Promise<NativeOrderbookEntry[]> {
    const orderbook = customOrderbook ?? (await this.getCachedOrderbook());
    if (!orderbook) {
      return [];
    }

    const base = baseAddress.toLowerCase();
    const quote = quoteAddress.toLowerCase();

    return orderbook.filter(
      entry =>
        entry.side === 'bid' &&
        entry.base_address === base &&
        entry.quote_address === quote,
    );
  }

  private buildPoolPrices(
    entry: NativeOrderbookEntry,
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
  ): PoolPrices<NativeData> | null {
    if (!entry.levels.length) {
      return null;
    }

    const dividerSrc = getBigNumberPow(srcToken.decimals);

    const priceResults: bigint[] = new Array(amounts.length).fill(0n);
    let unitQuote: BigNumber | null = null;

    const minAmount = entry.minimum_in_base
      ? new BigNumber(entry.minimum_in_base).dividedBy(dividerSrc)
      : BN_0;

    for (const [index, amount] of amounts.entries()) {
      if (amount === 0n) {
        continue;
      }

      const amountBn = new BigNumber(amount.toString()).dividedBy(dividerSrc);
      if (minAmount.gt(0) && amountBn.lt(minAmount)) {
        return null;
      }

      const quote = this.computeSellQuote(entry, amountBn);
      if (!quote) {
        break;
      }

      priceResults[index] = this.toBigInt(quote, destToken.decimals);
    }

    unitQuote = this.computeSellQuote(entry, BN_1) || BN_0;

    return {
      exchange: this.dexKey,
      data: { quote: undefined },
      poolIdentifiers: [this.serializePoolIdentifier(entry)],
      poolAddresses: [this.routerAddress],
      gasCost: NATIVE_GAS_COST,
      prices: priceResults,
      unit: this.toBigInt(unitQuote, destToken.decimals),
    };
  }

  private computeSellQuote(
    entry: NativeOrderbookEntry,
    amount: BigNumber,
  ): BigNumber | null {
    if (amount.lte(0)) {
      return BN_0;
    }

    let remaining = amount;
    let output = new BigNumber(0);

    for (const level of entry.levels) {
      const levelAmount = new BigNumber(level[0]);
      const levelPrice = new BigNumber(level[1]);
      if (levelAmount.lte(0) || levelPrice.lte(0)) {
        continue;
      }

      const fill = BigNumber.minimum(levelAmount, remaining);
      output = output.plus(fill.multipliedBy(levelPrice));
      remaining = remaining.minus(fill);

      if (remaining.lte(0)) {
        return output;
      }
    }

    return null;
  }

  private async getCachedOrderbook(): Promise<NativeOrderbookEntry[] | null> {
    const cached = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      this.orderbookCacheKey,
      NATIVE_ORDERBOOK_POLLING_INTERVAL_MS / 1000,
    );

    if (!cached) {
      return null;
    }

    return JSON.parse(cached);
  }

  private toBigInt(amount: BigNumber, decimals: number): bigint {
    if (amount.lte(0)) {
      return 0n;
    }
    return BigInt(
      amount
        .multipliedBy(getBigNumberPow(decimals))
        .decimalPlaces(0, BigNumber.ROUND_DOWN)
        .toFixed(0),
    );
  }

  private async fetchFirmQuote(
    params: Record<string, string>,
  ): Promise<NativeFirmQuoteResponse> {
    const response =
      await this.dexHelper.httpRequest.request<NativeFirmQuoteResponse>({
        method: 'GET',
        url: `${NATIVE_API_URL}/firm-quote`,
        params,
        headers: {
          apikey: this.nativeApiKey,
        },
      });

    return response.data;
  }

  private normalizeTxRequest(txRequest: NativeTxRequest) {
    const target = txRequest.target || this.routerAddress;
    const calldata = txRequest.calldata.startsWith('0x')
      ? txRequest.calldata
      : `0x${txRequest.calldata}`;
    const value =
      txRequest.value !== undefined && txRequest.value !== null
        ? txRequest.value
        : '0';

    return {
      target,
      calldata,
      value,
    };
  }
}
