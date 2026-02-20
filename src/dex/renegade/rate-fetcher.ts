import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { RequestConfig } from '../../dex-helper/irequest-wrapper';
import { Fetcher, RequestInfo } from '../../lib/fetcher/fetcher';
import { Logger, Token } from '../../types';
import { generateRenegadeAuthHeaders } from './api/auth';
import {
  buildRenegadeApiUrl,
  RENEGADE_LEVELS_ENDPOINT,
  RENEGADE_LEVELS_POLLING_INTERVAL,
  RENEGADE_TOKEN_MAPPINGS_BASE_URL,
  RENEGADE_TOKEN_METADATA_POLLING_INTERVAL,
} from './constants';
import { RenegadeLevelsResponse } from './renegade-levels-response';
import {
  RenegadeDepth,
  RenegadeRateFetcherConfig,
  RenegadeTokenRemap,
} from './types';

// RateFetcher for Renegade DEX integration using the Fetcher class.
// This implementation uses the standard Fetcher class with HMAC-SHA256 authentication
// and includes polling functionality for real-time price level updates.
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
    // Build network-specific API URL
    const baseUrl = buildRenegadeApiUrl(this.network);
    const url = `${baseUrl}${RENEGADE_LEVELS_ENDPOINT}`;

    // Create authentication function for Renegade API
    const authenticate = (options: RequestConfig): RequestConfig => {
      // Convert headers to string format for auth function
      const stringHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(options.headers ?? {})) {
        stringHeaders[key] = String(value);
      }

      // Generate authenticated headers using HMAC-SHA256
      const authenticatedHeaders = generateRenegadeAuthHeaders(
        RENEGADE_LEVELS_ENDPOINT,
        options.data ? JSON.stringify(options.data) : '', // Convert body to string
        stringHeaders,
        this.config.apiKey,
        this.config.apiSecret,
      );

      options.headers = authenticatedHeaders;

      return options;
    };

    // Create caster function to validate and transform response
    const caster = (data: unknown): RenegadeLevelsResponse => {
      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid response format from Renegade API');
      }

      const response = data as { [pairIdentifier: string]: RenegadeDepth };

      return new RenegadeLevelsResponse(response);
    };

    // Create request info for the Fetcher
    const requestInfo: RequestInfo<RenegadeLevelsResponse> = {
      requestOptions: {
        url,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      },
      caster,
      authenticate,
    };

    // Initialize the Fetcher
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
    this.logger.info(`Renegade levels response: ${JSON.stringify(rawData)}`);

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.levelsCacheKey,
      this.levelsCacheTTL,
      JSON.stringify(rawData),
    );
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

  stop(): void {
    this.levelsFetcher.stopPolling();
    this.tokenMetadataFetcher.stopPolling();
  }
}
