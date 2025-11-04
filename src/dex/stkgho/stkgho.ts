import { AsyncOrSync } from 'ts-essentials';
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
  UNLIMITED_USD_LIQUIDITY,
  NO_USD_LIQUIDITY,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { DexParams, PoolState, StkGHOData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { StkGHOConfig } from './config';
import { StkGHOEventPool } from './stkgho-pool';
import { Interface } from '@ethersproject/abi';
import StkGHO_ABI from '../../abi/stkGHO.json';

export class StkGHO extends SimpleExchange implements IDex<StkGHOData> {
  static readonly stkGHOInterface = new Interface(StkGHO_ABI);
  protected eventPool: StkGHOEventPool;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  protected config: DexParams;

  readonly isFeeOnTransferSupported = false;
  readonly exchangeRateUnit = 1_000_000_000_000_000_000n;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(StkGHOConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new StkGHOEventPool(
      dexKey,
      dexKey,
      network,
      dexHelper,
      this.logger,
    );

    const config = StkGHOConfig[dexKey][network];
    this.config = {
      stkGHO: config.stkGHO.toLowerCase(),
      GHO: config.GHO.toLowerCase(),
    };
  }

  async initializePricing(blockNumber: number) {
    const state = await this.eventPool.generateState(blockNumber);

    this.eventPool.initialize(blockNumber, {
      state,
    });
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
    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();

    if (
      srcTokenAddress === this.config.GHO &&
      destTokenAddress === this.config.stkGHO
    ) {
      return [`${this.dexKey}`];
    } else {
      return [];
    }
  }

  async getPoolState(blockNumber: number): Promise<PoolState> {
    const eventState = this.eventPool.getState(blockNumber);
    if (eventState) return eventState;
    const onChainState = await this.eventPool.generateState(blockNumber);
    this.eventPool.setState(onChainState, blockNumber);
    return onChainState;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<StkGHOData>> {
    if (side === SwapSide.BUY) {
      return null;
    }

    const srcTokenAddress = srcToken.address.toLowerCase();
    const destTokenAddress = destToken.address.toLowerCase();

    if (
      srcTokenAddress != this.config.GHO ||
      destTokenAddress != this.config.stkGHO
    ) {
      return null;
    }

    const state = await this.getPoolState(blockNumber);

    return [
      {
        unit: state.exchangeRate,
        prices: amounts.map(
          amount => (state.exchangeRate * amount) / this.exchangeRateUnit,
        ),
        data: {
          exchange: this.dexKey,
        },
        poolAddresses: [this.config.stkGHO],
        exchange: this.dexKey,
        gasCost: 100_000,
        poolIdentifiers: [`${this.dexKey}`],
      },
    ];
  }

  getCalldataGasCost(poolPrices: PoolPrices<StkGHOData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: StkGHOData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    const payload = '';

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  async updatePoolState(): Promise<void> {}

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: StkGHOData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    const exchangeData = StkGHO.stkGHOInterface.encodeFunctionData('stake', [
      recipient,
      srcAmount,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.stkGHO,
      returnAmountPos: undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    tokenAddress = tokenAddress.toLowerCase();
    const isGHO = tokenAddress == this.config.GHO;

    if (isGHO) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.stkGHO,
          connectorTokens: [
            {
              decimals: 18,
              address: this.config.stkGHO,
              liquidityUSD: NO_USD_LIQUIDITY,
            },
          ],
          liquidityUSD: UNLIMITED_USD_LIQUIDITY,
        },
      ];
    }

    return [];
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {}
}
