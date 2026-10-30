import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { getBigNumberPow } from '../../bignumber-constants';
import { Network, NULL_ADDRESS, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IDex } from '../../dex/idex';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  ExchangeTxInfo,
  GetDexParamOptions,
  Logger,
  NumberAsString,
  OptimalSwapExchange,
  PoolLiquidity,
  PoolPrices,
  PreprocessTransactionOptions,
  Token,
} from '../../types';
import { getDexKeysWithNetwork } from '../../utils';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { SimpleExchangeWithRestrictions } from '../simple-exchange-with-restrictions';
import { resolvePreProcessedData } from '../preprocess-in-dex-param';
import { BlacklistError, SlippageCheckError } from '../generic-rfq/types';
import { LiquoriceConfig } from './config';
import {
  LIQUORICE_API_URL,
  LIQUORICE_FIRM_QUOTE_TIMEOUT_MS,
  LIQUORICE_PRICES_CACHE_KEY,
  LIQUORICE_PRICES_POLLING_INTERVAL_MS,
  LIQUORICE_TOKENS_CACHE_KEY,
  LIQUORICE_TOKENS_POLLING_INTERVAL_MS,
} from './constants';
import { bestQuote, curveDepth } from './pricing';
import { RateFetcher } from './rate-fetcher';
import {
  DexParams,
  LiquoriceCurve,
  LiquoriceData,
  LiquoriceFirmRequest,
  LiquoriceFirmResponse,
  LiquoriceToken,
} from './types';

type PricesBook = Record<string, { curves: LiquoriceCurve[] }>;

// Firm-quote failures that reflect the market or the user, not a broken venue
const NON_RESTRICTING_STATUSES = new Set([403, 404, 422]);

const isNonZeroAddress = (address?: Address): address is Address =>
  !!address && address.toLowerCase() !== NULL_ADDRESS;

export class Liquorice
  extends SimpleExchangeWithRestrictions
  implements IDex<LiquoriceData>
{
  readonly isStatePollingDex = true;
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;
  // A route can hold two Liquorice legs; their firm quotes must not race
  readonly needsSequentialPreprocessing = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(LiquoriceConfig);

  protected logger: Logger;
  private readonly config: DexParams;
  private readonly apiKey: string;
  private rateFetcher: RateFetcher;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey, {
      enableDexRestriction: true,
      restrictCountThreshold: 10,
    });

    const config = LiquoriceConfig[dexKey]?.[network];
    assert(config, `${dexKey}-${network}: missing network configuration`);
    this.config = config;

    this.logger = dexHelper.getLogger(`${dexKey}-${network}`);

    const apiKey = dexHelper.config.data.liquoriceApiKey;
    assert(
      apiKey && apiKey.length > 0,
      'Liquorice API key is not specified. Please set API_KEY_LIQUORICE',
    );
    this.apiKey = apiKey;

    const request = (path: string) => ({
      url: `${LIQUORICE_API_URL}/${path}`,
      headers: { 'x-api-key': this.apiKey },
      params: { chainId: network },
    });

    this.rateFetcher = new RateFetcher(dexKey, dexHelper, this.logger, {
      pricesReqParams: request('prices'),
      tokensReqParams: request('tokens'),
      blacklistReqParams: request('blacklist'),
      setBlacklist: this.setBlacklist.bind(this),
    });
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

  private poolIdentifier(src: Address, dest: Address): string {
    return `${this.dexKey}_${src}_${dest}`.toLowerCase();
  }

  private pairKey(src: Address, dest: Address): string {
    return `${src}_${dest}`.toLowerCase();
  }

  // ETH is quoted as WETH (needWrapNative); returns null for a same-token pair
  private wrapPair(srcToken: Token, destToken: Token): [Token, Token] | null {
    const src = this.dexHelper.config.wrapETH(srcToken);
    const dest = this.dexHelper.config.wrapETH(destToken);
    if (src.address.toLowerCase() === dest.address.toLowerCase()) return null;

    return [src, dest];
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const pair = this.wrapPair(srcToken, destToken);
    if (!pair) return [];
    const [src, dest] = pair;

    const book = await this.getCachedBook();
    if (!book?.[this.pairKey(src.address, dest.address)]?.curves.length) {
      return [];
    }

    return [this.poolIdentifier(src.address, dest.address)];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    _blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<LiquoriceData> | null> {
    if (side === SwapSide.BUY) return null;

    const pair = this.wrapPair(srcToken, destToken);
    if (!pair) return null;
    const [src, dest] = pair;

    const poolIdentifier = this.poolIdentifier(src.address, dest.address);
    if (limitPools && !limitPools.includes(poolIdentifier)) return null;

    const book = await this.getCachedBook();
    const curves = book?.[this.pairKey(src.address, dest.address)]?.curves;
    if (!curves?.length) return null;

    const srcUnit = getBigNumberPow(src.decimals);
    const destUnit = getBigNumberPow(dest.decimals);
    const toDest = (quote: BigNumber | null) =>
      quote
        ? BigInt(
            quote
              .times(destUnit)
              .decimalPlaces(0, BigNumber.ROUND_DOWN)
              .toFixed(0),
          )
        : 0n;

    const prices = amounts.map(amount =>
      amount === 0n
        ? 0n
        : toDest(
            bestQuote(
              curves,
              new BigNumber(amount.toString()).div(srcUnit),
              side,
            ),
          ),
    );

    if (prices.every(price => price === 0n)) return null;

    return [
      {
        exchange: this.dexKey,
        data: {},
        poolIdentifiers: [poolIdentifier],
        poolAddresses: [this.config.settlementAddress],
        targetExchange: this.config.settlementAddress,
        gasCost: this.config.gasCost,
        prices,
        unit: toDest(this.unitQuote(curves, side)),
      },
    ];
  }

  // Quote for one src token. When no maker quotes exactly one token (its
  // minimum is higher, or its depth lower), scale the quote for the smallest
  // size some maker accepts.
  private unitQuote(
    curves: LiquoriceCurve[],
    side: SwapSide,
  ): BigNumber | null {
    const one = new BigNumber(1);
    const direct = bestQuote(curves, one, side);
    if (direct) return direct;

    const smallest = BigNumber.min(...curves.map(c => c.minAmount));
    const quote = bestQuote(curves, smallest, side);

    return quote ? quote.div(smallest) : null;
  }

  // Shape of LiquoriceSettlement.settle(signer, filledTakerAmount, order,
  // interactions, hooks, makerSignature, takerSignature)
  getCalldataGasCost(_: PoolPrices<LiquoriceData>): number | number[] {
    const tokenData =
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.AMOUNT * 4 +
      CALLDATA_GAS_COST.BOOL;
    const signature = (bytesWords: number) =>
      CALLDATA_GAS_COST.OFFSET_SMALL +
      CALLDATA_GAS_COST.INDEX * 2 + // signatureType, transferCommand
      CALLDATA_GAS_COST.OFFSET_SMALL +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.FULL_WORD * bytesWords;

    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.ADDRESS + // signer
      CALLDATA_GAS_COST.AMOUNT + // filledTakerAmount
      CALLDATA_GAS_COST.OFFSET_SMALL * 4 + // order, interactions, hooks, sigs
      CALLDATA_GAS_COST.OFFSET_SMALL +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.FULL_WORD * 2 + // rfqId
      CALLDATA_GAS_COST.FULL_WORD + // nonce
      CALLDATA_GAS_COST.ADDRESS * 3 + // trader, effectiveTrader, recipient
      CALLDATA_GAS_COST.TIMESTAMP + // quoteExpiry
      CALLDATA_GAS_COST.AMOUNT + // minFillAmount
      CALLDATA_GAS_COST.INDEX + // makerFlags
      tokenData * 2 + // baseTokenData, quoteTokenData
      CALLDATA_GAS_COST.LENGTH_SMALL + // interactions
      CALLDATA_GAS_COST.OFFSET_SMALL * 2 +
      CALLDATA_GAS_COST.LENGTH_SMALL * 2 + // hooks
      signature(3) + // maker signature (65 bytes)
      signature(0) // empty taker signature
    );
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<LiquoriceData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<LiquoriceData>, ExchangeTxInfo]> {
    for (const address of [options.txOrigin, options.userAddress]) {
      if (isNonZeroAddress(address) && (await this.isBlacklisted(address))) {
        this.logger.warn(
          `${this.dexKey}-${this.network}: blacklisted address '${address}' trying to build a transaction. Bailing...`,
        );
        throw new BlacklistError(this.dexKey, this.network, address);
      }
    }

    if (side === SwapSide.BUY) {
      throw new Error(`${this.dexKey}-${this.network}: BUY not supported`);
    }

    // The executor is the order's effectiveTrader and must be msg.sender of
    // the settlement; without it there is nothing to quote for.
    if (!isNonZeroAddress(options.executionContractAddress)) {
      throw new Error(
        `${this.dexKey}-${this.network}: missing executionContractAddress`,
      );
    }

    const pair = this.wrapPair(srcToken, destToken);
    assert(pair, `${this.dexKey}-${this.network}: same-token swap`);
    const [src, dest] = pair;

    const request: LiquoriceFirmRequest = {
      chainId: this.network,
      srcToken: src.address.toLowerCase(),
      destToken: dest.address.toLowerCase(),
      side: 'SELL',
      amount: optimalSwapExchange.srcAmount,
      expectedAmount: optimalSwapExchange.destAmount,
      slippageFactor: options.slippageFactor.toFixed(),
      executionContract: options.executionContractAddress.toLowerCase(),
      recipient: options.recipient.toLowerCase(),
      ...(isNonZeroAddress(options.userAddress)
        ? { userAddress: options.userAddress.toLowerCase() }
        : {}),
      ...(isNonZeroAddress(options.txOrigin)
        ? { txOrigin: options.txOrigin.toLowerCase() }
        : {}),
      ...(options.partner ? { partner: options.partner } : {}),
    };

    try {
      const quote = await this.fetchFirmQuote(request);
      this.validateFirmQuote(quote, request);

      const requiredAmountWithSlippage = new BigNumber(
        optimalSwapExchange.destAmount,
      )
        .times(options.slippageFactor)
        .toFixed(0);

      if (BigInt(quote.destAmount) < BigInt(requiredAmountWithSlippage)) {
        throw new SlippageCheckError(
          this.dexKey,
          this.network,
          side,
          requiredAmountWithSlippage,
          quote.destAmount,
          options.slippageFactor,
        );
      }

      return [
        {
          ...optimalSwapExchange,
          destAmount: quote.destAmount,
          data: { quote },
        },
        { deadline: BigInt(quote.expiry) },
      ];
    } catch (e: any) {
      const status: number | undefined = e?.response?.status;
      const body = e?.response?.data;
      const message = body?.code
        ? `${status} ${body.code}: ${body.message}`
        : e instanceof Error
        ? `${e.name}: ${e.message}`
        : String(e);

      this.logger.error(
        `${this.dexKey}-${this.network}: firm quote failed for ${JSON.stringify(
          request,
        )}: ${message}`,
      );

      if (e?.isSlippageError) throw e;

      if (status === 403) {
        if (request.userAddress) {
          await this.addBlacklistedAddress(request.userAddress);
        }
        throw new BlacklistError(
          this.dexKey,
          this.network,
          request.userAddress ?? request.txOrigin ?? NULL_ADDRESS,
        );
      }

      if (status === undefined || !NON_RESTRICTING_STATUSES.has(status)) {
        this.restrict(message);
      }

      throw new Error(`${this.dexKey}-${this.network}: ${message}`);
    }
  }

  private async fetchFirmQuote(
    request: LiquoriceFirmRequest,
  ): Promise<LiquoriceFirmResponse> {
    const response =
      await this.dexHelper.httpRequest.request<LiquoriceFirmResponse>({
        method: 'POST',
        url: `${LIQUORICE_API_URL}/firm`,
        data: request,
        headers: { 'x-api-key': this.apiKey },
        timeout: LIQUORICE_FIRM_QUOTE_TIMEOUT_MS,
      });

    return response.data;
  }

  // The firm quote moves the user's tokens, so never trust the target and the
  // spender from the API: they must be our own settlement contracts.
  private validateFirmQuote(
    quote: LiquoriceFirmResponse,
    request: LiquoriceFirmRequest,
  ) {
    const fail = (reason: string) => {
      throw new Error(`invalid firm quote: ${reason}`);
    };
    const eq = (a: string | undefined, b: string) =>
      !!a && a.toLowerCase() === b.toLowerCase();

    if (!eq(quote?.to, this.config.settlementAddress)) {
      fail(`unexpected target ${quote?.to}`);
    }
    if (!eq(quote.spender, this.config.balanceManagerAddress)) {
      fail(`unexpected spender ${quote.spender}`);
    }
    if (typeof quote.data !== 'string' || !/^0x[0-9a-f]+$/i.test(quote.data)) {
      fail('missing calldata');
    }
    if (quote.value && quote.value !== '0') fail('non-zero value');
    if (quote.srcAmount !== request.amount) {
      fail(`srcAmount ${quote.srcAmount} != requested ${request.amount}`);
    }
    if (!/^\d+$/.test(quote.destAmount)) fail('invalid destAmount');
    if (!Number.isInteger(quote.expiry)) fail('invalid expiry');

    if (quote.partialFill) {
      const pos = quote.partialFill.amountInPos;
      const dataBytes = (quote.data.length - 2) / 2;
      if (!Number.isInteger(pos) || pos < 4 || pos + 32 > dataBytes) {
        fail(`amountInPos ${pos} out of range`);
      }
      if (pos > 0xffff) fail(`amountInPos ${pos} exceeds uint16`);
    }
  }

  getAdapterParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _data: LiquoriceData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    throw new Error(`${this.dexKey}: V5 is not supported`);
  }

  async getDexParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    data: LiquoriceData,
    side: SwapSide,
    _executorAddress: Address,
    options?: GetDexParamOptions,
  ): Promise<DexExchangeParam> {
    const { data: resolved, minDeadline } = await resolvePreProcessedData({
      dexKey: this.dexKey,
      data,
      side,
      isPreProcessed:
        !!data.quote?.data && !!data.quote?.to && !!data.quote?.spender,
      preProcessTransaction: this.preProcessTransaction.bind(this),
      options,
    });

    const quote = resolved.quote;
    assert(quote, `${this.dexKey}-${this.network}: missing firm quote`);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: quote.data,
      targetExchange: quote.to,
      spender: quote.spender,
      returnAmountPos: undefined,
      ...(quote.partialFill
        ? {
            insertFromAmountPos: quote.partialFill.amountInPos,
            sendEthButSupportsInsertFromAmount: true,
          }
        : { swappedAmountNotPresentInExchangeData: true }),
      ...(minDeadline !== undefined ? { minDeadline } : {}),
    };
  }

  async updatePoolState(): Promise<void> {}

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const [book, tokens] = await Promise.all([
      this.getCachedBook(),
      this.getCachedTokens(),
    ]);
    if (!book || !tokens) return [];

    const token = this.dexHelper.config
      .wrapETH({ address: tokenAddress, decimals: 18 })
      .address.toLowerCase();

    const toUnits = (amount: BigNumber, decimals: number) =>
      BigInt(
        amount
          .times(getBigNumberPow(decimals))
          .decimalPlaces(0, BigNumber.ROUND_DOWN)
          .toFixed(0),
      );

    // One pool per counterparty token, keeping the deepest direction
    const pools = new Map<Address, PoolLiquidity>();

    for (const [key, { curves }] of Object.entries(book)) {
      const [src, dest] = key.split('_');
      if (src !== token && dest !== token) continue;

      const srcToken = tokens[src];
      const destToken = tokens[dest];
      if (!srcToken || !destToken || !curves.length) continue;

      // Deepest single maker, since one maker fills a whole leg
      const depth = curves
        .map(curveDepth)
        .reduce((a, b) => (b.src.gt(a.src) ? b : a));

      const [srcUsd, destUsd] = await this.dexHelper.getUsdTokenAmounts([
        [src, toUnits(depth.src, srcToken.decimals)],
        [dest, toUnits(depth.dest, destToken.decimals)],
      ]);

      const isSrc = src === token;
      const connector: LiquoriceToken = isSrc ? destToken : srcToken;
      const pool: PoolLiquidity = {
        exchange: this.dexKey,
        address: this.config.settlementAddress,
        connectorTokens: [
          {
            address: connector.address,
            decimals: connector.decimals,
            liquidityUSD: isSrc ? destUsd : srcUsd,
          },
        ],
        liquidityUSD: isSrc ? srcUsd : destUsd,
      };

      const existing = pools.get(connector.address);
      if (!existing || pool.liquidityUSD > existing.liquidityUSD) {
        pools.set(connector.address, pool);
      }
    }

    return [...pools.values()]
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  private async getCachedBook(): Promise<PricesBook | null> {
    const cached = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      LIQUORICE_PRICES_CACHE_KEY,
      LIQUORICE_PRICES_POLLING_INTERVAL_MS / 1000,
    );

    return cached ? (JSON.parse(cached) as PricesBook) : null;
  }

  private async getCachedTokens(): Promise<Record<
    Address,
    LiquoriceToken
  > | null> {
    const cached = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      LIQUORICE_TOKENS_CACHE_KEY,
      LIQUORICE_TOKENS_POLLING_INTERVAL_MS / 1000,
    );

    return cached ? JSON.parse(cached) : null;
  }
}
