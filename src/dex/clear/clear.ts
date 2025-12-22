import { Interface } from '@ethersproject/abi';
import { AsyncOrSync } from 'ts-essentials';
import {
  Logger,
  Token,
  Address,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  ExchangePrices,
  DexExchangeParam,
} from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IDex } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import { ClearConfig } from './config';
import { ClearData, ClearVault, DexParams, PreviewSwapCallInfo } from './types';
import { Network, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import clearSwapAbi from '../../abi/clear/ClearSwap.json';
import { NumberAsString } from '@paraswap/core';
import { MultiCallParams } from '../../lib/multi-wrapper';

const CLEAR_GAS_COST = 150_000;

/**
 * Clear DEX Integration for ParaSwap
 *
 * Clear is a custom multi-token vault protocol (NOT a standard AMM)
 * - Vaults contain N tokens (not just 2 like Uniswap pools)
 * - Pricing via ClearSwap.previewSwap() RPC call (no x*y=k formula)
 * - Discovery via GraphQL indexer
 * - Each (vault, tokenA, tokenB) combination = one "pool" for ParaSwap
 */
export class Clear extends SimpleExchange implements IDex<ClearData> {
  static dexKeys = ['clear'];
  logger: Logger;
  protected config: DexParams;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ClearConfig);

  readonly clearSwapIface = new Interface(clearSwapAbi);

  // Vault cache - updated periodically via timer
  private vaults: ClearVault[] = [];
  private vaultsUpdateTimer?: NodeJS.Timeout;
  private readonly VAULTS_CACHE_TTL_MS = 60 * 1000; // 1 minute

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = ClearConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
  }

  getAdapters(_side: SwapSide): null {
    return null;
  }

  async initializePricing(_blockNumber: number): Promise<void> {
    await this.fetchAndCacheVaults();

    if (!this.vaultsUpdateTimer) {
      this.vaultsUpdateTimer = setInterval(async () => {
        try {
          await this.fetchAndCacheVaults();
        } catch (e) {
          this.logger.error(
            `${this.dexKey}: Failed to update vaults cache:`,
            e,
          );
        }
      }, this.VAULTS_CACHE_TTL_MS);
    }
  }

  releaseResources(): AsyncOrSync<void> {
    if (this.vaultsUpdateTimer) {
      clearInterval(this.vaultsUpdateTimer);
      this.vaultsUpdateTimer = undefined;
      this.logger.info(`${this.dexKey}: cleared vaults update timer`);
    }
  }

  private async queryClearAPI<T>(query: string): Promise<T> {
    if (!this.config?.subgraphURL) {
      throw new Error(
        `Clear API endpoint not configured for ${this.dexKey} on ${this.network}`,
      );
    }

    const body = JSON.stringify({ query });

    try {
      const response = await fetch(this.config.subgraphURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Clear API returned ${response.status}: ${responseText}`,
        );
      }

      let json: { data?: T; errors?: unknown[] };
      try {
        json = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Failed to parse Clear API response: ${responseText}`);
      }

      if (json.errors) {
        this.logger.error('Clear API errors:', json.errors);
        throw new Error(
          `Clear API query failed: ${JSON.stringify(json.errors)}`,
        );
      }

      return json.data as T;
    } catch (error) {
      this.logger.error('Failed to query Clear API:', error);
      throw error;
    }
  }

  private async fetchAndCacheVaults(): Promise<void> {
    const query = `
      query {
        clearVaults {
          id
          address
          tokens {
            id
            address
            symbol
            decimals
          }
        }
      }
    `;

    const data = await this.queryClearAPI<{ clearVaults: ClearVault[] }>(query);
    this.vaults = data.clearVaults || [];
    this.logger.debug(`Fetched ${this.vaults.length} Clear vaults from API`);
  }

  private processMulticallResults(
    results: {
      success: boolean;
      returnData: { amountOut: bigint; ious: bigint };
    }[],
    callInfos: PreviewSwapCallInfo[],
    amountsLength: number,
  ): Map<string, { poolIdentifier: string; prices: bigint[]; unit: bigint }> {
    const vaultResults = new Map<
      string,
      { poolIdentifier: string; prices: bigint[]; unit: bigint }
    >();

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const info = callInfos[i];

      if (!vaultResults.has(info.vaultAddress)) {
        vaultResults.set(info.vaultAddress, {
          poolIdentifier: info.poolIdentifier,
          prices: new Array(amountsLength).fill(0n),
          unit: 0n,
        });
      }

      if (!result.success) {
        this.logger.error(
          info.isUnit
            ? `Failed to get unit price for vault ${info.vaultAddress}`
            : `Failed to preview swap for amount index ${info.amountIndex} in vault ${info.vaultAddress}`,
        );
        continue;
      }

      const vaultData = vaultResults.get(info.vaultAddress)!;
      if (info.isUnit) {
        vaultData.unit = result.returnData.amountOut;
        continue;
      }
      vaultData.prices[info.amountIndex] = result.returnData.amountOut;
    }

    return vaultResults;
  }

  private findVaultsForTokenPair(
    srcToken: Address,
    destToken: Address,
  ): ClearVault[] {
    return this.vaults.filter(vault => {
      const tokenAddresses = vault.tokens.map(t => t.address.toLowerCase());
      return (
        tokenAddresses.includes(srcToken.toLowerCase()) &&
        tokenAddresses.includes(destToken.toLowerCase())
      );
    });
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (!this.config) {
      this.logger.error(`No config for ${this.dexKey} on ${this.network}`);
      return [];
    }

    const vaults = this.findVaultsForTokenPair(
      srcToken.address,
      destToken.address,
    );

    if (vaults.length === 0) {
      return [];
    }

    return vaults.map(vault =>
      `${this.dexKey}_${vault.address}_${srcToken.address}_${destToken.address}`.toLowerCase(),
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<ClearData>> {
    try {
      if (!this.config) {
        this.logger.debug(
          `No config available for ${this.dexKey} on network ${this.network}`,
        );
        return null;
      }

      // Only SELL side supported
      if (side === SwapSide.BUY) {
        return null;
      }

      const poolIdentifiers =
        limitPools ||
        (await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber));

      if (poolIdentifiers.length === 0) {
        this.logger.debug(
          `No pools found for ${srcToken.symbol}-${destToken.symbol}`,
        );
        return null;
      }

      const unitAmount = BigInt(10) ** BigInt(srcToken.decimals);

      const calls: MultiCallParams<{ amountOut: bigint; ious: bigint }>[] = [];
      const callInfos: PreviewSwapCallInfo[] = [];

      for (const poolIdentifier of poolIdentifiers) {
        const vaultAddress = poolIdentifier.split('_')[1];

        for (let i = 0; i < amounts.length; i++) {
          const callData = this.clearSwapIface.encodeFunctionData(
            'previewSwap',
            [vaultAddress, srcToken.address, destToken.address, amounts[i]],
          );

          calls.push({
            target: this.config.swapAddress,
            callData,
            decodeFunction: (result: any) => {
              const decoded = this.clearSwapIface.decodeFunctionResult(
                'previewSwap',
                result,
              );
              return {
                amountOut: BigInt(decoded.amountOut.toString()),
                ious: BigInt(decoded.ious.toString()),
              };
            },
          });

          callInfos.push({
            vaultAddress,
            poolIdentifier,
            isUnit: false,
            amountIndex: i,
          });
        }

        const unitCallData = this.clearSwapIface.encodeFunctionData(
          'previewSwap',
          [vaultAddress, srcToken.address, destToken.address, unitAmount],
        );

        calls.push({
          target: this.config.swapAddress,
          callData: unitCallData,
          decodeFunction: (result: any) => {
            const decoded = this.clearSwapIface.decodeFunctionResult(
              'previewSwap',
              result,
            );
            return {
              amountOut: BigInt(decoded.amountOut.toString()),
              ious: BigInt(decoded.ious.toString()),
            };
          },
        });

        callInfos.push({
          vaultAddress,
          poolIdentifier,
          isUnit: true,
          amountIndex: -1,
        });
      }

      const results = await this.dexHelper.multiWrapper.tryAggregate<{
        amountOut: bigint;
        ious: bigint;
      }>(
        false,
        calls,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

      const vaultResults = this.processMulticallResults(
        results,
        callInfos,
        amounts.length,
      );

      const poolPrices: PoolPrices<ClearData>[] = [];

      for (const [vaultAddress, vaultData] of vaultResults) {
        if (vaultData.prices.every(p => p === 0n)) {
          this.logger.warn(
            `All prices returned 0 for ${srcToken.symbol}-${destToken.symbol} in vault ${vaultAddress}`,
          );
          continue;
        }

        let unit = vaultData.unit;
        if (unit === 0n && vaultData.prices[0] && amounts[0]) {
          unit = (vaultData.prices[0] * unitAmount) / amounts[0];
        }

        poolPrices.push({
          prices: vaultData.prices,
          unit,
          data: {
            vault: vaultAddress,
            router: this.config.swapAddress,
          },
          poolIdentifiers: [vaultData.poolIdentifier],
          exchange: this.dexKey,
          gasCost: this.config.poolGasCost || CLEAR_GAS_COST,
          poolAddresses: [vaultAddress],
        });
      }

      if (poolPrices.length === 0) {
        this.logger.warn(
          `No vaults could be priced for ${srcToken.symbol}-${destToken.symbol}`,
        );
        return null;
      }

      return poolPrices;
    } catch (error) {
      this.logger.error('Error in getPricesVolume:', error);
      return null;
    }
  }

  // Not used in V6, but required by interface
  getAdapterParam(): AdapterExchangeParam {
    return {
      targetExchange: '0x',
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ClearData,
    _side: SwapSide,
  ): DexExchangeParam {
    const exchangeData = this.clearSwapIface.encodeFunctionData('swap', [
      recipient,
      data.vault,
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      false,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.router,
      returnAmountPos: undefined,
    };
  }

  getCalldataGasCost(_poolPrices: PoolPrices<ClearData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const vaultsWithToken = this.vaults.filter(vault =>
      vault.tokens.some(
        t => t.address.toLowerCase() === tokenAddress.toLowerCase(),
      ),
    );

    if (vaultsWithToken.length === 0) {
      return [];
    }

    const tokenInfo = vaultsWithToken[0].tokens.find(
      t => t.address.toLowerCase() === tokenAddress.toLowerCase(),
    );

    if (!tokenInfo) {
      return [];
    }

    const decimals = parseInt(tokenInfo.decimals, 10);
    const amount = BigInt(10) ** BigInt(decimals);

    const tokenUsdPrice = await this.dexHelper.getTokenUSDPrice(
      { address: tokenAddress, decimals },
      amount,
    );

    const poolLiquidities: PoolLiquidity[] = vaultsWithToken
      .map(vault => {
        const connectorTokens = vault.tokens
          .filter(t => t.address.toLowerCase() !== tokenAddress.toLowerCase())
          .map(t => ({
            address: t.address,
            decimals: parseInt(t.decimals, 10),
          }));

        if (connectorTokens.length === 0) {
          return null;
        }

        return {
          exchange: this.dexKey,
          address: vault.address,
          connectorTokens,
          liquidityUSD: tokenUsdPrice,
        };
      })
      .filter((p): p is PoolLiquidity => p !== null);

    return poolLiquidities
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}
