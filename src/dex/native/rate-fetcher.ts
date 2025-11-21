import { IDexHelper } from '../../dex-helper';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { Logger } from '../../types';
import { NativeOrderbookResponse, NativeRateFetcherConfig } from './types';

export class RateFetcher {
  private orderbookFetcher: Fetcher<NativeOrderbookResponse>;
  private orderbookCacheKey: string;
  private orderbookCacheTTL: number;

  constructor(
    private dexHelper: IDexHelper,
    private logger: Logger,
    config: NativeRateFetcherConfig,
  ) {
    this.orderbookCacheKey = config.rateConfig.orderbookCacheKey;
    this.orderbookCacheTTL = config.rateConfig.orderbookCacheTTLSecs;

    this.orderbookFetcher = new Fetcher<NativeOrderbookResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.orderbookReqParams,
          caster: data => (Array.isArray(data) ? data : []),
        },
        handler: this.handleOrderbookResponse.bind(this),
      },
      config.rateConfig.orderbookIntervalMs,
      logger,
    );
  }

  start() {
    this.orderbookFetcher.startPolling();
  }

  stop() {
    this.orderbookFetcher.stopPolling();
  }

  async fetchOnce() {
    await this.orderbookFetcher.fetch(true);
  }

  private handleOrderbookResponse(resp: NativeOrderbookResponse) {
    this.dexHelper.cache.rawset(
      this.orderbookCacheKey,
      JSON.stringify(resp),
      this.orderbookCacheTTL,
    );
  }
}
