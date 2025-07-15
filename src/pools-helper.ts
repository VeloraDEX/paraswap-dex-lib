import { LoggerConstructor, PoolLiquidity, Logger, Address } from './types';
import { DexAdapterService } from './dex';

export class PoolsHelper {
  logger: Logger;

  constructor(
    protected dexAdapterService: DexAdapterService,
    loggerConstructor: LoggerConstructor,
  ) {
    this.logger = loggerConstructor(`PoolsHelper_${dexAdapterService.network}`);
  }

  public getAllDexKeys(): string[] {
    return this.dexAdapterService.getAllDexKeys();
  }

  private async getTopPoolsDex(
    tokenAddress: Address,
    dexKey: string,
    count: number,
  ): Promise<PoolLiquidity[] | string> {
    try {
      const dex = this.dexAdapterService.getDexByKey(dexKey);
      return await dex.getTopPoolsForToken(tokenAddress, count);
    } catch (e) {
      this.logger.error(`getTopPools_${dexKey}`, e);
      return dexKey;
    }
  }

  async updateDexPoolState(dexKey: string) {
    try {
      const dexInstance = this.dexAdapterService.getDexByKey(dexKey);
      if (!dexInstance.updatePoolState) return;

      return await dexInstance.updatePoolState();
    } catch (e) {
      this.logger.error(`Error_updateDexPoolState, dex: ${dexKey}`, e);
    }
  }

  async updateAllPoolState(dexKeys: string[]) {
    return await Promise.all(dexKeys.map(key => this.updateDexPoolState(key)));
  }

  public async getTopPools(
    tokenAddress: Address,
    dexKeys: string[],
    countPerDex: number,
  ): Promise<(PoolLiquidity | string)[]> {
    return (
      await Promise.all(
        dexKeys.map(key => this.getTopPoolsDex(tokenAddress, key, countPerDex)),
      )
    ).flat();
  }
}
