import {
  Token,
  Address,
  ExchangePrices,
  AdapterExchangeParam,
  DexExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
} from '../../types';
import {
  SwapSide,
  Network,
  NULL_ADDRESS,
  NO_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AaveV3PtRollOverData, DexParams, PendleSDKMarket } from './types';
import { SimpleExchange } from '../simple-exchange';
import { AaveV3PtRollOverConfig } from './config';
import { Interface } from '@ethersproject/abi';
import PENDLE_ORACLE_ABI from '../../abi/PendleOracle.json';
import {
  AAVE_V3_PT_ROLL_OVER_GAS_COST,
  DEFAULT_SLIPPAGE_FOR_QUOTTING,
  PENDLE_API_URL,
} from './constants';
import { BI_POWS } from '../../bigint-constants';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { oracleStateDecoder, ptToAssetRateDecoder } from './utils';

export class AaveV3PtRollOver
  extends SimpleExchange
  implements IDex<AaveV3PtRollOverData>
{
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  private config: DexParams;
  private marketsCache: Map<string, PendleSDKMarket> = new Map();
  private oracleInterface: Interface;

  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AaveV3PtRollOverConfig);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected unitPrice = BI_POWS[18],
  ) {
    super(dexHelper, dexKey);
    this.config = AaveV3PtRollOverConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
    this.oracleInterface = new Interface(PENDLE_ORACLE_ABI);
  }

  getAdapters(): { name: string; index: number }[] | null {
    return null;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    // Try to fetch real market data from Pendle API
    await this.fetchRealMarketData();
  }

  /**
   * Fetch real market data from Pendle API - Use static configuration for now
   * Note: Market discovery endpoints may require authentication
   */
  private async fetchRealMarketData(): Promise<void> {
    // For now, use static configuration since market discovery endpoints
    // may require authentication or different API structure
    this.populateFallbackMarkets();
  }

  /**
   * Populate markets from static configuration when API is unavailable
   * This uses the actual market addresses from the configuration, not mock data
   */
  private populateFallbackMarkets(): void {
    const configuredMarkets: PendleSDKMarket[] = [
      {
        address: this.config.oldMarketAddress,
        ptAddress: this.config.oldPendleToken.address,
        ptDecimals: this.config.oldPendleToken.decimals,
        ytAddress: NULL_ADDRESS, // YT address not needed for rollover
        underlyingAssetAddress:
          this.config.underlyingAssetAddress.toLowerCase(),
        name: this.config.oldPendleToken.name,
        expiry: this.config.oldPendleToken.expiry,
        chainId: this.network,
      },
      {
        address: this.config.newMarketAddress,
        ptAddress: this.config.newPendleToken.address,
        ptDecimals: this.config.newPendleToken.decimals,
        ytAddress: NULL_ADDRESS, // YT address not needed for rollover
        underlyingAssetAddress:
          this.config.underlyingAssetAddress.toLowerCase(),
        name: this.config.newPendleToken.name,
        expiry: this.config.newPendleToken.expiry,
        chainId: this.network,
      },
    ];

    configuredMarkets.forEach(market => {
      this.marketsCache.set(market.ptAddress.toLowerCase(), market);
    });

    this.logger.info(
      `${this.dexKey}-${this.network}: Populated ${this.marketsCache.size} markets from static configuration`,
    );
  }

  /**
   * Get market details for a given PT address
   */
  private getMarketForPt(ptAddress: Address): PendleSDKMarket | null {
    const normalizedAddress = ptAddress.toLowerCase();

    return this.marketsCache.get(normalizedAddress) ?? null;
  }

  /**
   * Batch all oracle calls using multicall for better performance
   */
  private async batchOracleCallsMulticall(
    srcMarketAddress: Address,
    destMarketAddress: Address,
    blockNumber: number,
    duration: number = 1800,
  ): Promise<[boolean, boolean, bigint, bigint]> {
    // Prepare all calls
    const calls: MultiCallParams<boolean | bigint>[] = [
      // Source market oracle state check
      {
        target: this.config.oracleAddress,
        callData: this.oracleInterface.encodeFunctionData('getOracleState', [
          srcMarketAddress,
          duration,
        ]),
        decodeFunction: oracleStateDecoder,
      },
      // Destination market oracle state check
      {
        target: this.config.oracleAddress,
        callData: this.oracleInterface.encodeFunctionData('getOracleState', [
          destMarketAddress,
          duration,
        ]),
        decodeFunction: oracleStateDecoder,
      },
      // Source market PT to asset rate
      {
        target: this.config.oracleAddress,
        callData: this.oracleInterface.encodeFunctionData('getPtToAssetRate', [
          srcMarketAddress,
          duration,
        ]),
        decodeFunction: ptToAssetRateDecoder,
      },
      // Destination market PT to asset rate
      {
        target: this.config.oracleAddress,
        callData: this.oracleInterface.encodeFunctionData('getPtToAssetRate', [
          destMarketAddress,
          duration,
        ]),
        decodeFunction: ptToAssetRateDecoder,
      },
    ];

    // Execute all calls in one multicall
    const [
      srcOracleReady,
      destOracleReady,
      srcPtToAssetRate,
      destPtToAssetRate,
    ] = await this.dexHelper.multiWrapper.tryAggregate(
      true,
      calls,
      blockNumber,
    );

    return [
      srcOracleReady.returnData as boolean,
      destOracleReady.returnData as boolean,
      srcPtToAssetRate.returnData as bigint,
      destPtToAssetRate.returnData as bigint,
    ];
  }

  isOldPendleToken(address: Address): boolean {
    return (
      address.toLowerCase() === this.config.oldPendleToken.address.toLowerCase()
    );
  }

  isNewPendleToken(address: Address): boolean {
    return (
      address.toLowerCase() === this.config.newPendleToken.address.toLowerCase()
    );
  }

  isAppropriatePair(srcToken: Token, destToken: Token): boolean {
    // Check if both tokens are Pendle PTs
    const srcMarket = this.getMarketForPt(srcToken.address);
    const destMarket = this.getMarketForPt(destToken.address);

    if (!srcMarket || !destMarket) {
      return false;
    }

    // Ensure both PTs are for the same underlying asset
    if (
      srcMarket.underlyingAssetAddress !== destMarket.underlyingAssetAddress
    ) {
      return false;
    }

    return (
      this.isOldPendleToken(srcToken.address) &&
      this.isNewPendleToken(destToken.address)
    );
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.isAppropriatePair(srcToken, destToken)) {
      return [];
    }

    return [this.getPoolIdentifier(srcToken, destToken)];
  }

  getPoolIdentifier(srcToken: Token, destToken: Token): string {
    const srcMarket = this.getMarketForPt(srcToken.address);
    const destMarket = this.getMarketForPt(destToken.address);

    if (!srcMarket || !destMarket) {
      return '';
    }

    return `${this.dexKey}_${srcMarket.address}_${destMarket.address}`.toLowerCase();
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<AaveV3PtRollOverData>> {
    if (!this.isAppropriatePair(srcToken, destToken)) {
      return null;
    }

    // Get market details
    const srcMarket = this.getMarketForPt(srcToken.address)!;
    const destMarket = this.getMarketForPt(destToken.address)!;

    // Batch all oracle calls using multicall for better performance
    const [
      srcOracleReady,
      destOracleReady,
      srcPtToAssetRate,
      destPtToAssetRate,
    ] = await this.batchOracleCallsMulticall(
      srcMarket.address,
      destMarket.address,
      blockNumber,
    );

    if (!srcOracleReady || !destOracleReady) {
      this.logger.error(
        `${this.dexKey}-${this.network}: ${srcOracleReady ? '' : 'src'}${
          destOracleReady ? '' : 'dest'
        } oracle not ready`,
      );
      return null;
    }

    const prices: bigint[] = [];

    // Calculate exchange rate: srcPT -> asset -> destPT
    // srcPtAmount * srcPtToAssetRate / destPtToAssetRate = destPtAmount
    const exchangeRate =
      (srcPtToAssetRate * this.unitPrice) / destPtToAssetRate;

    for (const amount of amounts) {
      if (amount === 0n) {
        prices.push(0n);
        continue;
      }

      // Calculate output amount
      const outputAmount = (amount * exchangeRate) / this.unitPrice;
      prices.push(outputAmount);
    }

    const data: AaveV3PtRollOverData = {
      srcMarketAddress: srcMarket.address,
      destMarketAddress: destMarket.address,
    };

    return [
      {
        prices,
        unit: this.unitPrice,
        data,
        poolAddresses: [srcMarket.address],
        exchange: this.dexKey,
        gasCost: AAVE_V3_PT_ROLL_OVER_GAS_COST,
        poolIdentifier: this.getPoolIdentifier(srcToken, destToken),
      },
    ];
  }

  getCalldataGasCost(): number | number[] {
    // Based on Pendle transaction complexity - simpler since we're using oracle
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AaveV3PtRollOverData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = '0x';

    return {
      targetExchange: this.config.pendleRouterAddress,
      payload,
      networkFee: '0',
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const market = this.getMarketForPt(tokenAddress);

    if (!market) {
      // If it's not a PT token we support, return empty
      return [];
    }

    const isOldPT = this.isOldPendleToken(tokenAddress);

    const rolloverOpportunities: PoolLiquidity[] = [];

    for (const [ptAddress, cachedMarket] of this.marketsCache) {
      const isDifferentPt = ptAddress !== tokenAddress.toLowerCase();
      const isSameUnderlying =
        cachedMarket.underlyingAssetAddress.toLowerCase() ===
        market.underlyingAssetAddress.toLowerCase();

      if (isDifferentPt && isSameUnderlying) {
        rolloverOpportunities.push({
          exchange: this.dexKey,
          address: cachedMarket.address,
          connectorTokens: [
            {
              address: cachedMarket.ptAddress,
              decimals: cachedMarket.ptDecimals,
              liquidityUSD: isOldPT ? NO_USD_LIQUIDITY : 1000000000,
            },
          ],
          liquidityUSD: isOldPT ? 1000000000 : NO_USD_LIQUIDITY,
        });
      }
    }

    return rolloverOpportunities.slice(0, limit);
  }

  public async updatePoolState(): Promise<void> {
    // If cache is empty, try to fetch real market data
    if (this.marketsCache.size === 0) {
      await this.fetchRealMarketData();
    }
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AaveV3PtRollOverData,
    side: SwapSide,
    context: Context,
    executorAddress: Address,
  ): Promise<DexExchangeParam> {
    // Call Pendle SDK roll-over-pt endpoint for PT rollover
    const rollOverParams = {
      receiver: recipient,
      slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING,
      dstMarket: data.destMarketAddress,
      ptAmount: srcAmount,
    };

    const response = await this.callPendleSdkApi(
      `/v1/sdk/${this.network}/markets/${data.srcMarketAddress}/roll-over-pt`,
      rollOverParams,
    );

    if (!response.success) {
      throw new Error(
        `Pendle SDK roll-over-pt endpoint failed: ${
          response.error || 'No transaction data returned'
        }`,
      );
    }

    // Extract transaction data from response
    const txData = response.tx || response.data?.tx || response.data;

    if (!txData || !txData.to || !txData.data) {
      throw new Error(
        `Pendle SDK response missing transaction data. Response: ${JSON.stringify(
          response,
        )}`,
      );
    }

    return {
      targetExchange: txData.to, // This should be the Pendle Router address
      exchangeData: txData.data, // The actual encoded transaction data
      needWrapNative: false,
      dexFuncHasRecipient: true,
      returnAmountPos: 0,
    };
  }

  /**
   * Call Pendle SDK API for transaction construction
   */
  private async callPendleSdkApi(endpoint: string, params: any): Promise<any> {
    try {
      // Build URL with query parameters for GET requests
      const url = new URL(`${PENDLE_API_URL}${endpoint}`);
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          url.searchParams.append(key, params[key].toString());
        }
      });

      const response = await this.dexHelper.httpRequest.get(
        url.toString(),
        30000, // 30 second timeout
        {
          Accept: 'application/json',
        },
      );

      const responseData = response as any;
      return {
        success: true,
        data: responseData.data || responseData, // Handle different response structures
        tx: responseData.tx || responseData.data?.tx, // Extract transaction data
      };
    } catch (error: any) {
      this.logger.error(
        `${this.dexKey}-${this.network}: Pendle SDK API call failed for ${endpoint}:`,
        error,
      );

      return {
        success: false,
        error: error?.message || 'Unknown error',
        data: null,
      };
    }
  }
}
