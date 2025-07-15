import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { validateAndCast } from '../../lib/validators';
import { Logger, Token } from '../../types';
import {
  DexalotBlacklistResponse,
  DexalotPairsResponse,
  DexalotPricesResponse,
  DexalotRateFetcherConfig,
  PairDataMap,
  PriceDataMap,
} from './types';
import {
  blacklistResponseValidator,
  pairsResponseValidator,
  pricesResponseValidator,
} from './validators';

export class RateFetcher {
  private pairsFetcher: Fetcher<DexalotPairsResponse>;
  private pairsCacheKey: string;
  private pairsCacheTTL: number;

  private rateFetcher: Fetcher<DexalotPricesResponse>;
  private pricesCacheKey: string;
  private pricesCacheTTL: number;

  private tokensAddrCacheKey: string;
  private tokensCacheKey: string;
  private tokensCacheTTL: number;

  private blacklistFetcher: Fetcher<DexalotBlacklistResponse>;
  private blacklistCacheKey: string;
  private blacklistCacheTTL: number;

  constructor(
    private dexHelper: IDexHelper,
    private dexKey: string,
    private network: Network,
    private logger: Logger,
    config: DexalotRateFetcherConfig,
  ) {
    this.pairsCacheKey = config.rateConfig.pairsCacheKey;
    this.pairsCacheTTL = config.rateConfig.pairsCacheTTLSecs;
    this.pricesCacheKey = config.rateConfig.pricesCacheKey;
    this.pricesCacheTTL = config.rateConfig.pricesCacheTTLSecs;
    this.tokensAddrCacheKey = config.rateConfig.tokensAddrCacheKey;
    this.tokensCacheKey = config.rateConfig.tokensCacheKey;
    this.tokensCacheTTL = config.rateConfig.tokensCacheTTLSecs;
    this.blacklistCacheKey = config.rateConfig.blacklistCacheKey;
    this.blacklistCacheTTL = config.rateConfig.blacklistCacheTTLSecs;

    this.pairsFetcher = new Fetcher<DexalotPairsResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.pairsReqParams,
          caster: (data: unknown) => {
            return validateAndCast<DexalotPairsResponse>(
              data,
              pairsResponseValidator,
            );
          },
        },
        handler: this.handlePairsResponse.bind(this),
      },
      config.rateConfig.pairsIntervalMs,
      logger,
    );

    this.rateFetcher = new Fetcher<DexalotPricesResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.pricesReqParams,
          caster: (data: unknown) => {
            return validateAndCast<DexalotPricesResponse>(
              data,
              pricesResponseValidator,
            );
          },
        },
        handler: this.handleRatesResponse.bind(this),
      },
      config.rateConfig.pricesIntervalMs,
      logger,
    );

    this.blacklistFetcher = new Fetcher<DexalotBlacklistResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.blacklistReqParams,
          caster: (data: unknown) => {
            return validateAndCast<DexalotBlacklistResponse>(
              data,
              blacklistResponseValidator,
            );
          },
        },
        handler: this.handleBlacklistResponse.bind(this),
      },
      config.rateConfig.blacklistIntervalMs,
      logger,
    );
  }

  start() {
    this.pairsFetcher.startPolling();
    this.rateFetcher.startPolling();
    this.blacklistFetcher.startPolling();
  }

  stop() {
    this.pairsFetcher.stopPolling();
    this.rateFetcher.stopPolling();
    this.blacklistFetcher.stopPolling();
  }

  private handlePairsResponse(resp: DexalotPairsResponse): void {
    const pairs = resp;
    const dexPairs: PairDataMap = {};
    const tokenMap: { [address: string]: Token } = {};
    const tokenAddrMap: { [symbol: string]: string } = {};
    Object.keys(pairs).forEach(pair => {
      dexPairs[pair.toLowerCase()] = pairs[pair];
      tokenAddrMap[pairs[pair].base.toLowerCase()] =
        pairs[pair].baseAddress.toLowerCase();
      tokenAddrMap[pairs[pair].quote.toLowerCase()] =
        pairs[pair].quoteAddress.toLowerCase();
      tokenMap[pairs[pair].baseAddress.toLowerCase()] = {
        address: pairs[pair].baseAddress.toLowerCase(),
        symbol: pairs[pair].base,
        decimals: pairs[pair].baseDecimals,
      };
      tokenMap[pairs[pair].quoteAddress.toLowerCase()] = {
        address: pairs[pair].quoteAddress.toLowerCase(),
        symbol: pairs[pair].quote,
        decimals: pairs[pair].quoteDecimals,
      };
    });

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.pairsCacheKey,
      this.pairsCacheTTL,
      JSON.stringify(dexPairs),
    );

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.tokensCacheKey,
      this.tokensCacheTTL,
      JSON.stringify(tokenMap),
    );

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.tokensAddrCacheKey,
      this.tokensCacheTTL,
      JSON.stringify(tokenAddrMap),
    );
  }

  private handleRatesResponse(resp: DexalotPricesResponse): void {
    const { prices } = resp;
    const dexPrices: PriceDataMap = {};
    Object.keys(prices).forEach(pair => {
      dexPrices[pair.toLowerCase()] = prices[pair];
    });

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.pricesCacheKey,
      this.pricesCacheTTL,
      JSON.stringify(dexPrices),
    );
  }

  private async handleBlacklistResponse(
    resp: DexalotBlacklistResponse,
  ): Promise<void> {
    const { blacklist } = resp;
    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.blacklistCacheKey,
      this.blacklistCacheTTL,
      JSON.stringify(blacklist.map(item => item.toLowerCase())),
    );
  }
}
