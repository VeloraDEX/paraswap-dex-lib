import { AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { UsdcTransmuterData, UsdcTransmuterFunctions } from './types';
import { SimpleExchange } from '../simple-exchange';
import { UsdcTransmuterConfig } from './config';
import { Interface } from '@ethersproject/abi';
import UsdcTransmuterAbi from '../../abi/usdc-transmuter/usdc-transmuter.abi.json';
import { BI_POWS } from '../../bigint-constants';
import { USDC_TRANSMUTER_GAS_COST } from './constants';

export class UsdcTransmuter
  extends SimpleExchange
  implements IDex<UsdcTransmuterData>
{
  protected usdcTransmuterIface: Interface;

  readonly hasConstantPriceLargeAmounts = true;
  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(UsdcTransmuterConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected config = UsdcTransmuterConfig[dexKey][network],
    protected unitPrice = BI_POWS[6],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.usdcTransmuterIface = new Interface(UsdcTransmuterAbi);
  }

  isUSDC(tokenAddress: Address): boolean {
    return (
      tokenAddress.toLowerCase() === this.config.usdcToken.address.toLowerCase()
    );
  }

  isUSDCe(tokenAddress: Address): boolean {
    return (
      tokenAddress.toLowerCase() ===
      this.config.usdceToken.address.toLowerCase()
    );
  }

  isAppropriatePair(srcToken: Token, destToken: Token): boolean {
    const srcTokenAddress = srcToken.address;
    const destTokenAddress = destToken.address;

    return (
      (this.isUSDC(srcTokenAddress) && this.isUSDCe(destTokenAddress)) ||
      (this.isUSDCe(srcTokenAddress) && this.isUSDC(destTokenAddress))
    );
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
    if (this.isAppropriatePair(srcToken, destToken)) {
      return [`${this.dexKey}_${srcToken.address}_${destToken.address}`];
    }

    return [];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<UsdcTransmuterData>> {
    if (!this.isAppropriatePair(srcToken, destToken)) {
      return null;
    }

    return [
      {
        prices: [...amounts],
        unit: this.unitPrice,
        data: null,
        exchange: this.dexKey,
        gasCost: USDC_TRANSMUTER_GAS_COST,
        poolAddresses: [this.config.usdcTransmuterAddress],
      },
    ];
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<UsdcTransmuterData> | null,
  ): number {
    return CALLDATA_GAS_COST.FUNCTION_SELECTOR + CALLDATA_GAS_COST.AMOUNT;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: UsdcTransmuterData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.config.usdcTransmuterAddress,
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
    data: UsdcTransmuterData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.usdcTransmuterIface.encodeFunctionData(
      this.isUSDC(srcToken)
        ? UsdcTransmuterFunctions.deposit
        : UsdcTransmuterFunctions.withdraw,
      [srcAmount],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.config.usdcTransmuterAddress,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (this.isUSDC(tokenAddress) || this.isUSDCe(tokenAddress)) {
      const isUSDC = this.isUSDC(tokenAddress);

      return [
        {
          address: this.config.usdcTransmuterAddress,
          connectorTokens: [
            isUSDC ? this.config.usdceToken : this.config.usdcToken,
          ],
          exchange: this.dexKey,
          liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
        },
      ];
    }

    return [];
  }
}
