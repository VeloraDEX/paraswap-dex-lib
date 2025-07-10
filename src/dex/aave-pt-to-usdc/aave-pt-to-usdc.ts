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
  STABLE_COINS,
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

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<AavePtToUsdcData> | null> {
    if (side === SwapSide.BUY) {
      // This implementation only supports selling PT for its underlying asset.
      return null;
    }

    const pt = this._findPtToken(srcToken, destToken);
    if (!pt || pt.address.toLowerCase() !== srcToken.address.toLowerCase()) {
      return null; // Ensure we are selling the PT
    }

    const market = this.getMarketByPtToken(pt);
    if (
      !market ||
      destToken.address.toLowerCase() !==
        market.underlyingAssetAddress.toLowerCase()
    ) {
      return null; // Ensure dest is the underlying for the PT's market
    }

    const marketAddress = market.marketAddress;

    const queryParamsList = amounts.map(amount => {
      if (amount === 0n) {
        return null; // API rejects 0 amount, handle separately
      }
      return {
        receiver: this.augustusAddress,
        slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING.toString(),
        enableAggregator: 'true',
        ptAmount: amount.toString(),
        ytAmount: '0',
        lpAmount: '0',
        tokenOut: destToken.address,
      };
    });

    const swapDataPromises = queryParamsList.map(params => {
      if (params === null) {
        return Promise.resolve(null);
      }
      return this.callPendleSdkApi(
        `core/v2/sdk/${this.network}/markets/${marketAddress}/exit-positions`,
        params,
      );
    });

    const settledSwapData = await Promise.allSettled(swapDataPromises);

    const prices: bigint[] = [];
    for (let i = 0; i < settledSwapData.length; i++) {
      if (amounts[i] === 0n) {
        prices.push(0n);
        continue;
      }
      const result = settledSwapData[i];
      if (result.status === 'rejected') {
        this.logger.error(
          `Pendle API call failed in getPricesVolume for amount ${amounts[
            i
          ].toString()}`,
          result.reason,
        );
        prices.push(0n);
        continue;
      }
      const swapData = result.value;
      if (!swapData?.data?.amountOut) {
        prices.push(0n);
        continue;
      }
      prices.push(BigInt(swapData.data.amountOut));
    }

    if (prices.every(p => p === 0n)) return null;
    const dexKey = this.getPoolIdentifier(marketAddress);

    return [
      {
        exchange: this.dexKey,
        poolIdentifier: dexKey,
        poolAddresses: [marketAddress],
        prices,
        unit: 1n,
        gasCost: AAVE_PT_TO_USDC_GAS_COST,
        data: { marketAddress, ptAddress: srcToken.address },
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

    const { marketAddress, ptAddress } = data;
    const market = this.supportedMarkets.find(
      m => m.pt.address.toLowerCase() === ptAddress.toLowerCase(),
    );

    if (
      !market ||
      market.underlyingAssetAddress.toLowerCase() !== destToken.toLowerCase()
    ) {
      throw new Error(
        'Invalid pair. Destination must be the underlying asset for the PT.',
      );
    }

    const swapParams = {
      receiver: recipient,
      slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING.toString(),
      enableAggregator: 'true',
      ptAmount: srcAmount,
      ytAmount: '0',
      lpAmount: '0',
      tokenOut: destToken,
    };

    const swapResult = await this.callPendleSdkApi(
      `core/v2/sdk/${this.network}/markets/${marketAddress}/exit-positions`,
      swapParams,
    );

    if (!swapResult?.tx?.data) {
      throw new Error('Failed to get swap data from Pendle API');
    }

    return {
      targetExchange: swapResult.tx.to || this.config.pendleRouterAddress,
      exchangeData: swapResult.tx.data,
      needWrapNative: false,
      dexFuncHasRecipient: true,
    };
  }

  private async callPendleSdkApi(
    endpoint: string,
    params: any,
    attempt = 0,
    maxRetries = 3,
    backoff = 1000,
  ): Promise<any> {
    const url = `${PENDLE_API_URL}/${endpoint}`;
    this.logger.info(
      `Pendle API Request: URL=${url}, Params=${JSON.stringify(params)}`,
    );
    try {
      const response = await this.dexHelper.httpRequest.get(url, 30000, params);
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
      } else {
        this.logger.error(`Pendle API Error: ${e}`);
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
      return this.callPendleSdkApi(`v1/router/swap`, request.queryParams);
    });

    const results = await Promise.all(promises);

    return results.map(result => (result as any).data);
  }

  private getSupportedMarkets(): SupportedPt[] {
    const configData = this.dexHelper.config.data as any;
    return configData.supportedPts || [];
  }
}
