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
import { utils } from 'ethers';
import { BEBOP_PRICES_WRITE_CHUNK_SIZE } from './constants';

export function levels_from_flat_array(values: number[]): BebopLevel[] {
  const levels: BebopLevel[] = [];
  for (let i = 0; i < values.length; i += 2) {
    levels.push([values[i], values[i + 1]]);
  }
  return levels;
}

// The whole book is ~1MB on mainnet while pricing a swap needs at most 8 pairs,
// so each pair is cached under its own key and read with `mget`. These build raw
// Redis keys and must mirror the `dexKey_network_cacheKey` layout that `setex`
// produces, since `msetex`/`mget` do not prefix keys themselves.
export const pairPricesCacheKey = (
  dexKey: string,
  network: Network,
  pricesCacheKey: string,
  pair: string,
) => `${dexKey}_${network}_${pricesCacheKey}_${pair}`;

// Holds every pair currently in the book, for consumers that need all of them.
export const pairsIndexCacheKey = (
  dexKey: string,
  network: Network,
  pricesCacheKey: string,
) => `${dexKey}_${network}_${pricesCacheKey}_index`;

export class RateFetcher {
  private pricesFetcher: WebSocketFetcher<BebopPricingResponse>;
  private pricesCacheKey: string;
  private pricesCacheTTL: number;

  private tokensFetcher: Fetcher<BebopTokensResponse>;
  private tokensAddrCacheKey: string;
  private tokensCacheKey: string;
  private tokensCacheTTL: number;

  private writingPrices = false;
  private queuedPrices: BebopPricingResponse | null = null;
  private publishedPrices = false;

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
    this.logger.log(
      `Received Bebop pricing update for ${Object.keys(resp).length} pairs`,
    );

    const normalizedPrices: BebopPricingResponse = {};
    for (const [pair, levels] of Object.entries(resp)) {
      normalizedPrices[pair.toLowerCase()] = levels;
    }

    this.schedulePerPairWrite(normalizedPrices);
  }

  // Updates arrive faster than a full book can be written, and two overlapping
  // writes could land out of order. Only ever run one, keeping just the newest
  // update queued behind it.
  private schedulePerPairWrite(prices: BebopPricingResponse): void {
    this.queuedPrices = prices;

    if (this.writingPrices) {
      return;
    }

    this.writingPrices = true;
    void (async () => {
      try {
        while (this.queuedPrices) {
          const next = this.queuedPrices;
          this.queuedPrices = null;
          await this.cachePricesPerPair(next);
        }
      } finally {
        this.writingPrices = false;
      }
    })();
  }

  // Whether this process has published a complete per-pair book at least once.
  // Reading the flag back out of Redis would not prove it: reads go to a
  // replica and could return a flag left behind by a previous writer.
  hasPublishedPrices(): boolean {
    return this.publishedPrices;
  }

  private async cachePricesPerPair(
    prices: BebopPricingResponse,
  ): Promise<void> {
    const pairs = Object.keys(prices);
    if (!pairs.length) {
      return;
    }

    const args: (string | number)[] = [];
    for (const pair of pairs) {
      args.push(
        pairPricesCacheKey(
          this.dexKey,
          this.network,
          this.pricesCacheKey,
          pair,
        ),
        JSON.stringify(prices[pair]),
        this.pricesCacheTTL,
      );
    }

    args.push(
      pairsIndexCacheKey(this.dexKey, this.network, this.pricesCacheKey),
      JSON.stringify(pairs),
      this.pricesCacheTTL,
    );

    const chunkSize = BEBOP_PRICES_WRITE_CHUNK_SIZE * 3;

    try {
      const chunks: Promise<void>[] = [];
      for (let i = 0; i < args.length; i += chunkSize) {
        chunks.push(
          this.dexHelper.cache.msetex(...args.slice(i, i + chunkSize)),
        );
      }
      await Promise.all(chunks);

      this.publishedPrices = true;
    } catch (e) {
      this.logger.error(
        `${this.dexKey}-${this.network}: failed to cache per-pair prices`,
        e,
      );
    }
  }
}
