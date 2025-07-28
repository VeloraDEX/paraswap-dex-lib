import {
  Address,
  LoggerConstructor,
  Logger,
  Token,
  PoolPrices,
  ExchangePrices,
  UnoptimizedRate,
  TransferFeeParams,
} from './types';
import {
  SwapSide,
  SETUP_RETRY_TIMEOUT,
  FETCH_POOL_IDENTIFIER_TIMEOUT,
  FETCH_POOL_PRICES_TIMEOUT,
} from './constants';
import { DexAdapterService } from './dex';
import { IDex, IRouteOptimizer } from './dex/idex';
import { interpolate, isSrcTokenTransferFeeToBeExchanged } from './utils';

export class PricingHelper {
  logger: Logger;
  public optimizeRate: IRouteOptimizer<UnoptimizedRate>;

  constructor(
    protected dexAdapterService: DexAdapterService,
    loggerConstructor: LoggerConstructor,
  ) {
    this.logger = loggerConstructor(
      `PricingHelper_${dexAdapterService.network}`,
    );
    this.optimizeRate = (ur: UnoptimizedRate) =>
      this.dexAdapterService.routeOptimizers.reduce(
        (acc: UnoptimizedRate, fn: IRouteOptimizer<UnoptimizedRate>) => fn(acc),
        ur,
      );
  }

  private async initializeDex(dexKey: string, blockNumber: number) {
    try {
      const dexInstance = this.dexAdapterService.getDexByKey(dexKey);

      if (!dexInstance.initializePricing) return;

      if (
        !this.dexAdapterService.dexHelper.config.isSlave &&
        dexInstance.cacheStateKey
      ) {
        this.logger.info(`remove cached state ${dexInstance.cacheStateKey}`);
        this.dexAdapterService.dexHelper.cache.rawdel(
          dexInstance.cacheStateKey,
        );
      }

      await dexInstance.initializePricing(blockNumber);
      this.logger.info(`${dexKey}: is successfully initialized`);
    } catch (e) {
      this.logger.error(`Error_startListening_${dexKey}:`, e);
      setTimeout(
        () => this.initializeDex(dexKey, blockNumber),
        SETUP_RETRY_TIMEOUT,
      );
    }
  }

  public getAllDexKeys(): string[] {
    return this.dexAdapterService.getAllDexKeys();
  }

  public getDexByKey(key: string): IDex<any, any, any> | null {
    try {
      return this.dexAdapterService.getDexByKey(key);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Invalid Dex Key')) {
        this.logger.warn(`Dex ${key} was not found in getDexByKey`);
        return null;
      }
      // Unexpected error
      throw e;
    }
  }

  public async initialize(blockNumber: number, dexKeys: string[]) {
    return await Promise.all(
      dexKeys.map(key => this.initializeDex(key, blockNumber)),
    );
  }

  public async releaseResources(dexKeys: string[]) {
    return await Promise.all(dexKeys.map(key => this.releaseDexResources(key)));
  }

  private async releaseDexResources(dexKey: string) {
    try {
      const dexInstance = this.dexAdapterService.getDexByKey(dexKey);

      if (!dexInstance.releaseResources) return;

      await dexInstance.releaseResources();
      this.logger.info(`${dexKey}: resources were successfully released`);
    } catch (e) {
      this.logger.error(`Error_releaseResources_${dexKey}:`, e);
      setTimeout(() => this.releaseDexResources(dexKey), SETUP_RETRY_TIMEOUT);
    }
  }

  public async getPoolIdentifiers(
    from: Token,
    to: Token,
    side: SwapSide,
    blockNumber: number,
    dexKeys: string[],
    filterConstantPricePool: boolean = false,
  ): Promise<{ [dexKey: string]: string[] | null }> {
    const poolIdentifiers = await Promise.all(
      dexKeys.map(async key => {
        try {
          return await new Promise<string[] | null>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timeout`)),
              FETCH_POOL_IDENTIFIER_TIMEOUT,
            );
            const dexInstance = this.dexAdapterService.getDexByKey(key);

            if (
              filterConstantPricePool &&
              dexInstance.hasConstantPriceLargeAmounts
            ) {
              clearTimeout(timer);
              return resolve(null);
            }

            return dexInstance
              .getPoolIdentifiers(from, to, side, blockNumber)
              .then(resolve, reject)
              .finally(() => {
                clearTimeout(timer);
              });
          });
        } catch (e) {
          this.logger.error(`Error_${key}_getPoolIdentifiers:`, e);
          return [];
        }
      }),
    );

    return dexKeys.reduce(
      (
        acc: { [dexKey: string]: string[] | null },
        dexKey: string,
        index: number,
      ) => {
        acc[dexKey] = poolIdentifiers[index];
        return acc;
      },
      {},
    );
  }

  getDexsSupportingFeeOnTransfer(): string[] {
    const allDexKeys = this.dexAdapterService.getAllDexKeys();
    return allDexKeys
      .map(dexKey => {
        try {
          const dexInstance = this.dexAdapterService.getDexByKey(dexKey);
          if (dexInstance.isFeeOnTransferSupported) {
            return dexKey;
          }
        } catch (e) {
          if (
            !(e instanceof Error && e.message.startsWith(`Invalid Dex Key`))
          ) {
            throw e;
          }
        }
      })
      .filter((d: string | undefined): d is string => !!d);
  }

  public async getPoolPrices(
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    dexKeys: string[],
    limitPoolsMap: { [key: string]: string[] | null } | null,
    transferFees: TransferFeeParams = {
      srcFee: 0,
      destFee: 0,
      srcDexFee: 0,
      destDexFee: 0,
    },
    rollupL1CalldataCostToL2GasCost?: (calldataCost: number) => number,
    // temporary flag for tests
    reducePriceAmounts: boolean = false,
  ): Promise<PoolPrices<any>[]> {
    const dexPoolPrices = await Promise.all(
      dexKeys.map(async key => {
        try {
          const limitPools = limitPoolsMap ? limitPoolsMap[key] : null;

          if (limitPools && !limitPools.length) return [];

          return await new Promise<PoolPrices<any>[] | null>(
            (resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`Timeout`)),
                FETCH_POOL_PRICES_TIMEOUT,
              );

              const dexInstance = this.dexAdapterService.getDexByKey(key);

              if (
                isSrcTokenTransferFeeToBeExchanged(transferFees) &&
                !dexInstance.isFeeOnTransferSupported
              ) {
                clearTimeout(timer);
                return resolve(null);
              }

              dexInstance.reducePriceAmounts = true;

              let _amounts: bigint[] = [];

              const applyReducePriceAmounts =
                reducePriceAmounts && dexInstance.reducePriceAmounts;

              if (applyReducePriceAmounts) {
                for (let i = 0; i < amounts.length; i++) {
                  if (i === 0 || i % 2 === 1 || i === amounts.length - 1) {
                    _amounts.push(amounts[i]);
                  }
                }
              } else {
                _amounts = amounts;
              }

              this.logger.info(
                `chunks-new-7: ${reducePriceAmounts} ${dexInstance.dexKey}: ${from.address}_${to.address}: ${_amounts.length}: `,
              );

              dexInstance
                .getPricesVolume(
                  from,
                  to,
                  _amounts,
                  side,
                  blockNumber,
                  limitPools ? limitPools : undefined,
                  transferFees,
                )
                .then(poolPrices => {
                  if (!poolPrices || !applyReducePriceAmounts) {
                    return poolPrices;
                  }

                  poolPrices.forEach(p => {
                    p.prices = interpolate(_amounts, p.prices, amounts, side);

                    if (p.prices.length !== amounts.length) {
                      throw new Error(
                        `interpolatedPrices length mismatch: expected ${amounts.length}, got ${p.prices.length}`,
                      );
                    }

                    if (typeof p.gasCost !== 'number') {
                      p.gasCost = interpolate(
                        _amounts,
                        p.gasCost.map(t => BigInt(t)),
                        amounts,
                        side,
                      ).map(t => Number(t));
                    }

                    if (p.gasCostL2 && typeof p.gasCostL2 !== 'number') {
                      p.gasCostL2 = interpolate(
                        _amounts,
                        p.gasCostL2.map(t => BigInt(t)),
                        amounts,
                        side,
                      ).map(t => Number(t));
                    }
                  });

                  return poolPrices;
                })
                .then(poolPrices => {
                  try {
                    if (!poolPrices || !rollupL1CalldataCostToL2GasCost) {
                      return resolve(poolPrices);
                    }
                    return resolve(
                      poolPrices.map(pp => {
                        pp.gasCostL2 = pp.gasCost;
                        const calldataGasCost =
                          dexInstance.getCalldataGasCost(pp);
                        if (
                          typeof pp.gasCost === 'number' &&
                          pp.gasCost !== 0 &&
                          typeof calldataGasCost === 'number'
                        ) {
                          pp.gasCost += Math.ceil(
                            rollupL1CalldataCostToL2GasCost(calldataGasCost),
                          );
                        } else if (
                          typeof pp.gasCost !== 'number' &&
                          typeof calldataGasCost !== 'number'
                        ) {
                          if (pp.gasCost.length !== calldataGasCost.length) {
                            throw new Error(
                              `getCalldataGasCost returned wrong array length in dex ${key}`,
                            );
                          }
                          pp.gasCost = pp.gasCost.map((g, i) =>
                            g === 0
                              ? 0
                              : g +
                                Math.ceil(
                                  rollupL1CalldataCostToL2GasCost(
                                    calldataGasCost[i],
                                  ),
                                ),
                          );
                        } else {
                          throw new Error(
                            `getCalldataGasCost returned wrong type in dex ${key}`,
                          );
                        }
                        pp.calldataGasCost = calldataGasCost;
                        return pp;
                      }),
                    );
                  } catch (e) {
                    reject(e);
                  }
                }, reject)
                .finally(() => {
                  clearTimeout(timer);
                });
            },
          );
        } catch (e) {
          this.logger.error(`Error_${key}_getPoolPrices:`, e);
          return [];
        }
      }),
    );

    return dexPoolPrices
      .filter((x): x is ExchangePrices<any> => !!x)
      .flat() // flatten to get all the pools for the swap
      .filter(p => {
        // Pools should only return correct chunks
        if (p.prices.length !== amounts.length) {
          this.logger.error(
            `Error_getPoolPrices: ${p.exchange} returned prices with invalid chunks`,
          );
          return false;
        }

        if (Array.isArray(p.gasCost)) {
          if (p.gasCost.length !== amounts.length) {
            this.logger.error(
              `Error_getPoolPrices: ${p.exchange} returned prices with invalid gasCost array length: ${p.gasCost.length} !== ${amounts.length}`,
            );
            return false;
          }

          for (const [i, amount] of amounts.entries()) {
            if (amount === 0n && p.gasCost[i] !== 0) {
              this.logger.error(
                `Error_getPoolPrices: ${p.exchange} returned prices with invalid gasCost array. At index ${i} amount is 0 but gasCost is ${p.gasCost[i]}`,
              );
              return false;
            }
          }
        }

        if (p.prices.every(pi => pi === 0n)) {
          return false;
        }
        return true;
      });
  }
}
