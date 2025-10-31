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
import { SimpleExchange } from '../simple-exchange';
import { RenegadeClient } from './api/renegade-client';
import {
  ExternalOrder,
  SignedExternalQuote,
  SponsoredQuoteResponse,
} from './api/types';
import { RenegadeConfig } from './config';
import {
  RENEGADE_GAS_COST,
  RENEGADE_INIT_TIMEOUT_MS,
  RENEGADE_LEVELS_CACHE_KEY,
  RENEGADE_LEVELS_CACHE_TTL_SECONDS,
  RENEGADE_NAME,
  RENEGADE_QUOTE_CACHE_KEY,
  RENEGADE_QUOTE_CACHE_TTL_SECONDS,
  RENEGADE_TOKEN_METADATA_CACHE_KEY,
  RENEGADE_TOKEN_METADATA_CACHE_TTL_SECONDS,
} from './constants';
import { RateFetcher } from './rate-fetcher';
import { RenegadeLevelsResponse } from './renegade-levels-response';
import {
  RenegadeData,
  RenegadeDepth,
  RenegadeRateFetcherConfig,
  RenegadeTx,
} from './types';

export class Renegade extends SimpleExchange implements IDex<RenegadeData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;
  readonly isStatePollingDex = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] = [
    { key: RENEGADE_NAME, networks: [Network.ARBITRUM, Network.BASE] },
  ];

  private rateFetcher: RateFetcher;
  private renegadeClient: RenegadeClient;
  private tokensMap: Record<string, Token> = {};
  private readonly apiKey: string;
  private readonly apiSecret: string;

  private usdcAddress: string;

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);

    // Ensure API credentials are set
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

    // Initialize rate fetcher with credentials and caching config
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;

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
      this.apiKey,
      this.apiSecret,
      this.logger,
    );

    this.usdcAddress = RenegadeConfig[RENEGADE_NAME][this.network].usdcAddress;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
      await sleep(RENEGADE_INIT_TIMEOUT_MS);
    }

    await this.setTokensMap();
  }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // Returns pool identifier as the Renegade API expects it.
  private getPoolIdentifier(tokenA: Address, tokenB: Address): string {
    const srcIsUSDC = this.isUSDC(tokenA);
    const baseToken = srcIsUSDC ? tokenB : tokenA;
    const quoteToken = srcIsUSDC ? tokenA : tokenB;
    return `${
      this.dexKey
    }_${baseToken.toLowerCase()}_${quoteToken.toLowerCase()}`;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap.
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.areTokensSupported(srcToken.address, destToken.address)) {
      return [];
    }
    return [this.getPoolIdentifier(srcToken.address, destToken.address)];
  }

  // Returns pool prices for amounts.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
    transferFees?: TransferFeeParams,
    isFirstSwap?: boolean,
  ): Promise<ExchangePrices<RenegadeData> | null> {
    try {
      if (amounts.length === 0) {
        return null;
      }

      if (!this.areTokensSupported(srcToken.address, destToken.address)) {
        this.logger.debug('Tokens not supported by Renegade API', {
          srcToken: srcToken.address,
          destToken: destToken.address,
        });
        return null;
      }

      // Use the last amount as reference for the quote
      const referenceAmount = amounts[amounts.length - 1].toString();

      this.logger.debug('Getting rate for amount', {
        srcToken,
        destToken,
        referenceAmount,
        side,
      });

      // Get rate from helper method
      const rate = await this.getRateForAmount(
        srcToken,
        destToken,
        referenceAmount,
        side,
      );

      // Apply rate to all amounts
      const prices = amounts.map(amount => {
        const output = new BigNumber(amount.toString()).multipliedBy(rate);
        return BigInt(
          output.decimalPlaces(0, BigNumber.ROUND_FLOOR).toFixed(0),
        );
      });

      const poolIdentifier = this.getPoolIdentifier(
        srcToken.address,
        destToken.address,
      );

      const outputDecimals =
        side === SwapSide.SELL ? destToken.decimals : srcToken.decimals;

      return [
        {
          prices,
          unit: BigInt(outputDecimals),
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

  // Helper method to construct external order, request quote, cache response, and return rate.
  private async getRateForAmount(
    srcToken: Token,
    destToken: Token,
    referenceAmount: string,
    side: SwapSide,
  ): Promise<BigNumber> {
    // Determine tokens and Renegade side
    const isRenegadeSell = this.isRenegadeSell(srcToken, destToken);

    // Determine base and quote mints (quote is always USDC)
    const isDestUSDC = this.isUSDC(destToken.address);
    const baseMint = isDestUSDC ? srcToken.address : destToken.address;
    const quoteMint = this.usdcAddress;

    const renegadeSide = isRenegadeSell ? 'Sell' : 'Buy';
    const externalOrder =
      side === SwapSide.SELL
        ? this.createUpdatedOrderForExactIn(
            quoteMint,
            baseMint,
            renegadeSide,
            referenceAmount,
          )
        : this.createUpdatedOrderForExactOut(
            quoteMint,
            baseMint,
            renegadeSide,
            referenceAmount,
          );

    // Fetch quote from Renegade API
    const quoteResponse = await this.renegadeClient.requestQuote(externalOrder);

    // Cache the signed quote for later use in preProcessTransaction
    const cacheKey = this.getQuoteCacheKey(srcToken, destToken);

    // Extract send/receive from quote
    const send = quoteResponse.signed_quote.quote.send;
    const receive = quoteResponse.signed_quote.quote.receive;

    // Determine input and output tokens for rate calculation
    const inputToken = side === SwapSide.SELL ? srcToken : destToken;

    // Identify which is input and which is output in send/receive
    const isSendInput =
      send.mint.toLowerCase() === inputToken.address.toLowerCase();
    const inputAmount = isSendInput ? send.amount : receive.amount;
    const outputAmount = isSendInput ? receive.amount : send.amount;

    // Calculate rate: output per input (in atomic units)
    const rate = new BigNumber(outputAmount).dividedBy(inputAmount);

    // Store the signed quote response directly in cache
    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      cacheKey,
      RENEGADE_QUOTE_CACHE_TTL_SECONDS,
      JSON.stringify(quoteResponse),
    );

    return rate;
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  //
  // Estimates calldata gas cost for [function sponsorAtomicMatchSettle()](https://github.com/renegade-fi/renegade-contracts/blob/c1df0e58a6fc665133540c79ef2f0c6226fa670f/src/darkpool/v1/contracts/GasSponsor.sol#L174-L189)
  getCalldataGasCost(_poolPrices: PoolPrices<RenegadeData>): number | number[] {
    // Assumptions
    const INTERNAL_PARTY_MODIFIED_SHARES_LEN = 70;
    const PLONK_PROOF_WORDS = 36;
    const LINKING_PROOF_WORDS = 4;

    const {
      ADDRESS,
      AMOUNT,
      BOOL,
      BPS,
      DEX_OVERHEAD,
      FULL_WORD,
      FUNCTION_SELECTOR,
      INDEX,
      LENGTH_SMALL,
      OFFSET_LARGE,
      UUID,
    } = CALLDATA_GAS_COST;

    const PARTY_MATCH_PAYLOAD =
      3 * INDEX + // OrderSettlementIndices
      3 * FULL_WORD; // ValidReblindStatement (3 scalars)

    const EXTERNAL_MATCH_RESULT = ADDRESS + ADDRESS + AMOUNT + AMOUNT + INDEX; // direction ~ small enum

    const FEE_TAKE = AMOUNT + AMOUNT;

    const INTERNAL_PARTY_SETTLEMENT_INDICES = 3 * INDEX;

    const VMSA_HEAD =
      EXTERNAL_MATCH_RESULT +
      FEE_TAKE +
      OFFSET_LARGE + // internal array offset
      INTERNAL_PARTY_SETTLEMENT_INDICES +
      BPS + // protocolFeeRate (approx small)
      ADDRESS; // relayerFeeAddress

    const VMSA_TAIL =
      LENGTH_SMALL + INTERNAL_PARTY_MODIFIED_SHARES_LEN * FULL_WORD;

    const VALID_MATCH_SETTLE_ATOMIC_STATEMENT =
      OFFSET_LARGE + // top-level struct offset
      VMSA_HEAD +
      VMSA_TAIL;

    const MATCH_ATOMIC_PROOFS = 3 * PLONK_PROOF_WORDS * FULL_WORD;

    const MATCH_ATOMIC_LINKING_PROOFS = 2 * LINKING_PROOF_WORDS * FULL_WORD;

    const FOOTER =
      ADDRESS + // refundAddress
      BOOL + // refundNativeEth
      AMOUNT + // refundAmount
      UUID; // nonce (approx)

    const SIGNATURE =
      OFFSET_LARGE + // bytes offset
      LENGTH_SMALL + // length (65)
      2 * FULL_WORD + // r, s
      BOOL; // v

    const total =
      DEX_OVERHEAD +
      FUNCTION_SELECTOR +
      PARTY_MATCH_PAYLOAD +
      VALID_MATCH_SETTLE_ATOMIC_STATEMENT +
      MATCH_ATOMIC_PROOFS +
      MATCH_ATOMIC_LINKING_PROOFS +
      FOOTER +
      SIGNATURE;

    return total; // ~103000 L1 gas
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: RenegadeData,
    side: SwapSide,
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

  async setTokensMap(): Promise<void> {
    const metadata = await this.getCachedTokens();

    if (metadata) {
      this.tokensMap = metadata;
    }
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // Get current price levels from cache
    const levels = await this.getCachedLevels();
    if (!levels) {
      return [];
    }

    const pools = levels.getPoolLiquidity(tokenAddress);
    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: RenegadeData,
    side: SwapSide,
  ): DexExchangeParam {
    const settlementTx = data?.settlementTx;

    if (!settlementTx) {
      throw new Error(
        `${this.dexKey}-${this.network}: settlementTx missing from data`,
      );
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: settlementTx.data,
      targetExchange: settlementTx.to,
      returnAmountPos: undefined,
      specialDexSupportsInsertFromAmount: false,
    };
  }

  // Called before getAdapterParam to use async calls and receive data if needed
  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<RenegadeData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<RenegadeData>, ExchangeTxInfo]> {
    try {
      if (!this.areTokensSupported(srcToken.address, destToken.address)) {
        throw new Error(
          `${this.dexKey}-${this.network}: Tokens not supported by Renegade API: ${srcToken.address}, ${destToken.address}`,
        );
      }

      const srcAmount = optimalSwapExchange.srcAmount;
      const destAmount = optimalSwapExchange.destAmount;

      // 1. Retrieve cached fixed signed quote for the pair (now side-specific)
      const cachedSignedQuote = await this.getCachedSignedQuote(
        srcToken,
        destToken,
      );

      if (!cachedSignedQuote) {
        throw new Error(
          `${this.dexKey}-${this.network}: No cached quote available for pair ${srcToken.address}-${destToken.address}`,
        );
      }

      // 2. Create updated order with actual amounts (preserving side and token pair)
      const baseOrder = cachedSignedQuote.quote.order;
      const updatedOrder =
        side === SwapSide.SELL
          ? this.createUpdatedOrderForExactIn(
              baseOrder.quote_mint,
              baseOrder.base_mint,
              baseOrder.side,
              srcAmount,
            )
          : this.createUpdatedOrderForExactOut(
              baseOrder.quote_mint,
              baseOrder.base_mint,
              baseOrder.side,
              destAmount,
            );

      // 3. Request calldata from Renegade API
      const response = await this.renegadeClient.assembleExternalMatch(
        cachedSignedQuote,
        {
          updated_order: updatedOrder,
        },
      );

      const settlementTxRequest = response?.match_bundle?.settlement_tx;

      assert(
        settlementTxRequest !== undefined,
        `${this.dexKey}-${this.network}: Invalid match response`,
      );

      const settlementTx: RenegadeTx = {
        to: settlementTxRequest.to || '',
        data: settlementTxRequest.data || settlementTxRequest.input || '',
        value: settlementTxRequest.value || '0',
      };

      const exchangeWithData: OptimalSwapExchange<RenegadeData> = {
        ...optimalSwapExchange,
        data: {
          settlementTx,
          rawResponse: response,
        },
      };

      return [exchangeWithData, {}];
    } catch (e: any) {
      const message = `${this.dexKey}-${this.network}: ${e}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }
  // Cleans up any resources used by the DEX.
  async releaseResources(): Promise<void> {
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.stop();
    }
  }

  // Cache

  // Get cached signed quote for a token pair and side.
  async getCachedSignedQuote(
    srcToken: Token,
    destToken: Token,
  ): Promise<SignedExternalQuote | null> {
    try {
      // Build cache key using helper method
      const cacheKey = this.getQuoteCacheKey(srcToken, destToken);

      // Check cache for existing quote
      const cachedQuote = await this.dexHelper.cache.getAndCacheLocally(
        this.dexKey,
        this.network,
        cacheKey,
        RENEGADE_QUOTE_CACHE_TTL_SECONDS,
      );

      if (cachedQuote) {
        const quoteResponse = JSON.parse(cachedQuote) as SponsoredQuoteResponse;
        return quoteResponse.signed_quote;
      }

      return null;
    } catch (e: unknown) {
      this.logger.error(
        `Error retrieving cached quote for ${srcToken.address}-${destToken.address}:`,
        e,
      );
      return null;
    }
  }

  // Get cached price levels from persistent cache.
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

  // Get cached token metadata from persistent cache.
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

  // Generate cache key for quote storage and retrieval.
  private getQuoteCacheKey(srcToken: Token, destToken: Token): string {
    // Determine Renegade side based on which token is USDC
    const isRenegadeSell = this.isRenegadeSell(srcToken, destToken);

    // Build cache key from alphabetically sorted token addresses and side
    const sortedAddresses = this._sortTokens(
      srcToken.address,
      destToken.address,
    );

    return `${RENEGADE_QUOTE_CACHE_KEY}_${sortedAddresses[0]}_${
      sortedAddresses[1]
    }_${isRenegadeSell ? 'Sell' : 'Buy'}`;
  }

  // Helpers

  // Create updated order for exact input (ParaSwap SELL side).
  // Preserves token pair and side from cached quote, updates amounts only.
  private createUpdatedOrderForExactIn(
    quoteMint: string,
    baseMint: string,
    side: 'Sell' | 'Buy',
    srcAmount: string,
  ): ExternalOrder {
    // Determine which amount field to set based on Renegade side
    // Rule: Exactly ONE sizing parameter must be non-zero
    const isRenegadeSell = side === 'Sell';

    // For exact input, we specify the input amount
    // If Renegade Sell: base is input (base_amount)
    // If Renegade Buy: quote is input (quote_amount)
    const baseAmount = isRenegadeSell ? srcAmount : '0';
    const quoteAmount = isRenegadeSell ? '0' : srcAmount;
    const minFillSize = isRenegadeSell ? srcAmount : '0';

    return {
      quote_mint: quoteMint,
      base_mint: baseMint,
      side: side,
      base_amount: baseAmount,
      quote_amount: quoteAmount,
      min_fill_size: minFillSize,
      exact_base_output: '0',
      exact_quote_output: '0',
    };
  }

  // Create updated order for exact output (ParaSwap BUY side).
  // Preserves token pair and side from cached quote, updates amounts only.
  private createUpdatedOrderForExactOut(
    quoteMint: string,
    baseMint: string,
    side: 'Sell' | 'Buy',
    destAmount: string,
  ): ExternalOrder {
    // Determine which exact output field to set based on Renegade side
    // Rule: Exactly ONE sizing parameter must be non-zero
    // Rule: When using exact outputs, min_fill_size MUST be 0
    const isRenegadeSell = side === 'Sell';

    // For exact output, we specify the output amount
    // If Renegade Sell: quote is output (exact_quote_output)
    // If Renegade Buy: base is output (exact_base_output)
    const exactQuoteOutput = isRenegadeSell ? destAmount : '0';
    const exactBaseOutput = isRenegadeSell ? '0' : destAmount;

    return {
      quote_mint: quoteMint,
      base_mint: baseMint,
      side: side,
      base_amount: '0',
      quote_amount: '0',
      min_fill_size: '0', // MUST be 0 with exact outputs
      exact_base_output: exactBaseOutput,
      exact_quote_output: exactQuoteOutput,
    };
  }

  // Check if both tokens are supported by Renegade API (exist in tokensMap).
  private areTokensSupported(
    srcTokenAddress: Address,
    destTokenAddress: Address,
  ): boolean {
    const srcTokenLower = srcTokenAddress.toLowerCase();
    const destTokenLower = destTokenAddress.toLowerCase();
    return (
      this.tokensMap[srcTokenLower] !== undefined &&
      this.tokensMap[destTokenLower] !== undefined
    );
  }

  // Determine if this is a Renegade Sell operation (base → USDC).
  private isRenegadeSell(srcToken: Token, destToken: Token): boolean {
    return this.isUSDC(destToken.address);
  }

  // Returns the token metadata for a given address.
  getTokenFromAddress(address: Address): Token {
    return this.tokensMap[address.toLowerCase()];
  }

  // Check if a token address is USDC for the current network.
  isUSDC(tokenAddress: Address): boolean {
    return tokenAddress.toLowerCase() === this.usdcAddress.toLowerCase();
  }

  // Sort token addresses alphabetically.
  private _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) => (a < b ? -1 : 1));
  }
}

// Helper function to sleep for a given time
const sleep = (time: number) =>
  new Promise(resolve => {
    setTimeout(resolve, time);
  });
