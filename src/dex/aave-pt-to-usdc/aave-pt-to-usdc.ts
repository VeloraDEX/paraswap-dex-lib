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
    this.usdcToken = this.config.usdcToken;
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

    const result = [srcToken, destToken].find(t => {
      const found = supportedMarkets.some(
        m => m.pt.address.toLowerCase() === t.address.toLowerCase(),
      );
      return found;
    });

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
    const ptToken = this._findPtToken(srcToken, destToken);

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

        // For USDC route, use 1:1 conversion since underlying assets are close to USD
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

    const market = this.getMarketByPtToken(pt);

    if (!market) {
      this.logger.warn(`Market not found for PT token: ${pt.address}`);
      return null;
    }

    const isUsdc =
      destToken.address.toLowerCase() === this.usdcToken.address.toLowerCase();
    const isUnderlying =
      destToken.address.toLowerCase() ===
      market.underlyingRawAddress.toLowerCase();

    if (!isUsdc && !isUnderlying) {
      this.logger.warn(
        `Unsupported destination token: ${destToken.symbol}(${destToken.address})`,
      );
      return null;
    }

    const marketAddress = market.marketAddress;

    const destAmounts: string[] = [];

    for (let i = 0; i < amounts.length; i++) {
      const amount = amounts[i];

      if (amount === 0n) {
        destAmounts.push('0');
        continue;
      }

      const destAmount = await this.calculatePriceFromOracle(
        market,
        amount,
        isUsdc,
        destToken,
      );

      destAmounts.push(destAmount);
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
    if (side === SwapSide.BUY) {
      this.logger.warn('BUY side not supported, throwing error');
      throw new Error('AavePtToUsdc: Buying PT is not supported');
    }

    const { ptAddress } = data;

    const market = this.getMarketByPtToken({ address: ptAddress } as Token);
    if (!market) {
      this.logger.error(`Market not found for PT ${ptAddress}`);
      throw new Error(`Market not found for PT ${ptAddress}`);
    }

    const isUsdc =
      destToken.toLowerCase() === this.usdcToken.address.toLowerCase();

    const apiParams = {
      receiver: recipient,
      slippage: DEFAULT_SLIPPAGE_FOR_QUOTTING,
      ptAmount: srcAmount,
      ytAmount: '0',
      lpAmount: '0',
      tokenOut: destToken,
      enableAggregator: isUsdc,
    };

    const swapResp = await this.callPendleSdkApi(
      market.marketAddress,
      apiParams,
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

    const result = {
      targetExchange: tx.to,
      exchangeData: tx.data,
      needWrapNative: false,
      dexFuncHasRecipient: true,
      returnAmountPos: 0,
    };

    return result;
  }

  private async callPendleSdkApi(
    marketAddress: string,
    params: any,
  ): Promise<any> {
    const url = new URL(
      `${PENDLE_API_URL}/v2/sdk/${this.network}/markets/${marketAddress}/exit-positions`,
    );

    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key].toString());
      }
    });

    try {
      const response = await this.dexHelper.httpRequest.get(
        url.toString(),
        30000,
        {
          Accept: 'application/json',
        },
      );

      const responseData = response as any;

      const result = {
        success: true,
        data: responseData.data || responseData,
        tx: responseData.tx || responseData.data?.tx,
      };

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
}
