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
  NO_USD_LIQUIDITY,
  UNLIMITED_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { AavePtToUnderlyingData, DexParams, SupportedPt } from './types';
import { SimpleExchange } from '../simple-exchange';
import { AavePtToUnderlyingConfig } from './config';
import { Interface } from '@ethersproject/abi';
import PENDLE_ORACLE_ABI from '../../abi/PendleOracle.json';
import { AAVE_PT_TO_UNDERLYING_GAS_COST, PENDLE_API_URL } from './constants';
import { DexExchangeParam } from '../../types';

export class AavePtToUnderlying
  extends SimpleExchange
  implements IDex<AavePtToUnderlyingData>
{
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  private config: DexParams;
  private oracleInterface: Interface;
  private readonly supportedMarkets: SupportedPt[];

  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AavePtToUnderlyingConfig);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.config = AavePtToUnderlyingConfig[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
    this.oracleInterface = new Interface(PENDLE_ORACLE_ABI);
    this.supportedMarkets = this.config.supportedPts;
  }

  getAdapters(): { name: string; index: number }[] | null {
    return null;
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
    const market = this.getMarketByPtToken(srcToken.address);

    if (!market) {
      return [];
    }

    // Only support PT -> underlying swaps
    if (
      destToken.address.toLowerCase() !==
      market.underlyingRawAddress.toLowerCase()
    ) {
      return [];
    }

    return [this.getPoolIdentifier(market.marketAddress)];
  }

  private getMarketByPtToken(ptToken: Address): SupportedPt | undefined {
    return this.supportedMarkets.find(
      m => m.pt.address.toLowerCase() === ptToken.toLowerCase(),
    );
  }

  private async getOracleRate(market: SupportedPt): Promise<bigint> {
    try {
      const callData = this.oracleInterface.encodeFunctionData(
        'getPtToAssetRate',
        [market.marketAddress, 0],
      );

      const rate = await this.dexHelper.provider.call({
        to: this.config.oracleAddress,
        data: callData,
      });

      return BigInt(rate);
    } catch (error) {
      this.logger.error(`Failed to fetch oracle rate: ${error}`);
      return 0n;
    }
  }

  private async calculatePriceFromOracle(
    market: SupportedPt,
    amounts: bigint[],
    side: SwapSide,
  ): Promise<bigint[]> {
    const rate = await this.getOracleRate(market);

    if (rate === 0n) return [];

    if (side === SwapSide.SELL) {
      return amounts.map(amount => (amount * rate) / 10n ** 18n);
    } else {
      return amounts.map(amount => (amount * 10n ** 18n + (rate - 1n)) / rate);
    }
  }

  public async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<AavePtToUnderlyingData> | null> {
    const market = this.getMarketByPtToken(srcToken.address);

    if (!market) {
      return null;
    }

    const { underlyingRawAddress, marketAddress } = market;

    const isUnderlying =
      destToken.address.toLowerCase() === underlyingRawAddress.toLowerCase();

    if (!isUnderlying) {
      return null;
    }

    if (limitPools && limitPools.length > 0) {
      const poolId = this.getPoolIdentifier(marketAddress);
      if (!limitPools.includes(poolId)) {
        return null;
      }
    }

    const unit = getBigIntPow(
      side === SwapSide.SELL ? srcToken.decimals : destToken.decimals,
    );

    const _amounts = [unit, ...amounts.slice(1)];

    const prices = await this.calculatePriceFromOracle(market, _amounts, side);
    if (prices.length === 0) return null;

    return [
      {
        exchange: this.dexKey,
        prices: [0n, ...prices.slice(1)],
        unit: prices[0],
        gasCost: AAVE_PT_TO_UNDERLYING_GAS_COST,
        data: {
          marketAddress,
        },
        poolIdentifiers: [this.getPoolIdentifier(marketAddress)],
        poolAddresses: [marketAddress],
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
    data: AavePtToUnderlyingData,
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
    const market = this.getMarketByPtToken(tokenAddress);

    if (market) {
      return [
        {
          exchange: this.dexKey,
          address: market.marketAddress,
          connectorTokens: [
            {
              address: market.underlyingAssetAddress,
              decimals: 18,
              liquidityUSD: NO_USD_LIQUIDITY,
            },
          ],
          liquidityUSD: UNLIMITED_USD_LIQUIDITY,
        },
      ];
    }

    return [];
  }

  public async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AavePtToUnderlyingData,
    side: SwapSide,
    context: Context,
    executorAddress: Address,
  ): Promise<DexExchangeParam> {
    const apiParams = {
      receiver: recipient,
      slippage: 0,
      ptAmount: srcAmount,
      ytAmount: '0',
      lpAmount: '0',
      tokenOut: destToken,
      enableAggregator: false,
    };

    const swapResp = await this.callPendleSdkApi(data.marketAddress, apiParams);

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
}
