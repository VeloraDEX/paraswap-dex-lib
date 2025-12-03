import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import {
  Log,
  Logger,
  Token,
  Address,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  ExchangePrices,
} from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IDex } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import { ClearConfig, ClearAdaptersConfig } from './config';
import { Adapter, ClearData, DexParams } from './types';
import { Network, NULL_ADDRESS, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import clearSwapAbi from '../../abi/clear/ClearSwap.json';
import { NumberAsString } from '@paraswap/core';
import { MultiCallParams } from '../../lib/multi-wrapper';

const CLEAR_GAS_COST = 150_000;

interface ClearVault {
  id: string;
  address: string;
  tokens: ClearVaultToken[];
}

interface ClearVaultToken {
  id: string;
  address: string;
  symbol: string;
  decimals: string;
}

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
  protected adapters: {
    [side in SwapSide]?: Adapter[];
  };

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ClearConfig);

  readonly clearSwapIface = new Interface(clearSwapAbi);

  // Cache for vaults to reduce API calls
  private vaultsCacheByNetwork: Map<string, ClearVault[]> = new Map();
  private vaultsCacheLastFetchTime: Map<string, number> = new Map();
  private readonly CACHE_TTL_IN_MILLISECONDS = 60 * 1000; // 1 minute

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    adapters?: { [side in SwapSide]?: Adapter[] },
    logger?: Logger,
  ) {
    super(dexHelper, dexKey);
    this.config = ClearConfig[dexKey][network];
    this.adapters = adapters || ClearAdaptersConfig[network] || {};
    this.logger = logger || dexHelper.getLogger(dexKey);
  }

  getAdapters(side: SwapSide): Adapter[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  /**
   * Query Clear API (GraphQL endpoint) for data
   */
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

  /**
   * Get all vaults from Clear API (with caching)
   */
  private async getAllVaults(): Promise<ClearVault[]> {
    const now = Date.now();
    const cacheKey = `${this.network}`;

    // Return cached vaults if still valid
    const cachedAt = this.vaultsCacheLastFetchTime.get(cacheKey) || 0;
    if (
      this.vaultsCacheByNetwork.has(cacheKey) &&
      now - cachedAt < this.CACHE_TTL_IN_MILLISECONDS
    ) {
      return this.vaultsCacheByNetwork.get(cacheKey)!;
    }

    // Query Clear API for vaults
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
    const vaults = data.clearVaults || [];

    // Update cache
    this.vaultsCacheByNetwork.set(cacheKey, vaults);
    this.vaultsCacheLastFetchTime.set(cacheKey, Date.now());

    this.logger.info(`Fetched ${vaults.length} Clear vaults from API`);

    return vaults;
  }

  /**
   * Process multicall results and group by vault
   * Extracted to reduce cyclomatic complexity in getPricesVolume
   */
  private processMulticallResults(
    results: {
      success: boolean;
      returnData: { amountOut: bigint; ious: bigint };
    }[],
    callInfos: {
      vaultAddress: string;
      poolIdentifier: string;
      isUnit: boolean;
      amountIndex: number;
    }[],
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

  /**
   * Find vaults that contain both srcToken and destToken
   */
  private async findVaultsForTokenPair(
    srcToken: Address,
    destToken: Address,
  ): Promise<ClearVault[]> {
    const allVaults = await this.getAllVaults();

    return allVaults.filter(vault => {
      const tokenAddresses = vault.tokens.map(t => t.address.toLowerCase());
      return (
        tokenAddresses.includes(srcToken.toLowerCase()) &&
        tokenAddresses.includes(destToken.toLowerCase())
      );
    });
  }

  /**
   * Get pool identifiers for a token pair
   * Format: "clear_<vaultAddress>_<srcToken>_<destToken>"
   */
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.config) {
      this.logger.error(`No config for ${this.dexKey} on ${this.network}`);
      return [];
    }

    try {
      const vaults = await this.findVaultsForTokenPair(
        srcToken.address,
        destToken.address,
      );

      if (vaults.length === 0) {
        this.logger.info(
          `No Clear vaults found for ${srcToken.symbol}-${destToken.symbol}`,
        );
        return [];
      }

      return vaults.map(vault =>
        `${this.dexKey}_${vault.address}_${srcToken.address}_${destToken.address}`.toLowerCase(),
      );
    } catch (error) {
      this.logger.error('Error in getPoolIdentifiers:', error);
      return [];
    }
  }

  /**
   * Get prices for swapping through Clear vaults
   * Uses ClearSwap.previewSwap() via multicall for efficient batched pricing
   *
   * @param limitPools - Optional list of pool identifiers to restrict pricing to.
   *                     When provided, only these specific pools will be priced
   *                     instead of discovering all available pools for the token pair.
   *                     Format: "clear_<vaultAddress>_<srcToken>_<destToken>"
   */
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

      // Clear only supports SELL side (exact input)
      // previewSwap returns amountOut for given amountIn, not the reverse
      if (side === SwapSide.BUY) {
        return null;
      }

      // Get pool identifiers
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

      // Build multicall requests for all vaults and all amounts
      // For each vault: N amounts + 1 unit price = N+1 calls
      type CallInfo = {
        vaultAddress: string;
        poolIdentifier: string;
        isUnit: boolean;
        amountIndex: number;
      };

      const calls: MultiCallParams<{ amountOut: bigint; ious: bigint }>[] = [];
      const callInfos: CallInfo[] = [];

      for (const poolIdentifier of poolIdentifiers) {
        // Extract vault address from pool identifier
        // Format: "clear_<vaultAddress>_<srcToken>_<destToken>"
        const vaultAddress = poolIdentifier.split('_')[1];

        // Add calls for each amount
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

        // Add call for unit price
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

      // Execute all calls in a single multicall batch
      const results = await this.dexHelper.multiWrapper.tryAggregate<{
        amountOut: bigint;
        ious: bigint;
      }>(
        false, // mandatory = false, allow partial failures
        calls,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false, // reportFails = false, we handle failures ourselves
      );

      // Group results by vault
      const vaultResults = this.processMulticallResults(
        results,
        callInfos,
        amounts.length,
      );

      // Build pool prices from results
      const poolPrices: PoolPrices<ClearData>[] = [];

      for (const [vaultAddress, vaultData] of vaultResults) {
        // Skip vault if all prices failed
        if (vaultData.prices.every(p => p === 0n)) {
          this.logger.warn(
            `All prices returned 0 for ${srcToken.symbol}-${destToken.symbol} in vault ${vaultAddress}`,
          );
          continue;
        }

        // Fallback for unit price if it failed
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

      // Return null if no vaults could be priced
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

  /**
   * Generate calldata for executing a swap via ClearSwap
   * Only supports SELL side (exact input)
   */
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: ClearData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) {
      throw new Error('Clear does not support BUY side swaps');
    }

    // Encode ClearSwap.swap() call
    const payload = this.clearSwapIface.encodeFunctionData('swap', [
      NULL_ADDRESS, // receiver (filled by Augustus)
      data.vault, // vault address
      srcToken, // from token
      destToken, // to token
      srcAmount, // amountIn
      destAmount, // minAmountOut
      false, // receiveIOU = false (don't accept IOUs, only real tokens)
    ]);

    return {
      targetExchange: data.router, // ClearSwap address
      payload,
      networkFee: '0',
    };
  }

  /**
   * Generate simple (direct) swap params
   * Only supports SELL side (exact input)
   */
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: ClearData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) {
      throw new Error('Clear does not support BUY side swaps');
    }

    const swapData = this.clearSwapIface.encodeFunctionData('swap', [
      this.augustusAddress, // receiver - Augustus will forward tokens to user
      data.vault,
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      false, // receiveIOU
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.router,
    );
  }

  getCalldataGasCost(_poolPrices: PoolPrices<ClearData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  /**
   * Get top pools for a token
   * Returns vaults containing this token, sorted by totalSupply (TVL proxy)
   */
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.config?.subgraphURL) {
      return [];
    }

    try {
      // Query vaults that contain this token, ordered by totalSupply
      const query = `
        query {
          clearVaultTokens(where: { address_eq: "${tokenAddress.toLowerCase()}" }) {
            vault {
              id
              address
              totalSupply
              tokens {
                address
                symbol
                decimals
              }
            }
          }
        }
      `;

      interface VaultWithSupply {
        id: string;
        address: string;
        totalSupply: string;
        tokens: { address: string; symbol: string; decimals: string }[];
      }

      interface VaultTokenResult {
        vault: VaultWithSupply;
      }

      const data = await this.queryClearAPI<{
        clearVaultTokens: VaultTokenResult[];
      }>(query);
      const vaultTokens = data.clearVaultTokens || [];

      if (vaultTokens.length === 0) {
        return [];
      }

      // Extract unique vaults and sort by totalSupply
      const vaultsMap = new Map<string, VaultWithSupply>();
      for (const vt of vaultTokens) {
        if (vt.vault && !vaultsMap.has(vt.vault.address)) {
          vaultsMap.set(vt.vault.address, vt.vault);
        }
      }

      const vaults = Array.from(vaultsMap.values())
        .sort((a, b) => {
          const supplyA = BigInt(a.totalSupply || '0');
          const supplyB = BigInt(b.totalSupply || '0');
          return supplyB > supplyA ? 1 : supplyB < supplyA ? -1 : 0;
        })
        .slice(0, limit);

      // Convert to PoolLiquidity format
      const poolLiquidities: PoolLiquidity[] = [];

      for (const vault of vaults) {
        // Get all other tokens in this vault (connectors)
        const connectorTokens = vault.tokens
          .filter(t => t.address.toLowerCase() !== tokenAddress.toLowerCase())
          .map(t => ({
            address: t.address,
            decimals: parseInt(t.decimals, 10),
          }));

        if (connectorTokens.length === 0) {
          continue;
        }

        poolLiquidities.push({
          exchange: this.dexKey,
          address: vault.address,
          connectorTokens,
          // Use totalSupply as liquidity proxy (in USD would be better but not available)
          liquidityUSD: Number(vault.totalSupply || 0) / 1e18,
        });
      }

      return poolLiquidities;
    } catch (error) {
      this.logger.error('Error in getTopPoolsForToken:', error);
      return [];
    }
  }
}
