import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  Logger,
  PoolLiquidity,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { SimpleExchange } from '../simple-exchange';
import { BI_POWS } from '../../bigint-constants';
import { DexParams, UsualPPData } from './types';
import { UsualPool } from './pool';
import { Interface } from '@ethersproject/abi';
import UsualPoolAbi from '../../abi/usual-pp/abi.json';
import { Config } from './config';
import { getDexKeysWithNetwork } from '../../utils';

export class UsualPP extends SimpleExchange implements IDex<UsualPPData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  private usualPool: UsualPool;
  private usualPoolIface: Interface;
  private config: DexParams;

  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(Config);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = {},
  ) {
    super(dexHelper, dexKey);
    this.config = Config[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
    this.usualPoolIface = new Interface(UsualPoolAbi);
    this.usualPool = new UsualPool(
      this.dexKey,
      dexHelper,
      this.config.USD0PP.address,
      this.usualPoolIface,
      this.logger,
    );
  }

  async initializePricing(blockNumber: number) {
    await this.usualPool.initialize(blockNumber);
  }

  isUsd0PP(token: string) {
    return token.toLowerCase() === this.config.USD0PP.address.toLowerCase();
  }

  isUsd0(token: string) {
    return token.toLowerCase() === this.config.USD0.address.toLowerCase();
  }

  isValidTokens(srcToken: string, destToken: string) {
    return this.isUsd0PP(srcToken) && this.isUsd0(destToken);
  }

  getAdapters() {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!srcToken || !destToken) {
      this.logger.error('Source or destination token is undefined');
      return [];
    }

    const srcTokenAddress = srcToken.address?.toLowerCase();
    const destTokenAddress = destToken.address?.toLowerCase();

    if (!srcTokenAddress || !destTokenAddress) {
      this.logger.error('Source or destination token address is undefined');
      return [];
    }

    if (this.isValidTokens(srcTokenAddress, destTokenAddress)) {
      return [`${this.dexKey}_${this.config.USD0.address}`];
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
  ): Promise<null | ExchangePrices<UsualPPData>> {
    if (side === SwapSide.BUY) {
      return null;
    }

    const isValidSwap = this.isValidTokens(srcToken.address, destToken.address);

    if (!isValidSwap) {
      return null;
    }

    const price = await this.usualPool.getPrice(blockNumber);
    const unitOut = price;

    const amountsOut = amounts.map(
      amount => (amount * price) / BI_POWS[this.config.USD0PP.decimals],
    );

    return [
      {
        unit: unitOut,
        prices: amountsOut,
        data: {},
        poolAddresses: [this.config.USD0.address],
        exchange: this.dexKey,
        gasCost: 70000,
        poolIdentifier: this.dexKey,
      },
    ];
  }

  getCalldataGasCost(poolPrices: PoolPrices<UsualPPData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: UsualPPData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const payload = '0x';

    return {
      targetExchange: this.config.USD0.address,
      payload,
      networkFee: '0',
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const isUsd0PP = this.isUsd0PP(tokenAddress);
    const isUsd0 = this.isUsd0(tokenAddress);

    if (!(isUsd0PP || isUsd0)) return [];

    return [
      {
        exchange: this.dexKey,
        address: this.config.USD0PP.address,
        connectorTokens: [isUsd0PP ? this.config.USD0 : this.config.USD0PP],
        liquidityUSD: 1000000000, // Just returning a big number so this DEX will be preferred
      },
    ];
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: UsualPPData,
    side: SwapSide,
  ): Promise<DexExchangeParam> {
    if (this.isUsd0PP(srcToken) && this.isUsd0(destToken)) {
      const exchangeData = this.usualPoolIface.encodeFunctionData(
        'unlockUsd0ppFloorPrice',
        [srcAmount],
      );

      return {
        needWrapNative: false,
        dexFuncHasRecipient: false,
        exchangeData,
        targetExchange: this.config.USD0PP.address,
        returnAmountPos: undefined,
      };
    }
    throw new Error('LOGIC ERROR');
  }
}
