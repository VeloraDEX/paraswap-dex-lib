import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { MiroMigratorData, MiroMigratorFunctions } from './types';
import { SimpleExchange } from '../simple-exchange';
import { MiroMigratorConfig } from './config';
import { BI_POWS } from '../../bigint-constants';
import { Interface } from '@ethersproject/abi';
import MiroMigratorAbi from '../../abi/miro-migrator/MiroMigrator.abi.json';
import { MIRO_MIGRATION_GAS_COST, TRANSFER_TOPIC } from './constants';
import { MiroMigratorEventPool } from './miro-migrator-pool';

export class MiroMigrator
  extends SimpleExchange
  implements IDex<MiroMigratorData>
{
  readonly hasConstantPriceLargeAmounts = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(MiroMigratorConfig);
  public readonly eventPool: MiroMigratorEventPool;

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly migratorAddress: string = MiroMigratorConfig[dexKey][network]
      .migratorAddress,
    readonly pspTokenAddress: string = MiroMigratorConfig[dexKey][network]
      .pspTokenAddress,
    readonly xyzTokenAddress: string = MiroMigratorConfig[dexKey][network]
      .xyzTokenAddress,
    protected unitPrice = BI_POWS[18],
    protected migratorInterface = new Interface(MiroMigratorAbi),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new MiroMigratorEventPool(
      this.dexKey,
      this.network,
      this.dexHelper,
      this.logger,
      this.migratorAddress,
      this.xyzTokenAddress,
      TRANSFER_TOPIC,
    );
  }

  isPSP(tokenAddress: Address) {
    return this.pspTokenAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isXYZ(tokenAddress: Address) {
    return this.xyzTokenAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isAppropriatePair(srcToken: Token, destToken: Token) {
    return this.isPSP(srcToken.address) && this.isXYZ(destToken.address);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async initializePricing(blockNumber: number) {
    this.eventPool.initialize(blockNumber);
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
  ): Promise<null | ExchangePrices<MiroMigratorData>> {
    if (!this.isAppropriatePair(srcToken, destToken)) {
      return null;
    }

    const state = await this.eventPool.getOrGenerateState(blockNumber);
    if (!state) return null;

    const prices: bigint[] = [];
    for (const amount of amounts) {
      if (amount > state.balance) {
        prices.push(0n);
      } else {
        prices.push(amount);
      }
    }

    return [
      {
        prices,
        unit: this.unitPrice,
        gasCost: MIRO_MIGRATION_GAS_COST,
        exchange: this.dexKey,
        poolAddresses: [this.migratorAddress],
        data: null,
      },
    ];
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<MiroMigratorData>,
  ): number | number[] {
    return (
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.OFFSET_SMALL +
      CALLDATA_GAS_COST.ZERO
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: MiroMigratorData,
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
    data: MiroMigratorData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = this.migratorInterface.encodeFunctionData(
      MiroMigratorFunctions.migratePSPtoXYZ,
      [srcAmount, '0x'],
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
    data: MiroMigratorData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = this.migratorInterface.encodeFunctionData(
      MiroMigratorFunctions.migratePSPtoXYZ,
      [srcAmount, '0x'],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.migratorAddress,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.isPSP(tokenAddress) && !this.isXYZ(tokenAddress)) {
      return [];
    }

    return [
      {
        exchange: this.dexKey,
        address: this.migratorAddress,
        connectorTokens: [
          {
            address: this.isPSP(tokenAddress)
              ? this.xyzTokenAddress
              : this.pspTokenAddress,
            decimals: 18,
          },
        ],
        liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
      },
    ];
  }
}
