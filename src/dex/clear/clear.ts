import { Interface } from '@ethersproject/abi';

import {
  Logger,
  Token,
  Address,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  ConnectorToken,
  ExchangePrices,
  DexExchangeParam,
} from '../../types';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { IDex } from '../idex';
import { SimpleExchange } from '../simple-exchange';
import { ClearConfig } from './config';
import { ClearData, ClearVault, DexParams } from './types';
import { Network, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import clearSwapAbi from '../../abi/clear/ClearSwap.json';
import clearVaultAbi from '../../abi/clear/ClearVault.json';
import { NumberAsString } from '@paraswap/core';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { ClearFactory } from './clear-factory';
import { uint256ToBigInt, uint8ToNumber } from '../../lib/decoders';
import { extractReturnAmountPosition } from '../../executor/utils';

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
  logger: Logger;
  protected config: DexParams;
  protected factory: ClearFactory;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ClearConfig);

  readonly clearSwapIface = new Interface(clearSwapAbi);
  readonly clearVaultIface = new Interface(clearVaultAbi);
  private vaults: ClearVault[] = [];

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = ClearConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);

    this.factory = new ClearFactory(
      dexKey,
      this.config,
      network,
      dexHelper,
      this.logger,
    );
  }

  getAdapters(_side: SwapSide): null {
    return null;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    await this.factory.initialize(blockNumber);
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const allVaults = this.factory.getState(blockNumber) || [];
    const src = srcToken.address.toLowerCase();
    const dest = destToken.address.toLowerCase();

    const matchingVaults = allVaults.filter(vault => {
      const addrs = vault.tokens;
      return addrs.includes(src) && addrs.includes(dest);
    });

    return matchingVaults.map(vault =>
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
    // Only SELL side supported
    if (side === SwapSide.BUY) {
      return null;
    }

    const poolIdentifiers =
      limitPools ||
      (await this.getPoolIdentifiers(srcToken, destToken, side, blockNumber));

    if (poolIdentifiers.length === 0) {
      return null;
    }

    try {
      const calls: MultiCallParams<bigint>[] = [];
      const vaultInfos = [];

      for (const poolIdentifier of poolIdentifiers) {
        const vaultAddress = poolIdentifier.split('_')[1];
        const startIdx = calls.length;

        for (const amount of amounts.slice(1)) {
          calls.push({
            target: this.config.swapAddress,
            callData: this.clearSwapIface.encodeFunctionData('previewSwap', [
              vaultAddress,
              srcToken.address,
              destToken.address,
              amount,
            ]),
            decodeFunction: (result: any) => result.amountOut.toBigInt(),
          });
        }

        vaultInfos.push({ address: vaultAddress, poolIdentifier, startIdx });
      }

      const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        calls,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

      const poolPrices: PoolPrices<ClearData>[] = [];

      for (const { address, poolIdentifier, startIdx } of vaultInfos) {
        const prices = [
          0n,
          ...amounts.slice(1).map((_, i) => {
            const r = results[startIdx + i];
            return r.success ? r.returnData : 0n;
          }),
        ];

        if (prices.every(p => p === 0n)) continue;

        poolPrices.push({
          prices,
          unit: getBigIntPow(destToken.decimals),
          data: { vault: address },
          poolIdentifiers: [poolIdentifier],
          exchange: this.dexKey,
          gasCost: this.config.poolGasCost || CLEAR_GAS_COST,
          poolAddresses: [address],
        });
      }

      return poolPrices.length > 0 ? poolPrices : null;
    } catch (error) {
      this.logger.error(`getPricesVolume error: ${error}`);
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
      targetExchange: this.config.swapAddress,
      returnAmountPos: extractReturnAmountPosition(
        this.clearSwapIface,
        'swap',
        'amountOut',
      ),
    };
  }

  /**
   * Gas cost for exchangeData calldata
   * swap(address recipient, address vault, address srcToken, address destToken, uint256 srcAmount, uint256 destAmount, bool useIous)
   */
  getCalldataGasCost(_poolPrices: PoolPrices<ClearData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.ADDRESS + // recipient
      CALLDATA_GAS_COST.ADDRESS + // vault
      CALLDATA_GAS_COST.ADDRESS + // srcToken
      CALLDATA_GAS_COST.ADDRESS + // destToken
      CALLDATA_GAS_COST.AMOUNT + // srcAmount
      CALLDATA_GAS_COST.AMOUNT + // destAmount
      CALLDATA_GAS_COST.BOOL // useIous
    );
  }

  /**
   * Fetch vaults with tokens, decimals and TVL for getTopPoolsForToken
   * This method is called by PoolTracker service which doesn't call initializePricing
   */
  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    const vaults = await this.factory.getStateOrGenerate(blockNumber);

    if (vaults.length === 0) {
      return this.logger.info(
        `${this.dexKey}: No vaults found in updatePoolState`,
      );
    }

    const uniqueTokens = [...new Set(vaults.flatMap(v => v.tokens))];

    const decimalCalls: MultiCallParams<bigint>[] = uniqueTokens.map(token => ({
      target: token,
      callData: '0x313ce567', // decimals()
      decodeFunction: (result: any) => BigInt(uint8ToNumber(result)),
    }));

    // Build tokenAssets(tokenAddress) calls for each token in each vault
    const tokenAssetsCalls: MultiCallParams<bigint>[] = [];
    const tokenAssetsMap: { vaultIdx: number; tokenAddress: string }[] = [];
    for (let i = 0; i < vaults.length; i++) {
      for (const token of vaults[i].tokens) {
        tokenAssetsCalls.push({
          target: vaults[i].address,
          callData: this.clearVaultIface.encodeFunctionData('tokenAssets', [
            token,
          ]),
          decodeFunction: uint256ToBigInt,
        });
        tokenAssetsMap.push({ vaultIdx: i, tokenAddress: token });
      }
    }

    const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      false,
      [...decimalCalls, ...tokenAssetsCalls],
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
      false,
    );

    const decimalsOffset = uniqueTokens.length;

    const tokenDecimals: Record<string, number> = {};
    for (let i = 0; i < decimalsOffset; i++) {
      const result = results[i];
      tokenDecimals[uniqueTokens[i]] = result.success
        ? Number(result.returnData)
        : 18;
    }

    // Group tokenAssets results by vault index
    const vaultTokenAssets: Record<string, bigint>[] = vaults.map(() => ({}));
    for (let i = 0; i < tokenAssetsMap.length; i++) {
      const { vaultIdx, tokenAddress } = tokenAssetsMap[i];
      const result = results[decimalsOffset + i];
      if (result.success) {
        vaultTokenAssets[vaultIdx][tokenAddress.toLowerCase()] =
          result.returnData;
      }
    }

    this.vaults = vaults.map((vault, i) => ({
      address: vault.address,
      tokens: vault.tokens.map(t => ({
        address: t,
        decimals: tokenDecimals[t.toLowerCase()] ?? 18,
      })),
      tokenAssets: vaultTokenAssets[i],
    }));
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const tokenAddrLower = tokenAddress.toLowerCase();

    const vaultsWithToken = this.vaults.filter(vault =>
      vault.tokens.some(t => t.address.toLowerCase() === tokenAddrLower),
    );

    if (vaultsWithToken.length === 0) {
      return [];
    }

    // Build a flat list of [tokenAddress, assets] for all tokens across all vaults
    const tokenAmountPairs: [Address, bigint | null][] = [];
    const vaultTokenCounts: number[] = [];
    for (const vault of vaultsWithToken) {
      vaultTokenCounts.push(vault.tokens.length);
      for (const t of vault.tokens) {
        const addr = t.address.toLowerCase();
        tokenAmountPairs.push([t.address, vault.tokenAssets[addr] ?? null]);
      }
    }

    const usdAmounts = await this.dexHelper.getUsdTokenAmounts(
      tokenAmountPairs,
    );

    // Map per-token USD amounts to PoolLiquidity entries
    let offset = 0;
    const poolLiquidities = vaultsWithToken
      .map((vault, i) => {
        const count = vaultTokenCounts[i];
        const tokenUsdMap: Record<string, number> = {};
        for (let j = 0; j < count; j++) {
          const addr = vault.tokens[j].address.toLowerCase();
          tokenUsdMap[addr] = usdAmounts[offset + j];
        }
        offset += count;

        const connectorTokens: ConnectorToken[] = vault.tokens
          .filter(t => t.address.toLowerCase() !== tokenAddrLower)
          .map(t => ({
            address: t.address,
            decimals: t.decimals ?? 18,
            liquidityUSD: tokenUsdMap[t.address.toLowerCase()],
          }));

        if (connectorTokens.length === 0) return null;

        return {
          exchange: this.dexKey,
          address: vault.address,
          connectorTokens,
          liquidityUSD: tokenUsdMap[tokenAddrLower] ?? 0,
        };
      })
      .filter((p): p is PoolLiquidity => p !== null);

    return poolLiquidities
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }
}
