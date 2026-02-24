import { IDexHelper } from '../../dex-helper';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { validateAndCast } from '../../lib/validators';
import { Logger } from '../../types';
import {
  NativeBlacklistResponse,
  NativeOrderbookResponse,
  NativeRateFetcherConfig,
} from './types';
import { blacklistResponseValidator } from './validators';

export class RateFetcher {
  private orderbookFetcher: Fetcher<NativeOrderbookResponse>;
  private blacklistFetcher: Fetcher<NativeBlacklistResponse>;
  private orderbookCacheKey: string;
  private orderbookCacheTTL: number;
  private setBlacklist: (addresses: string[]) => Promise<void>;

  constructor(
    private dexKey: string,
    private dexHelper: IDexHelper,
    private logger: Logger,
    config: NativeRateFetcherConfig,
  ) {
    this.orderbookCacheKey = config.rateConfig.orderbookCacheKey;
    this.orderbookCacheTTL = config.rateConfig.orderbookCacheTTLSecs;
    this.setBlacklist = config.rateConfig.setBlacklist;

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

    this.blacklistFetcher = new Fetcher<NativeBlacklistResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.blacklistReqParams,
          caster: (data: unknown) => {
            return validateAndCast<NativeBlacklistResponse>(
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
    this.orderbookFetcher.startPolling();
    this.blacklistFetcher.startPolling();
  }

  stop() {
    this.orderbookFetcher.stopPolling();
    this.blacklistFetcher.stopPolling();
  }

  async fetchOnce() {
    await this.orderbookFetcher.fetch(true);
  }

  private handleOrderbookResponse(resp: NativeOrderbookResponse) {
    const parsedData = resp.map(entry => ({
      ...entry,
      base_address: entry.base_address.toLowerCase(),
      quote_address: entry.quote_address.toLowerCase(),
      side: entry.side === 'ask' ? 'ask' : 'bid',
    }));

    this.dexHelper.cache.setex(
      this.dexKey,
      this.dexHelper.config.data.network,
      this.orderbookCacheKey,
      this.orderbookCacheTTL,
      JSON.stringify(parsedData),
    );
  }

  private handleBlacklistResponse(resp: NativeBlacklistResponse) {
    const networkId = Number(this.dexHelper.config.data.network);
    const addresses = resp.black_list
      .filter(entry => entry.chainId === networkId)
      .map(entry => entry.address.toLowerCase());

    this.setBlacklist(addresses);
  }
}
