import BigNumber from 'bignumber.js';
import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { RequestConfig } from '../../dex-helper/irequest-wrapper';
import { Fetcher, RequestInfo } from '../../lib/fetcher/fetcher';
import { Logger, Token } from '../../types';
import { generateRenegadeAuthHeaders } from './api/auth';
import {
  buildRenegadeApiUrl,
  RENEGADE_MARKETS_DEPTH_ENDPOINT,
  RENEGADE_LEVELS_POLLING_INTERVAL,
  RENEGADE_TOKEN_MAPPINGS_BASE_URL,
  RENEGADE_TOKEN_METADATA_POLLING_INTERVAL,
} from './constants';
import { RenegadeLevelsResponse } from './renegade-levels-response';
import {
  RenegadeDepth,
  RenegadeMarketSideDepth,
  RenegadeMarketDepthsResponse,
  RenegadeRateFetcherConfig,
  RenegadeTokenRemap,
} from './types';

export class RateFetcher {
  private levelsFetcher: Fetcher<RenegadeLevelsResponse>;
  private levelsCacheKey: string;
  private levelsCacheTTL: number;

  private tokenMetadataFetcher!: Fetcher<RenegadeTokenRemap>;
  private tokenMetadataCacheKey: string;
  private tokenMetadataCacheTTL: number;

  constructor(
    private dexHelper: IDexHelper,
    private dexKey: string,
    private network: Network,
    private logger: Logger,
    private config: RenegadeRateFetcherConfig,
  ) {
    this.levelsCacheKey = config.levelsCacheKey;
    this.levelsCacheTTL = config.levelsCacheTTL;
    this.tokenMetadataCacheKey = config.tokenMetadataCacheKey;
    this.tokenMetadataCacheTTL = config.tokenMetadataCacheTTL;
    const baseUrl = buildRenegadeApiUrl(this.network);
    const url = `${baseUrl}${RENEGADE_MARKETS_DEPTH_ENDPOINT}`;

    const authenticate = (options: RequestConfig): RequestConfig => {
      const authenticatedHeaders = generateRenegadeAuthHeaders(
        RENEGADE_MARKETS_DEPTH_ENDPOINT,
        options.data ? JSON.stringify(options.data) : '',
        this.stringifyHeaders(options.headers),
        this.config.apiKey,
        this.config.apiSecret,
      );

      options.headers = authenticatedHeaders;

      return options;
    };

    const caster = (data: unknown): RenegadeLevelsResponse => {
      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid response format from Renegade API');
      }

      const response = data as RenegadeMarketDepthsResponse;
      return new RenegadeLevelsResponse(this.toPairDepthMap(response));
    };

    const requestInfo: RequestInfo<RenegadeLevelsResponse> = {
      requestOptions: {
        url,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;number=string',
        },
      },
      caster,
      authenticate,
    };

    this.levelsFetcher = new Fetcher<RenegadeLevelsResponse>(
      this.dexHelper.httpRequest,
      {
        info: requestInfo,
        handler: this.handleLevelsResponse.bind(this),
      },
      RENEGADE_LEVELS_POLLING_INTERVAL,
      this.logger,
    );

    const chainName = this.getChainName();
    const tokenUrl = `${RENEGADE_TOKEN_MAPPINGS_BASE_URL}${chainName}.json`;
    const tokenCaster = (data: unknown): RenegadeTokenRemap => {
      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid token metadata response format');
      }
      return data as RenegadeTokenRemap;
    };
    const tokenRequestInfo: RequestInfo<RenegadeTokenRemap> = {
      requestOptions: {
        url: tokenUrl,
        method: 'GET',
      },
      caster: tokenCaster,
    };
    this.tokenMetadataFetcher = new Fetcher<RenegadeTokenRemap>(
      this.dexHelper.httpRequest,
      {
        info: tokenRequestInfo,
        handler: this.handleTokenMetadataResponse.bind(this),
      },
      RENEGADE_TOKEN_METADATA_POLLING_INTERVAL,
      this.logger,
    );
  }

  // Get chain name for token mappings URL.
  private getChainName(): string {
    switch (this.network) {
      case Network.ARBITRUM:
        return 'arbitrum-one';
      case Network.BASE:
        return 'base-mainnet';
      default:
        throw new Error(
          `Network ${this.network} is not supported for token metadata`,
        );
    }
  }

  // Handle successful levels response from the Fetcher.
  private handleLevelsResponse(levelsResponse: RenegadeLevelsResponse): void {
    const rawData = levelsResponse.getRawData();

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.levelsCacheKey,
      this.levelsCacheTTL,
      JSON.stringify(rawData),
    );
  }

  private toPairDepthMap(
    response: RenegadeMarketDepthsResponse,
  ): Record<string, RenegadeDepth> {
    const pairDepthMap: Record<string, RenegadeDepth> = {};
    const marketDepths = Array.isArray(response.market_depths)
      ? response.market_depths
      : [];

    for (const marketDepth of marketDepths) {
      const baseAddress = marketDepth.market?.base?.address?.toLowerCase();
      const quoteAddress = marketDepth.market?.quote?.address?.toLowerCase();
      const price = this.parsePositiveDecimal(marketDepth.market?.price?.price);

      if (!baseAddress || !quoteAddress || !price) {
        continue;
      }

      const bidBaseSize = this.resolveBaseSize(marketDepth.buy, price);
      const askBaseSize = this.resolveBaseSize(marketDepth.sell, price);

      const pairIdentifier = `${baseAddress}/${quoteAddress}`;
      pairDepthMap[pairIdentifier] = {
        bids: bidBaseSize.gt(0)
          ? [[price.toFixed(), bidBaseSize.toFixed()]]
          : [],
        asks: askBaseSize.gt(0)
          ? [[price.toFixed(), askBaseSize.toFixed()]]
          : [],
      };
    }

    return pairDepthMap;
  }

  private parsePositiveDecimal(value: unknown): BigNumber | null {
    if (value === null || value === undefined) {
      return null;
    }

    const parsed = new BigNumber(String(value));
    if (!parsed.isFinite() || parsed.lte(0)) {
      return null;
    }

    return parsed;
  }

  private resolveBaseSize(
    marketSideDepth: RenegadeMarketSideDepth | undefined,
    price: BigNumber,
  ): BigNumber {
    const quantity = this.parsePositiveDecimal(marketSideDepth?.total_quantity);
    if (quantity) {
      return quantity;
    }

    const quantityUsd = this.parsePositiveDecimal(
      marketSideDepth?.total_quantity_usd,
    );
    if (!quantityUsd) {
      return new BigNumber(0);
    }

    const baseSize = quantityUsd.dividedBy(price);
    if (!baseSize.isFinite() || baseSize.lte(0)) {
      return new BigNumber(0);
    }

    return baseSize;
  }

  private stringifyHeaders(
    headers: RequestConfig['headers'],
  ): Record<string, string> {
    const stringHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      stringHeaders[key] = String(value);
    }

    return stringHeaders;
  }

  // Handle successful token metadata response from the Fetcher.
  private handleTokenMetadataResponse(tokenRemap: RenegadeTokenRemap): void {
    const tokensMap: Record<string, Token> = {};

    for (const tokenInfo of tokenRemap.tokens) {
      const address = tokenInfo.address.toLowerCase();
      tokensMap[address] = {
        address: tokenInfo.address,
        decimals: tokenInfo.decimals,
        symbol: tokenInfo.ticker,
      };
    }

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.tokenMetadataCacheKey,
      this.tokenMetadataCacheTTL,
      JSON.stringify(tokensMap),
    );
  }

  start(): void {
    this.levelsFetcher.startPolling();
    this.tokenMetadataFetcher.startPolling();
  }

  async fetchOnce(): Promise<void> {
    await this.levelsFetcher.fetch(true);
    await this.tokenMetadataFetcher.fetch(true);
  }

  stop(): void {
    this.levelsFetcher.stopPolling();
    this.tokenMetadataFetcher.stopPolling();
  }
}
