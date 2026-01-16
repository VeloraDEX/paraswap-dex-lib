import { Interface } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
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
import { ClearFactory } from './clear-factory';

const CLEAR_GAS_COST = 150_000;

/**
 * Clear DEX Integration for ParaSwap
 *
 * Clear is a depeg arbitrage protocol for stablecoins
 * - Vaults contain N tokens (multi-token, not pairs)
 * - Pricing via ClearSwap.previewSwap() - returns 0 when no depeg
 * - Discovery via StatefulEventSubscriber (getters + NewClearVault events)
 * - Each (vault, tokenA, tokenB) combination = one "pool" for ParaSwap
 */
export class Clear extends SimpleExchange implements IDex<ClearData> {
  static dexKeys = ['clear'];
  logger: Logger;
  protected config: DexParams;
  protected factory: ClearFactory;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ClearConfig);

  readonly clearSwapIface = new Interface(clearSwapAbi);

  // Vault cache - updated by factory subscriber
  private vaults: ClearVault[] = [];

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = ClearConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);

    // Initialize factory subscriber with callback to update vaults
    this.factory = new ClearFactory(
      dexKey,
      this.config,
      network,
      dexHelper,
      this.logger,
      this.onVaultsUpdated.bind(this),
    );
  }

  /**
   * Callback when factory detects new vaults
   */
  private onVaultsUpdated(vaults: DeepReadonly<ClearVault[]>): void {
    this.updateVaultsFromState(vaults);
    this.logger.info(
      `${this.dexKey}: Vaults updated, count: ${this.vaults.length}`,
    );
  }

  getAdapters(_side: SwapSide): null {
    return null;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    // Initialize factory and fetch initial state
    await this.factory.initialize(blockNumber);
    const vaults = await this.factory.getStateOrGenerate(blockNumber);
    this.updateVaultsFromState(vaults);
    this.logger.info(
      `${this.dexKey}: Initialized ${this.vaults.length} vaults`,
    );
  }

  /**
   * Deep copy vaults from readonly state to mutable cache
   */
  private updateVaultsFromState(vaults: DeepReadonly<ClearVault[]>): void {
    this.vaults = vaults.map(v => ({
      id: v.id,
      address: v.address,
      tokens: v.tokens.map(t => ({
        id: t.id,
        address: t.address,
        symbol: t.symbol,
        decimals: t.decimals,
      })),
    }));
  }

  releaseResources(): AsyncOrSync<void> {
    this.logger.info(`${this.dexKey}: released resources`);
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
        // Expected when no depeg exists - previewSwap reverts with AssetIsNotDepeg
        this.logger.debug(
          info.isUnit
            ? `No price for vault ${info.vaultAddress} (no depeg)`
            : `No swap available for amount index ${info.amountIndex} in vault ${info.vaultAddress}`,
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
          // Expected when no depeg - skip this vault
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
        // Expected when no depeg exists
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
