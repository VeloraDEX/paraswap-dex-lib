import { Network } from '../../constants';
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
} from './types';
import { BebopPricingUpdate, tokensResponseValidator } from './validators';
import { WebSocketFetcher } from '../../lib/fetcher/wsFetcher';
import { ethers } from 'ethers';

export function levels_from_flat_array(values: number[]): BebopLevel[] {
  const levels: BebopLevel[] = [];
  for (let i = 0; i < values.length; i += 2) {
    levels.push([values[i], values[i + 1]]);
  }
  return levels;
}

export class RateFetcher {
  private pricesFetcher: WebSocketFetcher<BebopPricingResponse>;
  private pricesCacheKey: string;
  private pricesCacheTTL: number;

  private tokensFetcher: Fetcher<BebopTokensResponse>;
  private tokensAddrCacheKey: string;
  private tokensCacheKey: string;
  private tokensCacheTTL: number;

  constructor(
    private dexHelper: IDexHelper,
    private dexKey: string,
    private network: Network,
    private logger: Logger,
    config: BebopRateFetcherConfig,
  ) {
    this.pricesCacheKey = config.rateConfig.pricesCacheKey;
    this.pricesCacheTTL = config.rateConfig.pricesCacheTTLSecs;
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
    this.tokensCacheKey = config.rateConfig.tokensCacheKey;
    this.tokensCacheTTL = config.rateConfig.tokensCacheTTLSecs;
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
  }

  parsePricingUpdate(updateObject: any): BebopPricingResponse {
    const pricingResponse: BebopPricingResponse = {};
    if (!updateObject.pairs || !updateObject.pairs.length) {
      this.logger.warn('Update message did not include pairs', updateObject);
      return pricingResponse;
    }
    for (const pairBook of updateObject.pairs) {
      const pair =
        ethers.getAddress('0x' + pairBook.base.toString('hex')) +
        '/' +
        ethers.getAddress('0x' + pairBook.quote.toString('hex'));
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
    this.pricesFetcher.startPolling();
    this.tokensFetcher.startPolling();
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

  private handlePricesResponse(resp: BebopPricingResponse): void {
    const normalizedPrices: BebopPricingResponse = {};
    for (const [pair, levels] of Object.entries(resp)) {
      normalizedPrices[pair.toLowerCase()] = levels;
    }

    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      this.pricesCacheKey,
      this.pricesCacheTTL,
      JSON.stringify(normalizedPrices),
    );
  }
}
