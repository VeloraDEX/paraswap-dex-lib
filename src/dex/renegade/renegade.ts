import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
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
  TransferFeeParams,
} from '../../types';
import { getBigIntPow } from '../../utils';
import { BlacklistError } from '../generic-rfq/types';
import { SimpleExchangeWithRestrictions } from '../simple-exchange-with-restrictions';
import { RenegadeClient } from './api/renegade-client';
import { ExternalOrder, SponsoredMatchResponse } from './api/types';
import { RenegadeConfig } from './config';
import {
  RENEGADE_GAS_COST,
  RENEGADE_LEVELS_CACHE_KEY,
  RENEGADE_LEVELS_CACHE_TTL_SECONDS,
  RENEGADE_NAME,
  RENEGADE_SETTLEMENT_BUNDLE_DATA_WORDS,
  RENEGADE_SETTLE_EXTERNAL_MATCH_AMOUNT_IN_POS,
  RENEGADE_TOKEN_METADATA_CACHE_KEY,
  RENEGADE_TOKEN_METADATA_CACHE_TTL_SECONDS,
} from './constants';
import { RateFetcher } from './rate-fetcher';
import { RenegadeLevelsResponse } from './renegade-levels-response';
import {
  RenegadeData,
  RenegadeDepth,
  RenegadeMidpointDepth,
  RenegadePriceLevel,
  RenegadeRateFetcherConfig,
  RenegadeTx,
} from './types';

export class Renegade
  extends SimpleExchangeWithRestrictions
  implements IDex<RenegadeData>
{
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;
  readonly isStatePollingDex = true;
  readonly needsSequentialPreprocessing = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] = [
    { key: RENEGADE_NAME, networks: [Network.ARBITRUM, Network.BASE] },
  ];

  private rateFetcher: RateFetcher;
  private renegadeClient: RenegadeClient;
  private tokensMap: Record<string, Token> = {};

  private usdcAddress: string;

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey, { enablePairRestriction: true });
    this.logger = dexHelper.getLogger(dexKey);

    const apiKey = this.dexHelper.config.data.renegadeAuthApiKey;
    const apiSecret = this.dexHelper.config.data.renegadeAuthApiSecret;

    assert(
      apiKey !== undefined,
      'Renegade API key is not specified with env variable API_KEY_RENEGADE_AUTH_API_KEY',
    );

    assert(
      apiSecret !== undefined,
      'Renegade API secret is not specified with env variable API_KEY_RENEGADE_AUTH_API_SECRET',
    );

    const rateFetcherConfig: RenegadeRateFetcherConfig = {
      apiKey,
      apiSecret,
      levelsCacheKey: RENEGADE_LEVELS_CACHE_KEY,
      levelsCacheTTL: RENEGADE_LEVELS_CACHE_TTL_SECONDS,
      tokenMetadataCacheKey: RENEGADE_TOKEN_METADATA_CACHE_KEY,
      tokenMetadataCacheTTL: RENEGADE_TOKEN_METADATA_CACHE_TTL_SECONDS,
    };

    this.rateFetcher = new RateFetcher(
      this.dexHelper,
      this.dexKey,
      this.network,
      this.logger,
      rateFetcherConfig,
    );

    this.renegadeClient = new RenegadeClient(
      this.dexHelper,
      this.network,
      apiKey,
      apiSecret,
      this.logger,
    );

    this.usdcAddress = RenegadeConfig[RENEGADE_NAME][this.network].usdcAddress;
  }

  async initializePricing(_blockNumber: number): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
      await this.rateFetcher.fetchOnce();
    }

    await this.setTokensMap();
  }

  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (!this.areTokensSupported(srcToken.address, destToken.address)) {
      return [];
    }
    return [this.getPoolIdentifier(srcToken.address, destToken.address)];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    _blockNumber: number,
    limitPools?: string[],
    _transferFees?: TransferFeeParams,
    _isFirstSwap?: boolean,
  ): Promise<ExchangePrices<RenegadeData> | null> {
    try {
      if (amounts.length === 0) {
        return null;
      }

      if (!this.areTokensSupported(srcToken.address, destToken.address)) {
        return null;
      }

      const poolIdentifier = this.getPoolIdentifier(
        srcToken.address,
        destToken.address,
      );
      if (limitPools && !limitPools.includes(poolIdentifier)) {
        return null;
      }

      const levels = await this.getCachedLevels();
      if (!levels) {
        return null;
      }

      const prices = this.computePricesFromCachedLevels(
        levels,
        srcToken,
        destToken,
        amounts,
        side,
      );

      if (!prices) {
        return null;
      }

      const outputDecimals =
        side === SwapSide.SELL ? destToken.decimals : srcToken.decimals;

      return [
        {
          prices,
          unit: getBigIntPow(outputDecimals),
          data: {},
          poolIdentifiers: [poolIdentifier],
          exchange: this.dexKey,
          gasCost: RENEGADE_GAS_COST,
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

  getCalldataGasCost(_poolPrices: PoolPrices<RenegadeData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      CALLDATA_GAS_COST.AMOUNT + // externalPartyAmountIn
      CALLDATA_GAS_COST.ADDRESS + // recipient
      CALLDATA_GAS_COST.ADDRESS * 2 + // internalPartyInputToken, internalPartyOutputToken
      CALLDATA_GAS_COST.FULL_WORD + // price.repr
      CALLDATA_GAS_COST.AMOUNT * 2 + // minInternalPartyAmountIn, maxInternalPartyAmountIn
      CALLDATA_GAS_COST.TIMESTAMP + // blockDeadline
      CALLDATA_GAS_COST.OFFSET_LARGE + // SettlementBundle top-level offset
      CALLDATA_GAS_COST.BOOL + // isFirstFill
      CALLDATA_GAS_COST.INDEX + // bundleType
      CALLDATA_GAS_COST.OFFSET_SMALL + // SettlementBundle.data offset
      CALLDATA_GAS_COST.LENGTH_LARGE + // representative bytes length (~1056 bytes)
      RENEGADE_SETTLEMENT_BUNDLE_DATA_WORDS * CALLDATA_GAS_COST.FULL_WORD
    );
  }

  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    data: RenegadeData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    const settlementTx = data?.settlementTx;

    if (!settlementTx) {
      throw new Error(
        `${this.dexKey}-${this.network}: settlementTx missing from data`,
      );
    }

    return {
      targetExchange: settlementTx.to,
      payload: settlementTx.data,
      networkFee: settlementTx.value,
    };
  }

  async updatePoolState(): Promise<void> {
    await this.setTokensMap();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const levels = await this.getCachedLevels();
    if (!levels) return [];
    await this.setTokensMap();

    const normalizedTokenAddress = tokenAddress.toLowerCase();
    const normalizedUsdcAddress = this.usdcAddress.toLowerCase();

    const directionalLiquidity = levels.getDirectionalLiquidityForToken(
      normalizedTokenAddress,
      normalizedUsdcAddress,
    );

    const results: PoolLiquidity[] = [];

    for (const liquidityData of directionalLiquidity) {
      const {
        baseToken,
        outboundLiquidityUSD,
        reverseLiquidityUSD,
        isTokenBase,
      } = liquidityData;

      const connectorAddress = isTokenBase ? normalizedUsdcAddress : baseToken;
      const connectorMeta = this.tokensMap[connectorAddress];

      if (!connectorMeta) {
        continue;
      }

      results.push({
        exchange: this.dexKey,
        address: baseToken,
        connectorTokens: [
          {
            address: connectorAddress,
            decimals: connectorMeta.decimals,
            symbol: connectorMeta.symbol,
            liquidityUSD: reverseLiquidityUSD,
          },
        ],
        liquidityUSD: outboundLiquidityUSD,
      });
    }

    return results
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  getDexParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    data: RenegadeData,
    side: SwapSide,
  ): DexExchangeParam {
    const settlementTx = data?.settlementTx;

    if (!settlementTx) {
      throw new Error(
        `${this.dexKey}-${this.network}: settlementTx missing from data`,
      );
    }

    // BUY path should preserve assembled calldata amount to avoid forcing execution at
    // Augustus max-in (`fromAmount`) instead of quoted amount.
    const disableRuntimeAmountInsertion = side === SwapSide.BUY;
    const insertFromAmountPos = !disableRuntimeAmountInsertion
      ? RENEGADE_SETTLE_EXTERNAL_MATCH_AMOUNT_IN_POS
      : undefined;

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: settlementTx.data,
      targetExchange: settlementTx.to,
      returnAmountPos: undefined,
      // settleExternalMatch(uint256,address,...) has externalPartyAmountIn as the
      // first argument after the selector, so Augustus can patch at byte offset 4.
      insertFromAmountPos,
      swappedAmountNotPresentInExchangeData: disableRuntimeAmountInsertion,
    };
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<RenegadeData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<RenegadeData>, ExchangeTxInfo]> {
    try {
      await this.assertAddressesNotBlacklisted(options);
      this.assertPairSupported(srcToken.address, destToken.address);

      const externalOrder = this.createExternalOrder(
        srcToken,
        destToken,
        side,
        optimalSwapExchange.srcAmount,
        optimalSwapExchange.destAmount,
      );
      const matchResponse = await this.renegadeClient.requestExternalMatch(
        externalOrder,
      );
      const { settlementTx, deadline } = this.parseMatchBundle(matchResponse);
      const executionSrcAmount =
        side === SwapSide.BUY
          ? this.getExternalPartyAmountInFromCalldata(
              settlementTx.data,
              optimalSwapExchange.srcAmount,
            )
          : optimalSwapExchange.srcAmount;

      return [
        {
          ...optimalSwapExchange,
          srcAmount: executionSrcAmount,
          data: {
            settlementTx,
            rawResponse: matchResponse,
          },
        },
        { deadline },
      ];
    } catch (e: any) {
      if (this.isPairRejection(e)) {
        this.logger.warn(
          `${this.dexKey}-${this.network}: protocol is restricted for pair ${srcToken.address} -> ${destToken.address}`,
        );
        await this.restrictPair(srcToken.address, destToken.address);
      }

      this.logger.error(`${this.dexKey}-${this.network}: ${e}`);
      throw e;
    }
  }

  async releaseResources(): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.stop();
    }
  }

  getTokenFromAddress(address: Address): Token {
    return this.tokensMap[address.toLowerCase()];
  }

  private async assertAddressesNotBlacklisted(
    options: PreprocessTransactionOptions,
  ): Promise<void> {
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
  }

  // Returns true only for errors that indicate the pair itself is invalid
  // (4xx responses). Transient failures (timeouts, 5xx) must not restrict pairs.
  private isPairRejection(e: any): boolean {
    if (e?.isSlippageError || e?.isBlacklistError || e?.isNoMatchError) {
      return false;
    }
    const status = e?.response?.status;
    return status >= 400 && status < 500;
  }

  private assertPairSupported(srcToken: Address, destToken: Address): void {
    if (!this.areTokensSupported(srcToken, destToken)) {
      throw new Error(
        `${this.dexKey}-${this.network}: Tokens not supported by Renegade API: ${srcToken}, ${destToken}`,
      );
    }
  }

  private parseMatchBundle(response: SponsoredMatchResponse): {
    settlementTx: RenegadeTx;
    deadline?: bigint;
  } {
    const bundle = response?.match_bundle;
    const tx = bundle?.settlement_tx;
    const txData = tx?.data || tx?.input;
    if (!tx?.to || !txData) {
      const err: any = new Error(
        `${this.dexKey}-${this.network}: Invalid match response`,
      );
      err.isNoMatchError = true;
      throw err;
    }

    return {
      settlementTx: {
        to: tx.to,
        data: txData,
        value: tx.value || '0',
      },
      deadline:
        bundle.deadline != null
          ? BigInt(bundle.deadline.toString())
          : undefined,
    };
  }

  private createExternalOrder(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    srcAmount: string,
    destAmount: string,
  ): ExternalOrder {
    const isBuy = side === SwapSide.BUY;

    return {
      input_mint: srcToken.address,
      output_mint: destToken.address,
      input_amount: isBuy ? '0' : srcAmount,
      output_amount: isBuy ? destAmount : '0',
      use_exact_output_amount: isBuy,
      min_fill_size: isBuy ? '0' : srcAmount,
    };
  }

  private getExternalPartyAmountInFromCalldata(
    calldata: string,
    fallbackAmount: string,
  ): string {
    const data = calldata.startsWith('0x') ? calldata.slice(2) : calldata;
    const selectorAndFirstWordHexLength = 8 + 64;

    if (data.length < selectorAndFirstWordHexLength) {
      return fallbackAmount;
    }

    try {
      return BigInt(
        `0x${data.slice(8, selectorAndFirstWordHexLength)}`,
      ).toString();
    } catch {
      return fallbackAmount;
    }
  }

  async setTokensMap(): Promise<void> {
    const metadata = await this.getCachedTokens();
    if (metadata) {
      this.tokensMap = metadata;
    }
  }

  private getPoolIdentifier(tokenA: Address, tokenB: Address): string {
    const sorted = this._sortTokens(tokenA, tokenB);
    return `${
      this.dexKey
    }_${sorted[0].toLowerCase()}_${sorted[1].toLowerCase()}`;
  }

  private computePricesFromCachedLevels(
    levels: RenegadeLevelsResponse,
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
  ): bigint[] | null {
    const baseToken = this.isUSDC(srcToken.address) ? destToken : srcToken;
    const quoteToken = this.isUSDC(srcToken.address) ? srcToken : destToken;
    const depth = levels.getPairDepth(baseToken.address, quoteToken.address);
    if (!depth) {
      return null;
    }

    const midpointDepth = this.getMidpointDepth(depth);
    if (!midpointDepth) {
      return null;
    }

    return amounts.map(amount => {
      if (amount === 0n) {
        return 0n;
      }

      let rawAmount: bigint;
      if (side === SwapSide.SELL) {
        rawAmount = this.computeSellQuote(
          midpointDepth,
          srcToken,
          destToken,
          amount.toString(),
        );
      } else {
        rawAmount = this.computeBuyQuote(
          midpointDepth,
          srcToken,
          destToken,
          amount.toString(),
        );
      }

      return rawAmount;
    });
  }

  private computeSellQuote(
    midpointDepth: RenegadeMidpointDepth,
    srcToken: Token,
    destToken: Token,
    srcAmountAtomic: string,
  ): bigint {
    const srcAmount = this.toNominal(srcAmountAtomic, srcToken.decimals);
    const srcIsQuote = this.isUSDC(srcToken.address);

    if (srcIsQuote) {
      const sellQuoteCapacity = midpointDepth.sellBaseCapacity.multipliedBy(
        midpointDepth.price,
      );
      if (srcAmount.gt(sellQuoteCapacity)) {
        return 0n;
      }

      return this.toAtomicFloor(
        srcAmount.dividedBy(midpointDepth.price),
        destToken.decimals,
      );
    }

    if (srcAmount.gt(midpointDepth.buyBaseCapacity)) {
      return 0n;
    }

    return this.toAtomicFloor(
      srcAmount.multipliedBy(midpointDepth.price),
      destToken.decimals,
    );
  }

  private computeBuyQuote(
    midpointDepth: RenegadeMidpointDepth,
    srcToken: Token,
    destToken: Token,
    destAmountAtomic: string,
  ): bigint {
    const destAmount = this.toNominal(destAmountAtomic, destToken.decimals);
    const srcIsQuote = this.isUSDC(srcToken.address);

    if (srcIsQuote) {
      if (destAmount.gt(midpointDepth.sellBaseCapacity)) {
        return 0n;
      }

      return this.toAtomicCeil(
        destAmount.multipliedBy(midpointDepth.price),
        srcToken.decimals,
      );
    }

    const buyQuoteCapacity = midpointDepth.buyBaseCapacity.multipliedBy(
      midpointDepth.price,
    );
    if (destAmount.gt(buyQuoteCapacity)) {
      return 0n;
    }

    return this.toAtomicCeil(
      destAmount.dividedBy(midpointDepth.price),
      srcToken.decimals,
    );
  }

  private getMidpointDepth(depth: RenegadeDepth): RenegadeMidpointDepth | null {
    const bidLevel = this.parsePriceLevel(depth.bids[0]);
    const askLevel = this.parsePriceLevel(depth.asks[0]);
    const price = askLevel?.price ?? bidLevel?.price;

    if (!price || price.lte(0)) {
      return null;
    }

    if (bidLevel && askLevel && !bidLevel.price.eq(askLevel.price)) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: midpoint depth sides disagree on price`,
        {
          bidPrice: bidLevel.price.toString(),
          askPrice: askLevel.price.toString(),
        },
      );
    }

    return {
      price,
      buyBaseCapacity: bidLevel?.size ?? new BigNumber(0),
      sellBaseCapacity: askLevel?.size ?? new BigNumber(0),
    };
  }

  private parsePriceLevel(
    level: RenegadePriceLevel | undefined,
  ): { price: BigNumber; size: BigNumber } | null {
    if (!level) {
      return null;
    }

    const [priceStr, sizeStr] = level;
    const price = new BigNumber(priceStr);
    const size = new BigNumber(sizeStr);

    if (!price.isFinite() || !size.isFinite() || price.lte(0) || size.lte(0)) {
      return null;
    }

    return { price, size };
  }

  private toNominal(amountAtomic: string, decimals: number): BigNumber {
    return new BigNumber(amountAtomic).dividedBy(this.pow10(decimals));
  }

  private toAtomicFloor(amountNominal: BigNumber, decimals: number): bigint {
    return BigInt(
      amountNominal
        .multipliedBy(this.pow10(decimals))
        .decimalPlaces(0, BigNumber.ROUND_FLOOR)
        .toFixed(0),
    );
  }

  private toAtomicCeil(amountNominal: BigNumber, decimals: number): bigint {
    return BigInt(
      amountNominal
        .multipliedBy(this.pow10(decimals))
        .decimalPlaces(0, BigNumber.ROUND_CEIL)
        .toFixed(0),
    );
  }

  private pow10(decimals: number): BigNumber {
    return new BigNumber(10).pow(decimals);
  }

  async getCachedLevels(): Promise<RenegadeLevelsResponse | null> {
    const cachedLevels = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      RENEGADE_LEVELS_CACHE_KEY,
      RENEGADE_LEVELS_CACHE_TTL_SECONDS,
    );

    if (cachedLevels) {
      const rawData = JSON.parse(cachedLevels) as {
        [pairIdentifier: string]: RenegadeDepth;
      };
      return new RenegadeLevelsResponse(rawData);
    }

    return null;
  }

  async getCachedTokens(): Promise<Record<string, Token> | null> {
    const cachedTokens = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      RENEGADE_TOKEN_METADATA_CACHE_KEY,
      RENEGADE_TOKEN_METADATA_CACHE_TTL_SECONDS,
    );

    if (cachedTokens) {
      return JSON.parse(cachedTokens) as Record<string, Token>;
    }

    return null;
  }

  private areTokensSupported(
    srcTokenAddress: Address,
    destTokenAddress: Address,
  ): boolean {
    const srcTokenLower = srcTokenAddress.toLowerCase();
    const destTokenLower = destTokenAddress.toLowerCase();

    const srcTokenExists = this.tokensMap[srcTokenLower] !== undefined;
    const destTokenExists = this.tokensMap[destTokenLower] !== undefined;

    if (!srcTokenExists || !destTokenExists) {
      return false;
    }

    const srcIsUSDC = this.isUSDC(srcTokenAddress);
    const destIsUSDC = this.isUSDC(destTokenAddress);
    return srcIsUSDC !== destIsUSDC;
  }

  isUSDC(tokenAddress: Address): boolean {
    return tokenAddress.toLowerCase() === this.usdcAddress.toLowerCase();
  }

  private _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) =>
      a.toLowerCase() < b.toLowerCase() ? -1 : 1,
    );
  }
}
