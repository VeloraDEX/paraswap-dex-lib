import {
  Token,
  Address,
  ExchangePrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
} from '../../types';
import { SwapSide, Network, NULL_ADDRESS } from '../../constants';
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
import { DexExchangeParam } from '../../types';

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
  private lastApiCallTime = 0;
  // FIX: Increase the minimum delay between API calls to avoid rate limiting
  private readonly minApiCallInterval = 1500; // 1.5 seconds
  private priceCache: Map<string, any> = new Map();

  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AavePtToUsdcConfig);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = AavePtToUsdcConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
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
        ytAddress: NULL_ADDRESS,
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

  public isPairSupported(tokenA: Token, tokenB: Token): boolean {
    const ptToken = this._findPtToken(tokenA, tokenB);
    if (!ptToken) {
      return false;
    }

    const market = this.getMarketByPtToken(ptToken);
    if (!market) {
      return false;
    }

    const otherToken =
      ptToken.address.toLowerCase() === tokenA.address.toLowerCase()
        ? tokenB
        : tokenA;

    return (
      otherToken.address.toLowerCase() ===
        market.underlyingRawAddress.toLowerCase() ||
      otherToken.address.toLowerCase() === this.usdcToken.address.toLowerCase()
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
      `Checking srcToken: ${srcToken.symbol || 'undefined'} (${
        srcToken.address
      })`,
    );
    this.logger.info(
      `Checking destToken: ${destToken.symbol || 'undefined'} (${
        destToken.address
      })`,
    );

    const result = [srcToken, destToken].find(t => {
      const found = supportedMarkets.some(
        m => m.pt.address.toLowerCase() === t.address.toLowerCase(),
      );
      this.logger.info(
        `Checking token ${t.address.toLowerCase()} against supported markets: ${found}`,
      );
      return found;
    });

    this.logger.info(
      `_findPtToken final result: ${result?.address || 'undefined'}`,
    );
    return result;
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
      `getPoolIdentifiers called with src: ${
        srcToken.symbol || 'undefined'
      }, dest: ${destToken.symbol || 'undefined'}`,
    );
    const ptToken = this._findPtToken(srcToken, destToken);
    this.logger.info(`_findPtToken result: ${ptToken?.address || 'undefined'}`);

    if (!ptToken) {
      this.logger.warn(
        `Could not find PT token for pair ${srcToken.symbol || 'undefined'}-${
          destToken.symbol || 'undefined'
        }`,
      );
      return [];
    }

    const market = this.getSupportedMarkets().find(
      (m: SupportedPt) =>
        m.pt.address.toLowerCase() === ptToken.address.toLowerCase(),
    );
    this.logger.info(`found market: ${market?.marketAddress}`);

    if (!market) {
      this.logger.warn(
        `Could not find market for PT ${ptToken.address || 'undefined'}`,
      );
      return [];
    }

    return [this.getPoolIdentifier(market.marketAddress)];
  }

  private getMarketByPtToken(ptToken: Token): SupportedPt | undefined {
    return this.supportedMarkets.find(
      m => m.pt.address.toLowerCase() === ptToken.address.toLowerCase(),
    );
  }

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<AavePtToUsdcData> | null> {
    if (side === SwapSide.BUY) {
      return null;
    }

    const pt = this._findPtToken(srcToken, destToken);
    if (!pt || pt.address.toLowerCase() !== srcToken.address.toLowerCase()) {
      return null;
    }

    const market = this.getMarketByPtToken(pt);
    if (!market) return null;

    const isUsdc =
      destToken.address.toLowerCase() === this.usdcToken.address.toLowerCase();
    const isUnderlying =
      destToken.address.toLowerCase() ===
      market.underlyingRawAddress.toLowerCase();

    if (!isUsdc && !isUnderlying) return null;

    const marketAddress = market.marketAddress;

    const destAmounts: string[] = [];
    for (const amount of amounts) {
      if (amount === 0n) {
        destAmounts.push('0');
        continue;
      }

      try {
        this.logger.info(
          `Calling Pendle SDK API for amount ${amount} (${
            isUsdc ? 'USDC' : 'underlying'
          } route)`,
        );
        const params = {
          receiver: this.augustusAddress,
          slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING,
          ptAmount: amount.toString(),
          ytAmount: '0',
          lpAmount: '0',
          tokenOut: destToken.address,
          enableAggregator: isUsdc,
        };

        const swapData = await this.callPendleSdkApi(
          market.marketAddress,
          params,
        );

        if (!swapData?.success || !swapData?.data?.amountOut) {
          this.logger.warn(
            `Invalid response for amount ${amount}: ${JSON.stringify(
              swapData,
            )}`,
          );
          destAmounts.push('0');
          continue;
        }

        this.logger.info(
          `Got dest amount: ${swapData.data.amountOut} for PT amount: ${amount}`,
        );
        destAmounts.push(swapData.data.amountOut);
      } catch (error) {
        this.logger.warn(`Failed to get price for amount ${amount}: ${error}`);
        destAmounts.push('0');
      }
    }

    const finalPrices = destAmounts.map(amt =>
      amt === '0' ? 0n : BigInt(amt),
    );
    const gasCost = isUsdc
      ? AAVE_PT_TO_USDC_GAS_COST + 250_000
      : AAVE_PT_TO_USDC_GAS_COST;

    if (finalPrices.every(p => p === 0n)) {
      this.logger.warn(
        `All prices are zero for ${srcToken.symbol} -> ${destToken.symbol}`,
      );
      return null;
    }

    return [
      {
        exchange: this.dexKey,
        poolIdentifier: this.getPoolIdentifier(marketAddress),
        poolAddresses: [marketAddress, 'PendleSwap'],
        prices: finalPrices,
        unit: 1n,
        gasCost,
        data: {
          marketAddress,
          ptAddress: srcToken.address,
          underlyingAssetAddress: market.underlyingAssetAddress,
        },
      },
    ];
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
          liquidityUSD: 10_000_000,
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

  public async getDexParam(
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
    if (side === SwapSide.BUY) {
      throw new Error('AavePtToUsdc: Buying PT is not supported');
    }

    const { ptAddress } = data;
    const market = this.getMarketByPtToken({ address: ptAddress } as Token);
    if (!market) {
      throw new Error(`Market not found for PT ${ptAddress}`);
    }

    const isUsdc =
      destToken.toLowerCase() === this.usdcToken.address.toLowerCase();

    const swapResp = await this.callPendleSdkApi(market.marketAddress, {
      receiver: recipient,
      slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING,
      ptAmount: srcAmount,
      ytAmount: '0',
      lpAmount: '0',
      tokenOut: destToken,
      enableAggregator: isUsdc,
    });

    if (!swapResp.success || !swapResp.tx) {
      throw new Error(
        `Pendle SDK exit-positions endpoint failed: ${
          swapResp.error || 'No transaction data returned'
        }`,
      );
    }

    const tx = swapResp.tx;
    return {
      targetExchange: tx.to,
      exchangeData: tx.data,
      needWrapNative: false,
      dexFuncHasRecipient: true,
      returnAmountPos: 0,
    };
  }

  private async callPendleSdkApi(
    marketAddress: string,
    params: any,
  ): Promise<any> {
    const cacheKey = this.generateCacheKey(marketAddress, params);

    if (this.priceCache.has(cacheKey)) {
      return this.priceCache.get(cacheKey);
    }

    const result = await this.executeWithRetry(async () => {
      const url = new URL(
        `${PENDLE_API_URL}/v2/sdk/${this.network}/markets/${marketAddress}/exit-positions`,
      );

      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null) {
          url.searchParams.append(key, params[key].toString());
        }
      });

      const response = await this.dexHelper.httpRequest.get(
        url.toString(),
        30000,
        {
          Accept: 'application/json',
        },
      );

      const responseData = response as any;
      return {
        success: true,
        data: responseData.data || responseData,
        tx: responseData.tx || responseData.data?.tx,
      };
    });

    this.priceCache.set(cacheKey, result);
    return result;
  }

  private getSupportedMarkets(): SupportedPt[] {
    return this.config.supportedPts;
  }

  private generateCacheKey(marketAddress: string, params: any): string {
    return `${marketAddress}_${JSON.stringify(params)}`;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastApiCallTime;

    if (timeSinceLastCall < this.minApiCallInterval) {
      const waitTime = this.minApiCallInterval - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastApiCallTime = Date.now();
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 2,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.waitForRateLimit();
        return await operation();
      } catch (error: any) {
        lastError = error;

        if (error?.response?.status === 429 && attempt < maxRetries) {
          // FINAL FIX: Increase the initial backoff delay even more.
          const delay = 3000 * Math.pow(2, attempt); // 3s, 6s, 12s
          this.logger.warn(
            `Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${
              maxRetries + 1
            })`,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }
}
