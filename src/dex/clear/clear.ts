import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger, Token, Address } from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  ExchangePrices,
} from '../../types';
import { IDex } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import { ClearConfig, Adapters } from './config';
import { ClearData, DexParams } from './types';
import { Network, NULL_ADDRESS, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import clearSwapAbi from '../../abi/clear/ClearSwap.json';
import clearFactoryAbi from '../../abi/clear/ClearFactory.json';
import { NumberAsString } from '@paraswap/core';

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
  protected adapters: { [side: string]: { name: string; index: number }[] };

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ClearConfig);

  readonly clearSwapIface = new Interface(clearSwapAbi);
  readonly clearFactoryIface = new Interface(clearFactoryAbi);

  // Cache for vaults to reduce GraphQL calls
  private vaultsCache: Map<string, ClearVault[]> = new Map();
  private vaultsCacheTimestamp = 0;
  private readonly CACHE_TTL = 60 * 1000; // 1 minute

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    adapters?: { [side: string]: { name: string; index: number }[] },
    logger?: Logger,
  ) {
    super(dexHelper, dexKey);
    this.config = ClearConfig[dexKey][network];
    this.adapters = adapters || Adapters[network] || {};
    this.logger = logger || dexHelper.getLogger(dexKey);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  /**
   * Query GraphQL endpoint for data
   */
  private async queryGraphQL(query: string): Promise<any> {
    if (!this.config?.subgraphURL) {
      throw new Error(`GraphQL endpoint not configured for ${this.dexKey} on ${this.network}`);
    }

    try {
      const response = await fetch(this.config.subgraphURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const json: any = await response.json();

      if (json.errors) {
        this.logger.error('GraphQL errors:', json.errors);
        throw new Error(`GraphQL query failed: ${JSON.stringify(json.errors)}`);
      }

      return json.data;
    } catch (error) {
      this.logger.error('Failed to query GraphQL:', error);
      throw error;
    }
  }

  /**
   * Get all vaults from GraphQL (with caching)
   */
  private async getAllVaults(): Promise<ClearVault[]> {
    const now = Date.now();
    const cacheKey = `${this.network}`;

    // Return cached vaults if still valid
    if (
      this.vaultsCache.has(cacheKey) &&
      now - this.vaultsCacheTimestamp < this.CACHE_TTL
    ) {
      return this.vaultsCache.get(cacheKey)!;
    }

    // Query GraphQL for vaults
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

    const data = await this.queryGraphQL(query);
    const vaults = data.clearVaults || [];

    // Update cache
    this.vaultsCache.set(cacheKey, vaults);
    this.vaultsCacheTimestamp = now;

    this.logger.info(`Fetched ${vaults.length} Clear vaults from GraphQL`);

    return vaults;
  }

  /**
   * Find vaults that contain both srcToken and destToken
   */
  private async findVaultsForTokenPair(
    srcToken: Address,
    destToken: Address,
  ): Promise<ClearVault[]> {
    const allVaults = await this.getAllVaults();

    return allVaults.filter((vault) => {
      const tokenAddresses = vault.tokens.map((t) =>
        t.address.toLowerCase(),
      );
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
      this.logger.warn(`No config for ${this.dexKey} on ${this.network}`);
      return [];
    }

    try {
      const vaults = await this.findVaultsForTokenPair(
        srcToken.address,
        destToken.address,
      );

      if (vaults.length === 0) {
        this.logger.debug(
          `No Clear vaults found for ${srcToken.symbol}-${destToken.symbol}`,
        );
        return [];
      }

      return vaults.map(
        (vault) =>
          `${this.dexKey}_${vault.address}_${srcToken.address}_${destToken.address}`.toLowerCase(),
      );
    } catch (error) {
      this.logger.error('Error in getPoolIdentifiers:', error);
      return [];
    }
  }

  /**
   * Get prices for swapping through Clear vaults
   * Uses ClearSwap.previewSwap() to get on-chain pricing
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
      if (!this.config) return null;

      // Get pool identifiers
      const poolIdentifiers = limitPools || await this.getPoolIdentifiers(
        srcToken,
        destToken,
        side,
        blockNumber,
      );

      if (poolIdentifiers.length === 0) {
        return null;
      }

      // Create ClearSwap contract instance
      const clearSwap = new this.dexHelper.web3Provider.eth.Contract(
        clearSwapAbi as any,
        this.config.swapAddress,
      );

      const unitAmount = BigInt(10) ** BigInt(srcToken.decimals);
      const poolPrices: PoolPrices<ClearData>[] = [];

      // Get prices for ALL vaults, not just the first one
      for (const poolIdentifier of poolIdentifiers) {
        // Extract vault address from pool identifier
        // Format: "clear_<vaultAddress>_<srcToken>_<destToken>"
        const vaultAddress = poolIdentifier.split('_')[1];

        try {
          // Calculate prices for each amount using previewSwap
          const prices: bigint[] = [];

          for (const amount of amounts) {
            try {
              const result = await clearSwap.methods
                .previewSwap(
                  vaultAddress,
                  srcToken.address,
                  destToken.address,
                  amount.toString(),
                )
                .call({}, blockNumber);

              prices.push(BigInt(result.amountOut));
            } catch (error) {
              this.logger.error(
                `Failed to preview swap for amount ${amount} in vault ${vaultAddress}:`,
                error,
              );
              prices.push(0n);
            }
          }

          // Skip vault if all prices failed
          if (prices.every((p) => p === 0n)) {
            this.logger.warn(
              `All prices returned 0 for ${srcToken.symbol}-${destToken.symbol} in vault ${vaultAddress}`,
            );
            continue;
          }

          // Calculate unit price (for 1 token)
          let unit: bigint;
          try {
            const unitResult = await clearSwap.methods
              .previewSwap(
                vaultAddress,
                srcToken.address,
                destToken.address,
                unitAmount.toString(),
              )
              .call({}, blockNumber);

            unit = BigInt(unitResult.amountOut);
          } catch (error) {
            this.logger.error(`Failed to get unit price for vault ${vaultAddress}:`, error);
            unit = prices[0] || 0n;
          }

          poolPrices.push({
            prices,
            unit,
            data: {
              vault: vaultAddress,
              router: this.config.swapAddress,
            },
            poolIdentifiers: [poolIdentifier],
            exchange: this.dexKey,
            gasCost: this.config.poolGasCost || CLEAR_GAS_COST,
            poolAddresses: [vaultAddress],
          });
        } catch (error) {
          this.logger.error(`Error pricing vault ${vaultAddress}:`, error);
          continue;
        }
      }

      // Return null if no vaults could be priced
      if (poolPrices.length === 0) {
        this.logger.warn(`No vaults could be priced for ${srcToken.symbol}-${destToken.symbol}`);
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
   */
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: ClearData,
    side: SwapSide,
  ): AdapterExchangeParam {
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
   */
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: ClearData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = this.clearSwapIface.encodeFunctionData('swap', [
      NULL_ADDRESS, // receiver
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
   * TODO: Implement based on liquidity data from GraphQL
   */
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // For now, return empty
    // Can be implemented later by querying vaults with this token and sorting by TVL
    return [];
  }
}
