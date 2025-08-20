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
  // Note: API calls are still used for getDexParam (swap execution)
  // but pricing is now done via oracle calls

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

  private async calculatePriceFromOracle(
    market: SupportedPt,
    amount: bigint,
    isUsdc: boolean,
    destToken: Token,
  ): Promise<string> {
    this.logger.info(
      `calculatePriceFromOracle called: market=${market.marketAddress}, amount=${amount}, isUsdc=${isUsdc}, destToken=${destToken.symbol}`,
    );

    try {
      this.logger.info(
        `Calculating price from PendleOracle for amount ${amount} (${
          isUsdc ? 'USDC' : 'underlying'
        } route)`,
      );

      // For USDC route, we need to get the PT to underlying rate first
      // then convert to USDC using the underlying's price
      if (isUsdc) {
        this.logger.info('Processing USDC route');

        // Get PT to underlying rate from oracle
        const callData = this.oracleInterface.encodeFunctionData(
          'getPtToAssetRate',
          [
            market.marketAddress,
            0, // duration 0 for current rate
          ],
        );

        this.logger.info(`Oracle call data: ${callData}`);

        this.logger.info(
          `Calling oracle contract: ${this.config.oracleAddress}`,
        );
        const ptToAssetRate = await this.dexHelper.provider.call({
          to: this.config.oracleAddress,
          data: callData,
        });

        this.logger.info(`Oracle returned rate: ${ptToAssetRate}`);

        if (!ptToAssetRate || ptToAssetRate === '0') {
          this.logger.warn(
            `Invalid PT to asset rate from oracle for market ${market.marketAddress}`,
          );
          return '0';
        }

        // Convert PT amount to underlying amount
        const underlyingAmount =
          (amount * BigInt(ptToAssetRate)) / BigInt(10 ** 18);
        this.logger.info(
          `Calculated underlying amount: ${underlyingAmount} from PT amount: ${amount} with rate: ${ptToAssetRate}`,
        );

        // For now, we'll use a simple conversion assuming 1:1 for stablecoins
        // In a production environment, you might want to get the actual USDC price
        // from a price oracle like Chainlink
        const usdcAmount = underlyingAmount;

        this.logger.info(
          `Calculated USDC amount: ${usdcAmount} for PT amount: ${amount}`,
        );

        return usdcAmount.toString();
      } else {
        this.logger.info('Processing underlying route');

        // For underlying route, directly use PT to asset rate
        const callData = this.oracleInterface.encodeFunctionData(
          'getPtToAssetRate',
          [
            market.marketAddress,
            0, // duration 0 for current rate
          ],
        );

        this.logger.info(`Oracle call data: ${callData}`);

        this.logger.info(
          `Calling oracle contract: ${this.config.oracleAddress}`,
        );
        const ptToAssetRate = await this.dexHelper.provider.call({
          to: this.config.oracleAddress,
          data: callData,
        });

        this.logger.info(`Oracle returned rate: ${ptToAssetRate}`);

        if (!ptToAssetRate || ptToAssetRate === '0') {
          this.logger.warn(
            `Invalid PT to asset rate from oracle for market ${market.marketAddress}`,
          );
          return '0';
        }

        // Convert PT amount to underlying amount
        const underlyingAmount =
          (amount * BigInt(ptToAssetRate)) / BigInt(10 ** 18);
        this.logger.info(
          `Calculated underlying amount: ${underlyingAmount} from PT amount: ${amount} with rate: ${ptToAssetRate}`,
        );

        this.logger.info(
          `Calculated underlying amount: ${underlyingAmount} for PT amount: ${amount}`,
        );

        return underlyingAmount.toString();
      }
    } catch (error) {
      this.logger.error(
        `Failed to calculate price from oracle for amount ${amount}: ${error}`,
      );
      return '0';
    }
  }

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<AavePtToUsdcData> | null> {
    this.logger.info(
      `getPricesVolume called: src=${srcToken.symbol}(${srcToken.address}), dest=${destToken.symbol}(${destToken.address}), side=${side}, amounts=${amounts.length}`,
    );

    if (side === SwapSide.BUY) {
      this.logger.info('BUY side not supported, returning null');
      return null;
    }

    const pt = this._findPtToken(srcToken, destToken);
    if (!pt || pt.address.toLowerCase() !== srcToken.address.toLowerCase()) {
      this.logger.warn(
        `PT token not found or doesn't match srcToken: pt=${pt?.address}, srcToken=${srcToken.address}`,
      );
      return null;
    }

    this.logger.info(`Found PT token: ${pt.symbol}(${pt.address})`);

    const market = this.getMarketByPtToken(pt);
    if (!market) {
      this.logger.warn(`Market not found for PT token: ${pt.address}`);
      return null;
    }

    this.logger.info(`Found market: ${market.marketAddress}`);

    const isUsdc =
      destToken.address.toLowerCase() === this.usdcToken.address.toLowerCase();
    const isUnderlying =
      destToken.address.toLowerCase() ===
      market.underlyingRawAddress.toLowerCase();

    this.logger.info(`Route type: USDC=${isUsdc}, Underlying=${isUnderlying}`);

    if (!isUsdc && !isUnderlying) {
      this.logger.warn(
        `Unsupported destination token: ${destToken.symbol}(${destToken.address})`,
      );
      return null;
    }

    const marketAddress = market.marketAddress;

    const destAmounts: string[] = [];
    this.logger.info(`Calculating prices for ${amounts.length} amounts`);

    for (let i = 0; i < amounts.length; i++) {
      const amount = amounts[i];
      this.logger.info(
        `Processing amount ${i + 1}/${amounts.length}: ${amount}`,
      );

      if (amount === 0n) {
        this.logger.info(`Amount ${i + 1} is zero, setting destAmount to 0`);
        destAmounts.push('0');
        continue;
      }

      // Use oracle instead of API call
      this.logger.info(`Calling calculatePriceFromOracle for amount ${amount}`);
      const destAmount = await this.calculatePriceFromOracle(
        market,
        amount,
        isUsdc,
        destToken,
      );

      this.logger.info(
        `Oracle returned destAmount: ${destAmount} for input amount: ${amount}`,
      );
      destAmounts.push(destAmount);
    }

    const finalPrices = destAmounts.map(amt =>
      amt === '0' ? 0n : BigInt(amt),
    );

    this.logger.info(
      `Final prices: ${finalPrices.map(p => p.toString()).join(', ')}`,
    );

    const gasCost = isUsdc
      ? AAVE_PT_TO_USDC_GAS_COST + 250_000
      : AAVE_PT_TO_USDC_GAS_COST;

    this.logger.info(`Gas cost: ${gasCost}`);

    if (finalPrices.every(p => p === 0n)) {
      this.logger.warn(
        `All prices are zero for ${srcToken.symbol} -> ${destToken.symbol}`,
      );
      return null;
    }

    const result = [
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

    this.logger.info(`Returning ${result.length} price entries`);
    return result;
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
    this.logger.info(
      `getDexParam called: srcToken=${srcToken}, destToken=${destToken}, srcAmount=${srcAmount}, destAmount=${destAmount}, recipient=${recipient}, side=${side}`,
    );

    if (side === SwapSide.BUY) {
      this.logger.warn('BUY side not supported, throwing error');
      throw new Error('AavePtToUsdc: Buying PT is not supported');
    }

    this.logger.info('Processing SELL side transaction');

    const { ptAddress } = data;
    this.logger.info(`PT address from data: ${ptAddress}`);

    const market = this.getMarketByPtToken({ address: ptAddress } as Token);
    if (!market) {
      this.logger.error(`Market not found for PT ${ptAddress}`);
      throw new Error(`Market not found for PT ${ptAddress}`);
    }

    this.logger.info(`Found market: ${market.marketAddress}`);

    const isUsdc =
      destToken.toLowerCase() === this.usdcToken.address.toLowerCase();

    this.logger.info(
      `Building swap transaction for PT ${ptAddress} to ${destToken} (USDC: ${isUsdc})`,
    );

    const apiParams = {
      receiver: recipient,
      slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING,
      ptAmount: srcAmount,
      ytAmount: '0',
      lpAmount: '0',
      tokenOut: destToken,
      enableAggregator: isUsdc,
    };

    this.logger.info(
      `Calling Pendle SDK API with params: ${JSON.stringify(apiParams)}`,
    );

    const swapResp = await this.callPendleSdkApi(
      market.marketAddress,
      apiParams,
    );

    this.logger.info(
      `Pendle SDK API response: success=${
        swapResp.success
      }, hasTx=${!!swapResp.tx}`,
    );

    if (!swapResp.success || !swapResp.tx) {
      const errorMsg = `Pendle SDK exit-positions endpoint failed: ${
        swapResp.error || 'No transaction data returned'
      }`;
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const tx = swapResp.tx;

    // Validate transaction data
    if (!tx.to || !tx.data) {
      const errorMsg = 'Invalid transaction data returned from Pendle SDK API';
      this.logger.error(`${errorMsg}: to=${tx.to}, hasData=${!!tx.data}`);
      throw new Error(errorMsg);
    }

    this.logger.info(
      `Successfully built swap transaction: to=${tx.to}, data length=${tx.data.length}`,
    );

    const result = {
      targetExchange: tx.to,
      exchangeData: tx.data,
      needWrapNative: false,
      dexFuncHasRecipient: true,
      returnAmountPos: 0,
    };

    this.logger.info(
      `Returning DexExchangeParam: targetExchange=${result.targetExchange}, needWrapNative=${result.needWrapNative}, dexFuncHasRecipient=${result.dexFuncHasRecipient}`,
    );

    return result;
  }

  private async callPendleSdkApi(
    marketAddress: string,
    params: any,
  ): Promise<any> {
    this.logger.info(`callPendleSdkApi called for market: ${marketAddress}`);
    this.logger.info(`API parameters: ${JSON.stringify(params)}`);

    const url = new URL(
      `${PENDLE_API_URL}/v2/sdk/${this.network}/markets/${marketAddress}/exit-positions`,
    );

    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key].toString());
      }
    });

    this.logger.info(`Calling Pendle SDK API: ${url.toString()}`);

    try {
      const response = await this.dexHelper.httpRequest.get(
        url.toString(),
        30000,
        {
          Accept: 'application/json',
        },
      );

      this.logger.info(
        `Pendle SDK API response received, status: ${
          (response as any).status || 'unknown'
        }`,
      );
      this.logger.info(
        `Response keys: ${Object.keys(response as any).join(', ')}`,
      );

      const responseData = response as any;

      // Log the structure of the response
      if (responseData.tx) {
        this.logger.info(
          `Response has tx object: to=${
            responseData.tx.to
          }, hasData=${!!responseData.tx.data}`,
        );
      } else if (responseData.data?.tx) {
        this.logger.info(
          `Response has data.tx object: to=${
            responseData.data.tx.to
          }, hasData=${!!responseData.data.tx.data}`,
        );
      } else {
        this.logger.warn(
          `Response structure: ${JSON.stringify(responseData, null, 2)}`,
        );
      }

      const result = {
        success: true,
        data: responseData.data || responseData,
        tx: responseData.tx || responseData.data?.tx,
      };

      this.logger.info(
        `Returning API result: success=${result.success}, hasTx=${!!result.tx}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Pendle SDK API call failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        tx: null,
      };
    }
  }

  private getSupportedMarkets(): SupportedPt[] {
    return this.config.supportedPts;
  }

  // Note: Simplified API call method - no caching or retry logic needed for swap execution
}
