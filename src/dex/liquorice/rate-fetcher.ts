import { IDexHelper } from '../../dex-helper';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { validateAndCast } from '../../lib/validators';
import { Logger } from '../../types';
import {
  LIQUORICE_BLACKLIST_POLLING_INTERVAL_MS,
  LIQUORICE_PRICES_CACHE_KEY,
  LIQUORICE_PRICES_CACHE_TTL_S,
  LIQUORICE_PRICES_POLLING_INTERVAL_MS,
  LIQUORICE_TOKENS_CACHE_KEY,
  LIQUORICE_TOKENS_CACHE_TTL_S,
  LIQUORICE_TOKENS_POLLING_INTERVAL_MS,
} from './constants';
import {
  LiquoriceBlacklistResponse,
  LiquoricePricesResponse,
  LiquoriceRateFetcherConfig,
  LiquoriceToken,
  LiquoriceTokensResponse,
} from './types';
import {
  blacklistResponseValidator,
  pricesResponseValidator,
  tokensResponseValidator,
} from './validators';

export class RateFetcher {
  private pricesFetcher: Fetcher<LiquoricePricesResponse>;
  private tokensFetcher: Fetcher<LiquoriceTokensResponse>;
  private blacklistFetcher: Fetcher<LiquoriceBlacklistResponse>;

  constructor(
    private dexKey: string,
    private dexHelper: IDexHelper,
    private logger: Logger,
    private config: LiquoriceRateFetcherConfig,
  ) {
    this.pricesFetcher = new Fetcher<LiquoricePricesResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.pricesReqParams,
          caster: data =>
            validateAndCast<LiquoricePricesResponse>(
              data,
              pricesResponseValidator,
            ),
        },
        handler: this.handlePricesResponse.bind(this),
      },
      LIQUORICE_PRICES_POLLING_INTERVAL_MS,
      logger,
    );

    this.tokensFetcher = new Fetcher<LiquoriceTokensResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.tokensReqParams,
          caster: data =>
            validateAndCast<LiquoriceTokensResponse>(
              data,
              tokensResponseValidator,
            ),
        },
        handler: this.handleTokensResponse.bind(this),
      },
      LIQUORICE_TOKENS_POLLING_INTERVAL_MS,
      logger,
    );

    this.blacklistFetcher = new Fetcher<LiquoriceBlacklistResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.blacklistReqParams,
          caster: data =>
            validateAndCast<LiquoriceBlacklistResponse>(
              data,
              blacklistResponseValidator,
            ),
        },
        handler: this.handleBlacklistResponse.bind(this),
      },
      LIQUORICE_BLACKLIST_POLLING_INTERVAL_MS,
      logger,
    );
  }

  start() {
    this.pricesFetcher.startPolling();
    this.tokensFetcher.startPolling();
    this.blacklistFetcher.startPolling();
  }

  stop() {
    this.pricesFetcher.stopPolling();
    this.tokensFetcher.stopPolling();
    this.blacklistFetcher.stopPolling();
  }

  private handlePricesResponse(resp: LiquoricePricesResponse) {
    this.dexHelper.cache.setex(
      this.dexKey,
      this.dexHelper.config.data.network,
      LIQUORICE_PRICES_CACHE_KEY,
      LIQUORICE_PRICES_CACHE_TTL_S,
      JSON.stringify(resp.pairs),
    );
  }

  private handleTokensResponse(resp: LiquoriceTokensResponse) {
    const tokens: Record<string, LiquoriceToken> = {};
    for (const token of resp.tokens) {
      const address = token.address.toLowerCase();
      tokens[address] = { ...token, address };
    }

    this.dexHelper.cache.setex(
      this.dexKey,
      this.dexHelper.config.data.network,
      LIQUORICE_TOKENS_CACHE_KEY,
      LIQUORICE_TOKENS_CACHE_TTL_S,
      JSON.stringify(tokens),
    );
  }

  private handleBlacklistResponse(resp: LiquoriceBlacklistResponse) {
    this.config.setBlacklist(resp.addresses.map(a => a.toLowerCase()));
  }
}
