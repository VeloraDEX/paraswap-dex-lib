import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import {
  SwapSide,
  Network,
  NO_USD_LIQUIDITY,
  UNLIMITED_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { SkyConverterData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { SkyConverterConfig } from './config';
import { BI_POWS } from '../../bigint-constants';
import { SkyConverterEventPool } from './sky-converter-pool';

export class SkyConverter
  extends SimpleExchange
  implements IDex<SkyConverterData>
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly needWrapNative = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(SkyConverterConfig);

  logger: Logger;

  oldToken: Address;
  newToken: Address;
  private readonly eventPool?: SkyConverterEventPool;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly config = SkyConverterConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);

    this.oldToken = this.config.oldTokenAddress.toLowerCase();
    this.newToken = this.config.newTokenAddress.toLowerCase();

    if (this.config.converterFee) {
      this.eventPool = new SkyConverterEventPool(
        this.dexKey,
        this.network,
        this.dexHelper,
        this.logger,
        this.config.converterAddress,
        this.config.converterIface,
      );
    }
  }

  async initializePricing(blockNumber: number) {
    if (this.eventPool) {
      await this.eventPool.initialize(blockNumber);
    }
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const isOldToNew =
      srcToken.address.toLowerCase() === this.oldToken &&
      destToken.address.toLowerCase() === this.newToken;

    const isNewToOld =
      srcToken.address.toLowerCase() === this.newToken &&
      destToken.address.toLowerCase() === this.oldToken;

    if (isOldToNew && this.config.oldToNewFunctionName) {
      return [`${this.dexKey}_${destToken.address}`];
    }

    if (isNewToOld && this.config.newToOldFunctionName) {
      return [`${this.dexKey}_${srcToken.address}`];
    }

    return [];
  }

  oldAmountToNewAmount(amount: bigint, fee: bigint) {
    if (fee <= 0n) {
      return amount * this.config.newTokenRateMultiplier;
    }

    return (
      (amount * this.config.newTokenRateMultiplier * (BI_POWS[18] - fee)) /
      BI_POWS[18]
    );
  }

  newAmountToOldAmount(amount: bigint, fee: bigint) {
    if (fee <= 0n) {
      return amount / this.config.newTokenRateMultiplier;
    }

    return (
      (amount * BI_POWS[18]) /
      (this.config.newTokenRateMultiplier * (BI_POWS[18] - fee))
    );
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<SkyConverterData>> {
    const isKnown =
      (srcToken.address.toLowerCase() === this.oldToken &&
        destToken.address.toLowerCase() === this.newToken) ||
      (srcToken.address.toLowerCase() === this.newToken &&
        destToken.address.toLowerCase() === this.oldToken);

    if (!isKnown) {
      return null;
    }

    const isOldToNew = srcToken.address.toLowerCase() === this.oldToken;

    if (
      (isOldToNew && !this.config.oldToNewFunctionName) ||
      (!isOldToNew && !this.config.newToOldFunctionName)
    ) {
      return null;
    }

    let fee = 0n;
    if (this.eventPool) {
      const state = await this.eventPool.getOrGenerateState(blockNumber);
      fee = state.fee;
    }

    let mappingFunction: (amount: bigint) => bigint;

    if (side === SwapSide.SELL) {
      if (isOldToNew) {
        mappingFunction = amount => this.oldAmountToNewAmount(amount, fee);
      } else {
        mappingFunction = amount => this.newAmountToOldAmount(amount, fee);
      }
    } else {
      if (isOldToNew) {
        mappingFunction = amount => this.newAmountToOldAmount(amount, fee);
      } else {
        mappingFunction = amount => this.oldAmountToNewAmount(amount, fee);
      }
    }

    return [
      {
        prices: amounts.map(el => mappingFunction(el)),
        unit: BI_POWS[18],
        gasCost: 50_000,
        exchange: this.dexKey,
        poolAddresses: [this.config.converterAddress],
        data: null,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<SkyConverterData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SkyConverterData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: '0x',
      payload,
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SkyConverterData,
    side: SwapSide,
  ): DexExchangeParam {
    const isOldToNew = srcToken.toLowerCase() === this.oldToken;

    const functionName = isOldToNew
      ? this.config.oldToNewFunctionName
      : this.config.newToOldFunctionName;

    if (!functionName) {
      throw new Error(
        `${this.dexKey}-${this.network}: conversion from ${srcToken} to ${destToken} is not supported`,
      );
    }

    const swapData = this.config.converterIface.encodeFunctionData(
      functionName,
      [recipient, srcAmount],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.config.converterAddress,
      returnAmountPos: undefined,
    };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const isOld = tokenAddress.toLowerCase() === this.oldToken;
    const isNew = tokenAddress.toLowerCase() === this.newToken;

    if (isOld) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.converterAddress,
          connectorTokens: [
            {
              decimals: 18,
              address: this.newToken,
              liquidityUSD: this.config.newToOldFunctionName
                ? UNLIMITED_USD_LIQUIDITY
                : NO_USD_LIQUIDITY,
            },
          ],
          liquidityUSD: this.config.oldToNewFunctionName
            ? UNLIMITED_USD_LIQUIDITY
            : NO_USD_LIQUIDITY,
        },
      ];
    }

    if (isNew) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.converterAddress,
          connectorTokens: [
            {
              decimals: 18,
              address: this.oldToken,
              liquidityUSD: this.config.oldToNewFunctionName
                ? UNLIMITED_USD_LIQUIDITY
                : NO_USD_LIQUIDITY,
            },
          ],
          liquidityUSD: this.config.newToOldFunctionName
            ? UNLIMITED_USD_LIQUIDITY
            : NO_USD_LIQUIDITY,
        },
      ];
    }

    return [];
  }
}
