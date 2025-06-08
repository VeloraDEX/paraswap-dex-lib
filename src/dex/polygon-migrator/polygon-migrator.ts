import { SimpleExchange } from '../simple-exchange';
import { IDex } from '../idex';
import {
  DexParams,
  PolygonMigrationData,
  PolygonMigratorFunctions,
} from './types';
import { Network, SwapSide } from '../../constants';
import { getDexKeysWithNetwork } from '../../utils';
import { Adapters, PolygonMigratorConfig } from './config';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
} from '../../types';
import { IDexHelper } from '../../dex-helper';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { BI_POWS } from '../../bigint-constants';
import { POLYGON_MIGRATION_GAS_COST } from './constants';
import PolygonMigrationAbi from '../../abi/polygon-migration/PolygonMigration.abi.json';
import { Interface } from 'ethers';

export class PolygonMigrator
  extends SimpleExchange
  implements IDex<PolygonMigrationData, DexParams>
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(PolygonMigratorConfig);

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    readonly migratorAddress: string = PolygonMigratorConfig[dexKey][network]
      .migratorAddress,
    readonly polTokenAddress: string = PolygonMigratorConfig[dexKey][network]
      .polTokenAddress,
    readonly maticTokenAddress: string = PolygonMigratorConfig[dexKey][network]
      .maticTokenAddress,
    protected unitPrice = BI_POWS[18],
    protected adapters = Adapters[network] || {},
    protected migratorInterface = new Interface(PolygonMigrationAbi),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] || null;
  }

  isMatic(tokenAddress: Address) {
    return this.maticTokenAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isPol(tokenAddress: Address) {
    return this.polTokenAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isAppropriatePair(srcToken: Token, destToken: Token) {
    return (
      (this.isMatic(srcToken.address) && this.isPol(destToken.address)) ||
      (this.isMatic(destToken.address) && this.isPol(srcToken.address))
    );
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
  ): Promise<null | ExchangePrices<PolygonMigrationData>> {
    if (!this.isAppropriatePair(srcToken, destToken)) {
      return null;
    }

    return [
      {
        prices: amounts,
        unit: this.unitPrice,
        gasCost: POLYGON_MIGRATION_GAS_COST,
        exchange: this.dexKey,
        poolAddresses: [this.migratorAddress],
        data: null,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<PolygonMigrationData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: PolygonMigrationData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.migratorAddress,
      payload: '0x',
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: PolygonMigrationData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = this.migratorInterface.encodeFunctionData(
      this.isMatic(srcToken)
        ? PolygonMigratorFunctions.migrate
        : PolygonMigratorFunctions.unmigrate,
      [srcAmount],
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.migratorAddress,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: PolygonMigrationData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.migratorInterface.encodeFunctionData(
      this.isMatic(srcToken)
        ? PolygonMigratorFunctions.migrate
        : PolygonMigratorFunctions.unmigrate,
      [srcAmount],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.migratorAddress,
      returnAmountPos: undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
  }
}
