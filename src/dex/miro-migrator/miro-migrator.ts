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
import { SwapSide, Network, NO_USD_LIQUIDITY } from '../../constants';
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
import { MIRO_MIGRATION_GAS_COST } from './constants';
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
    readonly config = MiroMigratorConfig[dexKey][network],
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
      this.config.migratorAddress,
      this.config.vlrTokenAddress,
    );
  }

  isPSP(tokenAddress: Address) {
    return (
      this.config.pspTokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
  }

  isSePSP1Token(tokenAddress: Address) {
    return (
      this.config.sePsp1TokenAddress.toLowerCase() ===
      tokenAddress.toLowerCase()
    );
  }

  isVLRToken(tokenAddress: Address) {
    return (
      this.config.vlrTokenAddress.toLowerCase() === tokenAddress.toLowerCase()
    );
  }

  isAppropriatePair(srcToken: Token, destToken: Token) {
    return (
      (this.isPSP(srcToken.address) && this.isVLRToken(destToken.address)) ||
      (this.isSePSP1Token(srcToken.address) &&
        this.isVLRToken(destToken.address))
    );
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
        poolAddresses: [this.config.migratorAddress],
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
      targetExchange: this.config.migratorAddress,
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
    const isPSPtoVLR = this.isPSP(srcToken) && this.isVLRToken(destToken);

    const functionName = isPSPtoVLR
      ? MiroMigratorFunctions.migratePSPtoVLR
      : MiroMigratorFunctions.migrateSePSP1toVLR;

    const swapData = this.migratorInterface.encodeFunctionData(functionName, [
      srcAmount,
      '0x',
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.config.migratorAddress,
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
    const isPSPtoVLR = this.isPSP(srcToken) && this.isVLRToken(destToken);

    const functionName = isPSPtoVLR
      ? MiroMigratorFunctions.migratePSPtoVLR
      : MiroMigratorFunctions.migrateSePSP1toVLR;

    const swapData = this.migratorInterface.encodeFunctionData(functionName, [
      srcAmount,
      '0x',
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.config.migratorAddress,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const isPSP = this.isPSP(tokenAddress);
    const isSePSP1 = this.isSePSP1Token(tokenAddress);
    const isVLR = this.isVLRToken(tokenAddress);

    if (!isPSP && !isSePSP1 && !isVLR) {
      return [];
    }

    if (isPSP || isSePSP1) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.migratorAddress,
          connectorTokens: [
            {
              address: this.config.vlrTokenAddress,
              decimals: 18,
              liquidityUSD: NO_USD_LIQUIDITY,
            },
          ],
          liquidityUSD: 1_000_000_000,
        },
      ];
    }

    if (isVLR) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.migratorAddress,
          connectorTokens: [
            {
              address: this.config.pspTokenAddress,
              decimals: 18,
              liquidityUSD: 1000000000,
            },
            {
              address: this.config.sePsp1TokenAddress,
              decimals: 18,
              liquidityUSD: 1000000000,
            },
          ],
          liquidityUSD: NO_USD_LIQUIDITY,
        },
      ];
    }

    return [];
  }
}
