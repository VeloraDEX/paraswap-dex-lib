import _ from 'lodash';
import { SimpleExchange } from './simple-exchange';
import { IDexHelper } from '../dex-helper';
import { Utils } from '../utils';
import { Logger } from '../types';
import {
  IDexWithBlacklist,
  IDexWithPairRestriction,
  IDexWithRestriction,
} from './idex';

const ERRORS_CACHE_KEY = 'errors';
const RESTRICT_CHECK_INTERVAL_MS = 1000 * 60 * 3; // 3 min
const RESTRICT_COUNT_THRESHOLD = 3;
const RESTRICT_TTL_S = 10 * 60; // 10 min
const RESTRICT_PAIR_TTL_S = 15 * 60; // 15 min

const RESTRICTED_CACHE_VALUE = 'restricted';
const BLACKLISTED_CACHE_VALUE = 'blacklisted';

const DEFAULT_BLACKLISTED_TTL_S = 180 * 60; // 3 hours
const DEFAULT_ENABLE_DEX_RESTRICTION = false;
const DEFAULT_ENABLE_PAIR_RESTRICTION = false;

const ADDRESS_BATCH_SIZE = 1000;

type RestrictData = {
  count: number;
  addedDatetimeMs: number;
} | null;

type CACHE_TTL = number | 'none';

type DexRestrictionOptions = {
  blacklistedTTL?: CACHE_TTL;
  enableDexRestriction?: boolean;
  enablePairRestriction?: boolean;
  restrictCheckIntervalMs?: number;
  restrictCountThreshold?: number;
  restrictTtlS?: number;
  restrictPairTtlS?: number;
};

export class SimpleExchangeWithRestrictions
  extends SimpleExchange
  implements IDexWithRestriction, IDexWithPairRestriction, IDexWithBlacklist
{
  protected readonly blacklistedTTL: CACHE_TTL;
  protected readonly enableDexRestriction: boolean;
  protected readonly enablePairRestriction: boolean;

  protected restrictCheckIntervalMs: number;
  protected restrictCountThreshold: number;
  protected restrictTtlS: number;
  protected restrictPairTtlS: number;

  protected logger: Logger;

  constructor(
    protected readonly dexHelper: IDexHelper,
    public dexKey: string,
    options: DexRestrictionOptions = {},
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(`${dexKey}-${this.network}`);

    this.blacklistedTTL = options.blacklistedTTL ?? DEFAULT_BLACKLISTED_TTL_S;
    this.enableDexRestriction =
      options.enableDexRestriction ?? DEFAULT_ENABLE_DEX_RESTRICTION;
    this.enablePairRestriction =
      options.enablePairRestriction ?? DEFAULT_ENABLE_PAIR_RESTRICTION;
    this.restrictCheckIntervalMs =
      options.restrictCheckIntervalMs ?? RESTRICT_CHECK_INTERVAL_MS;
    this.restrictCountThreshold =
      options.restrictCountThreshold ?? RESTRICT_COUNT_THRESHOLD;
    this.restrictTtlS = options.restrictTtlS ?? RESTRICT_TTL_S;
    this.restrictPairTtlS = options.restrictPairTtlS ?? RESTRICT_PAIR_TTL_S;
  }

  public hasDexRestriction(): this is IDexWithRestriction {
    return this.enableDexRestriction;
  }

  public hasPairRestriction(): this is IDexWithPairRestriction {
    return this.enablePairRestriction;
  }

  public hasBlacklist(): this is IDexWithBlacklist {
    return true; // make configurable if makes sense
  }

  public async isBlacklisted(address: string) {
    const cached = await this.dexHelper.cache.rawget(
      this.getBlacklistedCacheKey(address),
    );

    return cached !== null;
  }

  protected async setBlacklist(addresses: string[], ttl = this.blacklistedTTL) {
    this.logger.info(`Blacklisting addresses: ${addresses.length}`);

    const batches = _.chunk(addresses, ADDRESS_BATCH_SIZE);
    const results = await Promise.allSettled(
      batches.map(batch => this.setCacheBatch(batch, ttl)),
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.error(
        `Failed to set ${failed.length}/${results.length} blacklist batches: ${
          (failed[0] as PromiseRejectedResult).reason
        }`,
      );
    }
  }

  private setCacheBatch(addresses: string[], ttl: CACHE_TTL): Promise<void> {
    if (ttl === 'none') {
      const args = addresses.flatMap(address => [
        this.getBlacklistedCacheKey(address),
        BLACKLISTED_CACHE_VALUE,
      ]);

      return this.dexHelper.cache.mset(...args);
    }

    const args: Array<string | number> = addresses.flatMap(address => [
      this.getBlacklistedCacheKey(address),
      BLACKLISTED_CACHE_VALUE,
      ttl,
    ]);

    return this.dexHelper.cache.msetex(...args);
  }

  public async addBlacklistedAddress(
    address: string,
    ttl = this.blacklistedTTL,
  ) {
    const key = this.getBlacklistedCacheKey(address);

    if (ttl === 'none') {
      return this.dexHelper.cache
        .set(key, BLACKLISTED_CACHE_VALUE)
        .then(() => true);
    }

    return this.dexHelper.cache
      .rawset(key, BLACKLISTED_CACHE_VALUE, ttl)
      .then(() => true);
  }

  public getBlacklistedCacheKey(address: string): string {
    return `${this.network}_${
      this.dexKey
    }_blacklisted_${address.toLowerCase()}`;
  }

  public getRestrictedPairCacheKey(token0: string, token1: string): string {
    const pair = [
      this.dexHelper.config.wrapETH(token0).toLowerCase(),
      this.dexHelper.config.wrapETH(token1).toLowerCase(),
    ]
      .sort()
      .join('_');

    return `${this.network}_${this.dexKey}_restricted_pair_${pair}`;
  }

  public getRestrictedCacheKey(): string {
    return `${this.network}_${this.dexKey}_restricted`;
  }

  async isRestricted(): Promise<boolean> {
    const cached = await this.dexHelper.cache.rawget(
      this.getRestrictedCacheKey(),
    );

    return cached !== null;
  }

  async isRestrictedPair(token0: string, token1: string): Promise<boolean> {
    const cached = await this.dexHelper.cache.rawget(
      this.getRestrictedPairCacheKey(token0, token1),
    );

    return cached !== null;
  }

  protected async restrictPair(
    token0: string,
    token1: string,
    ttl = this.restrictPairTtlS,
  ) {
    const key = this.getRestrictedPairCacheKey(token0, token1);

    return this.dexHelper.cache
      .rawset(key, RESTRICTED_CACHE_VALUE, ttl)
      .then(() => true);
  }

  protected async restrict() {
    const errorsDataRaw = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      ERRORS_CACHE_KEY,
    );

    const errorsData: RestrictData = Utils.Parse(errorsDataRaw);
    const ERRORS_TTL_S = Math.floor(this.restrictCheckIntervalMs / 1000);

    if (
      !errorsData ||
      errorsData?.addedDatetimeMs + this.restrictCheckIntervalMs < Date.now()
    ) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: First encounter of error OR error occurred outside of threshold, setting up counter`,
      );
      const data: RestrictData = {
        count: 1,
        addedDatetimeMs: Date.now(),
      };
      await this.dexHelper.cache.setex(
        this.dexKey,
        this.network,
        ERRORS_CACHE_KEY,
        ERRORS_TTL_S,
        Utils.Serialize(data),
      );
      return;
    } else {
      if (errorsData.count + 1 >= this.restrictCountThreshold) {
        this.logger.warn(
          `${this.dexKey}-${this.network}: Restricting due to error count=${
            errorsData.count + 1
          } within ${this.restrictCheckIntervalMs / 1000 / 60} minutes`,
        );
        await this.dexHelper.cache.rawset(
          this.getRestrictedCacheKey(),
          RESTRICTED_CACHE_VALUE,
          this.restrictTtlS,
        );
      } else {
        this.logger.warn(
          `${this.dexKey}-${this.network}: Error count increased`,
        );
        const data: RestrictData = {
          count: errorsData.count + 1,
          addedDatetimeMs: errorsData.addedDatetimeMs,
        };
        await this.dexHelper.cache.setex(
          this.dexKey,
          this.network,
          ERRORS_CACHE_KEY,
          ERRORS_TTL_S,
          Utils.Serialize(data),
        );
      }
    }
  }
}
