import { ETHER_ADDRESS, Network } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { Fetcher } from '../../lib/fetcher/fetcher';
import { validateAndCast, ValidationError } from '../../lib/validators';
import { Logger, Token } from '../../types';
import {
  BebopLevel,
  BebopPair,
  BebopPricingResponse,
  BebopRateFetcherConfig,
  BebopTokensResponse,
  TokenDataMap,
} from './types';
import { BebopPricingUpdate, tokensResponseValidator } from './validators';
import { WebSocketFetcher } from '../../lib/fetcher/wsFetcher';
import { utils } from 'ethers';
import { BEBOP_RESTRICT_TTL_S, BEBOP_RESTRICTED_CACHE_KEY } from './constants';
import { JsonPubSub } from '../../lib/pub-sub';

export function levels_from_flat_array(values: number[]): BebopLevel[] {
  const levels: BebopLevel[] = [];
  for (let i = 0; i < values.length; i += 2) {
    levels.push([values[i], values[i + 1]]);
  }
  return levels;
}

export class RateFetcher {
  private pricesFetcher: WebSocketFetcher<BebopPricingResponse>;
  private pricesPubSub: JsonPubSub;
  private pricesCacheKey: string;
  private pricesCacheTTL: number;

  private tokensFetcher: Fetcher<BebopTokensResponse>;
  private tokensPubSub: JsonPubSub;
  private tokensAddrCacheKey: string;
  private tokensCacheTTL: number;

  private restrictPubSub: JsonPubSub;

  constructor(
    private dexHelper: IDexHelper,
    private dexKey: string,
    private network: Network,
    private logger: Logger,
    config: BebopRateFetcherConfig,
  ) {
    this.pricesCacheKey = config.rateConfig.pricesCacheKey;
    this.pricesCacheTTL = config.rateConfig.pricesCacheTTLSecs;
    this.pricesPubSub = new JsonPubSub(this.dexHelper, this.dexKey, 'prices');
    this.pricesFetcher = new WebSocketFetcher<BebopPricingResponse>(
      {
        info: {
          requestOptions: config.rateConfig.pricesReqParams,
          caster: (data: unknown) => {
            const dataBuffer = data as any;
            const invalid = BebopPricingUpdate.verify(dataBuffer);
            if (invalid) {
              throw new ValidationError(invalid);
            }
            const update = BebopPricingUpdate.decode(dataBuffer);
            const updateObject = BebopPricingUpdate.toObject(update, {
              longs: Number,
            });
            return this.parsePricingUpdate(updateObject);
          },
        },
        handler: this.handlePricesResponse.bind(this),
      },
      logger,
    );

    this.tokensAddrCacheKey = config.rateConfig.tokensAddrCacheKey;
    this.tokensCacheTTL = config.rateConfig.tokensCacheTTLSecs;

    this.tokensPubSub = new JsonPubSub(this.dexHelper, this.dexKey, 'tokens');
    this.tokensFetcher = new Fetcher<BebopTokensResponse>(
      dexHelper.httpRequest,
      {
        info: {
          requestOptions: config.rateConfig.tokensReqParams,
          caster: (data: unknown) => {
            return validateAndCast<BebopTokensResponse>(
              data,
              tokensResponseValidator,
            );
          },
        },
        handler: this.handleTokensResponse.bind(this),
      },
      config.rateConfig.tokensIntervalMs,
      logger,
    );

    this.restrictPubSub = new JsonPubSub(
      dexHelper,
      dexKey,
      'restrict',
      'not_restricted',
      BEBOP_RESTRICT_TTL_S,
    );
  }

  parsePricingUpdate(updateObject: any): BebopPricingResponse {
    const pricingResponse: BebopPricingResponse = {};
    if (!updateObject.pairs || !updateObject.pairs.length) {
      this.logger.warn('Update message did not include pairs', updateObject);
      return pricingResponse;
    }
    for (const pairBook of updateObject.pairs) {
      const pair =
        utils.getAddress('0x' + pairBook.base.toString('hex')) +
        '/' +
        utils.getAddress('0x' + pairBook.quote.toString('hex'));
      const lastUpdateTs = pairBook.lastUpdateTs;
      const bids = pairBook.bids ? levels_from_flat_array(pairBook.bids) : [];
      const asks = pairBook.asks ? levels_from_flat_array(pairBook.asks) : [];
      const bebopPair: BebopPair = {
        bids,
        asks,
        last_update_ts: lastUpdateTs,
      };
      pricingResponse[pair] = bebopPair;
    }
    return pricingResponse;
  }

  start() {
    if (!this.dexHelper.config.isSlave) {
      this.pricesFetcher.startPolling();
      this.tokensFetcher.startPolling();
    } else {
      this.tokensPubSub.subscribe();
      this.pricesPubSub.subscribe();
      this.restrictPubSub.subscribe();
    }
  }

  stop() {
    this.pricesFetcher.stopPolling();
    this.tokensFetcher.stopPolling();
  }

  private handleTokensResponse(resp: BebopTokensResponse): void {
    const tokenMap: { [address: string]: Token } = {};
    const tokenAddrMap: { [symbol: string]: Token } = {};

    Object.keys(resp.tokens).forEach(tokenSymbol => {
      const token = resp.tokens[tokenSymbol];
      const tokenData = {
        address: token.contractAddress.toLowerCase(),
        symbol: token.ticker,
        decimals: token.decimals,
      };
      tokenAddrMap[token.contractAddress.toLowerCase()] = tokenData;
      tokenMap[token.ticker.toLowerCase()] = tokenData;
    });

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.tokensAddrCacheKey,
      this.tokensCacheTTL,
      JSON.stringify(tokenAddrMap),
    );

    this.tokensPubSub.publish(tokenAddrMap, this.tokensCacheTTL);
  }

  private handlePricesResponse(resp: BebopPricingResponse): void {
    const wethAddress =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    const normalizedPrices: BebopPricingResponse = {};
    for (const [pair, levels] of Object.entries(resp)) {
      normalizedPrices[pair.toLowerCase()] = levels;
      const [base, quote] = pair.split('/');
      // Also enter native token prices. Pricing doesn't come with these
      if (
        base.toLowerCase() === wethAddress ||
        quote.toLowerCase() === wethAddress
      ) {
        const nativePair = pair.replace(base, ETHER_ADDRESS);
        normalizedPrices[nativePair.toLowerCase()] = levels;
      }
    }

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.pricesCacheKey,
      this.pricesCacheTTL,
      JSON.stringify(normalizedPrices),
    );

    this.pricesPubSub.publish(normalizedPrices, this.pricesCacheTTL);
  }

  async getCachedPrices(): Promise<BebopPricingResponse | null> {
    const cachedPrices = await this.pricesPubSub.getAndCache(
      this.pricesCacheKey,
    );

    if (cachedPrices) {
      return cachedPrices as BebopPricingResponse;
    }

    return null;
  }

  async getCachedTokens(): Promise<TokenDataMap | null> {
    const cachedTokens = await this.tokensPubSub.getAndCache(
      this.tokensAddrCacheKey,
    );

    if (cachedTokens) {
      return cachedTokens as TokenDataMap;
    }

    return null;
  }

  async isRestricted(): Promise<boolean> {
    const result = await this.restrictPubSub.getAndCache(
      BEBOP_RESTRICTED_CACHE_KEY,
    );

    return result === 'true';
  }

  async restrict(): Promise<void> {
    await this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      BEBOP_RESTRICTED_CACHE_KEY,
      BEBOP_RESTRICT_TTL_S,
      'true',
    );

    this.restrictPubSub.publish(
      { [BEBOP_RESTRICTED_CACHE_KEY]: 'true' },
      BEBOP_RESTRICT_TTL_S,
    );
  }
}
