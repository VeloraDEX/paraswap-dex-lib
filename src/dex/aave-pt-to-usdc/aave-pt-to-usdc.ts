import {
  Token,
  Address,
  ExchangePrices,
  AdapterExchangeParam,
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
import {
  AavePtToUsdcData,
  DexParams,
  PendleSDKMarket,
  SupportedPt,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { AavePtToUsdcConfig } from './config';
import { Interface } from '@ethersproject/abi';
import PENDLE_ORACLE_ABI from '../../abi/PendleOracle.json';
import {
  AAVE_PT_TO_USDC_GAS_COST,
  DEFAULT_SLIPPAGE_FOR_QUOTTING,
  PENDLE_API_URL,
} from './constants';
import { BI_POWS } from '../../bigint-constants';
import { DexExchangeParam } from '../../types';
import axios from 'axios';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MAINNET_USDC = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
  name: 'USD Coin',
  symbol: 'USDC',
};

export class AavePtToUsdc
  extends SimpleExchange
  implements IDex<AavePtToUsdcData>
{
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  private config: DexParams;
  private marketsCache: Map<string, PendleSDKMarket> = new Map();
  private oracleInterface: Interface;
  private usdcToken: Token;
  private readonly supportedMarkets: SupportedPt[];

  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AavePtToUsdcConfig);

  constructor(readonly dexHelper: IDexHelper) {
    super(dexHelper, 'AavePtToUsdc');
    this.config = AavePtToUsdcConfig[this.dexKey][this.network];
    this.logger = dexHelper.getLogger(this.dexKey);
    this.oracleInterface = new Interface(PENDLE_ORACLE_ABI);
    if (this.network !== Network.MAINNET) {
      throw new Error('AavePtToUsdc is only supported on Mainnet');
    }
    this.usdcToken = MAINNET_USDC;
    this.supportedMarkets = this.getSupportedMarkets();
  }

  getAdapters(): { name: string; index: number }[] | null {
    return null;
  }

  async initializePricing(blockNumber: number): Promise<void> {
    this.populateMarketsFromConfig();
  }

  private populateMarketsFromConfig(): void {
    this.config.supportedPts.forEach(ptConfig => {
      this.marketsCache.set(ptConfig.pt.address.toLowerCase(), {
        address: ptConfig.marketAddress,
        ptAddress: ptConfig.pt.address,
        ptDecimals: ptConfig.pt.decimals,
        ytAddress: NULL_ADDRESS, // Not needed
        underlyingAssetAddress: ptConfig.underlyingAssetAddress,
        name: ptConfig.pt.name,
        expiry: ptConfig.pt.expiry,
        chainId: this.network,
      });
    });

    this.logger.info(
      `${this.dexKey}-${this.network}: Populated ${this.marketsCache.size} markets from static configuration`,
    );
  }

  private getMarketForPt(ptAddress: Address): PendleSDKMarket | null {
    return this.marketsCache.get(ptAddress.toLowerCase()) ?? null;
  }

  isPairSupported(srcToken: Token, destToken: Token): boolean {
    const ptToken = this._findPtToken(srcToken, destToken);
    if (!ptToken) return false;

    const otherToken =
      ptToken.address.toLowerCase() === srcToken.address.toLowerCase()
        ? destToken
        : srcToken;

    if (
      otherToken.address.toLowerCase() === this.usdcToken.address.toLowerCase()
    ) {
      return true;
    }

    const market = this.getMarketByPtToken(ptToken);
    if (!market) return false;

    return (
      otherToken.address.toLowerCase() ===
      market.underlyingAssetAddress.toLowerCase()
    );
  }

  private _findPtToken(srcToken: Token, destToken: Token): Token | undefined {
    const supportedMarkets = this.getSupportedMarkets();
    this.logger.info(
      `supportedMarkets inside _findPtToken: ${JSON.stringify(
        supportedMarkets,
        null,
        2,
      )}`,
    );
    this.logger.info(
      `Checking srcToken: ${srcToken.symbol} (${srcToken.address})`,
    );
    this.logger.info(
      `Checking destToken: ${destToken.symbol} (${destToken.address})`,
    );
    return [srcToken, destToken].find(t =>
      supportedMarkets.some(
        m => m.pt.address.toLowerCase() === t.address.toLowerCase(),
      ),
    );
  }

  getPoolIdentifier(marketAddress: string): string {
    return `${this.dexKey}_${marketAddress.toLowerCase()}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    this.logger.info(
      `getPoolIdentifiers called with src: ${srcToken.symbol}, dest: ${destToken.symbol}`,
    );
    const ptToken = this._findPtToken(srcToken, destToken);
    this.logger.info(`_findPtToken result: ${ptToken?.symbol}`);

    if (!ptToken) {
      this.logger.warn(
        `Could not find PT token for pair ${srcToken.symbol}-${destToken.symbol}`,
      );
      return [];
    }

    const market = this.getSupportedMarkets().find(
      (m: SupportedPt) =>
        m.pt.address.toLowerCase() === ptToken.address.toLowerCase(),
    );
    this.logger.info(`found market: ${market?.marketAddress}`);

    if (!market) {
      this.logger.warn(`Could not find market for PT ${ptToken.symbol}`);
      return [];
    }

    return [this.getPoolIdentifier(market.marketAddress)];
  }

  private getMarketByPtToken(ptToken: Token): SupportedPt | undefined {
    return this.supportedMarkets.find(
      m => m.pt.address.toLowerCase() === ptToken.address.toLowerCase(),
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<AavePtToUsdcData> | null> {
    const ptToken = this._findPtToken(srcToken, destToken);
    if (!ptToken) return null;

    // FIX: Use market object
    const market = this.getMarketByPtToken(ptToken);
    if (!market) return null;

    const markets = [market]; // Wrap in array for batch processing

    const marketRequests = markets.map(market => {
      const tokenIn = srcToken.address;
      const tokenOut = destToken.address;

      return {
        marketAddress: market.marketAddress,
        queryParams: {
          tokenIn,
          tokenOut,
          amountIn: amounts[amounts.length - 1].toString(),
          slippage: 0.005, // 0.5%
          receiver: this.augustusAddress,
        },
      };
    });

    const swapDataResults = await this._getPendleSwapDataBatch(marketRequests);

    const results: ExchangePrices<AavePtToUsdcData> = [];
    for (let i = 0; i < markets.length; i++) {
      const market = markets[i];
      const swapData = swapDataResults[i];
      if (!swapData) continue;

      const tokenIn =
        srcToken.address.toLowerCase() === market.pt.address.toLowerCase()
          ? market.pt.address
          : market.underlyingAssetAddress;
      const tokenOut =
        destToken.address.toLowerCase() === market.pt.address.toLowerCase()
          ? market.pt.address
          : market.underlyingAssetAddress;

      const marginalPrices = amounts.map(amount => {
        return this._calculateMarginalPrice(
          amount,
          swapData,
          tokenIn,
          tokenOut,
        );
      });

      const unitAmount = BigInt(10 ** srcToken.decimals);
      const unitPrice = this._calculateMarginalPrice(
        unitAmount,
        swapData,
        tokenIn,
        tokenOut,
      );

      results.push({
        prices: marginalPrices,
        unit: unitAmount,
        data: {
          marketAddress: market.marketAddress,
          ptAddress: market.pt.address,
        },
        poolAddresses: [market.marketAddress],
        exchange: this.dexKey,
        gasCost: AAVE_PT_TO_USDC_GAS_COST,
        poolIdentifier: this.getPoolIdentifier(market.marketAddress), // Only one argument now
      });
    }

    return results.length > 0 ? results : null;
  }

  getCalldataGasCost(): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: AavePtToUsdcData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // This is for V5, not used in V6.
    // The target is the pendle router.
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
    if (market) {
      return [
        {
          exchange: this.dexKey,
          address: market.address,
          connectorTokens: [
            {
              address: this.usdcToken.address,
              decimals: this.usdcToken.decimals,
              liquidityUSD: 10_000_000,
            },
          ],
          liquidityUSD: 10_000_000, // Dummy liquidity
        },
      ];
    }
    return [];
  }

  public async updatePoolState(): Promise<void> {
    if (this.marketsCache.size === 0) {
      this.populateMarketsFromConfig();
    }
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AavePtToUsdcData,
    side: SwapSide,
    context: Context,
    executorAddress: Address,
  ): Promise<DexExchangeParam> {
    const amountIn = side === SwapSide.SELL ? srcAmount : destAmount;

    const swapParams = {
      receiver: recipient,
      slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING,
      tokenIn: srcToken,
      tokenOut: destToken,
      amountIn: amountIn.toString(),
      enableAggregator: true,
    };

    const response = await this.callPendleSdkApi(
      `/v2/sdk/${this.network}/markets/${data.marketAddress}/swap`,
      swapParams,
    );

    if (!response.success || !response.tx) {
      throw new Error(
        `Pendle SDK swap endpoint failed: ${
          response.error || 'No transaction data returned'
        }`,
      );
    }

    const txData = response.tx;
    if (!txData || !txData.to || !txData.data) {
      throw new Error(
        `Pendle SDK response missing transaction data. Response: ${JSON.stringify(
          response,
        )}`,
      );
    }

    return {
      targetExchange: txData.to,
      exchangeData: txData.data,
      needWrapNative: false,
      dexFuncHasRecipient: true,
      returnAmountPos: 0,
    };
  }

  private async callPendleSdkApi(
    endpoint: string,
    params: any,
    attempt = 0,
    maxRetries = 3,
    backoff = 1000,
  ): Promise<any> {
    const url = `${PENDLE_API_URL}${endpoint}`;
    this.logger.info(
      `Pendle API Request: URL=${url}, Params=${JSON.stringify(params)}`,
    );
    try {
      const response = await this.dexHelper.httpRequest.get(url, 30000, {
        params,
      });
      return response;
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.status === 429) {
        if (attempt < maxRetries) {
          const delay = backoff * 2 ** attempt;
          this.logger.warn(`Rate limited. Retrying in ${delay}ms...`);
          await sleep(delay);
          return this.callPendleSdkApi(
            endpoint,
            params,
            attempt + 1,
            maxRetries,
            backoff,
          );
        } else {
          this.logger.error('Max retries reached for rate-limited request.');
          throw e;
        }
      }
      if (axios.isAxiosError(e)) {
        this.logger.error(`Pendle API Error: ${e.message}`, e.response?.data);
      }
      throw e;
    }
  }

  private _calculateMarginalPrice(
    amount: bigint,
    swapData: any,
    tokenIn: string,
    tokenOut: string,
  ): bigint {
    // Find the swap route that matches the tokens
    const route = swapData.routes.find(
      (r: any) =>
        r.tokenIn === tokenIn.toLowerCase() &&
        r.tokenOut === tokenOut.toLowerCase(),
    );
    if (!route) {
      throw new Error('Route not found');
    }

    // The amountOut is the marginal price for the given amountIn
    return BigInt(route.amountOut);
  }

  private async _getPendleSwapDataBatch(
    marketRequests: { marketAddress: string; queryParams: any }[],
  ): Promise<any[]> {
    const promises = marketRequests.map(request => {
      const endpoint = `/sdk/${this.network}/markets/${request.marketAddress}/swap`;
      return this.callPendleSdkApi(endpoint, request.queryParams);
    });

    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        this.logger.error(
          `Failed to get swap data for market ${marketRequests[index].marketAddress}:`,
          result.reason,
        );
        return null;
      }
    });
  }

  private getSupportedMarkets(): SupportedPt[] {
    const configData = this.dexHelper.config.data as any;
    return configData.supportedPts || [];
  }
}
