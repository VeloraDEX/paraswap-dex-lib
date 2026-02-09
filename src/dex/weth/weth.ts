import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  WethData,
  WethFunctions,
  DexParams,
  IWethDepositorWithdrawer,
  DepositWithdrawData,
  DepositWithdrawReturn,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { Adapters, WethConfig } from './config';
import { BI_POWS } from '../../bigint-constants';
import { NumberAsString, ParaSwapVersion } from '@paraswap/core';

export class Weth
  extends SimpleExchange
  implements IDex<WethData, DexParams>, IWethDepositorWithdrawer
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(WethConfig);

  readonly address: Address;

  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    protected unitPrice = BI_POWS[18],
    protected poolGasCost = WethConfig[dexKey][network].poolGasCost,
  ) {
    super(dexHelper, dexKey);
    this.address = dexHelper.config.data.wrappedNativeTokenAddress;
    this.logger = dexHelper.getLogger(dexKey);
  }

  isWETH(tokenAddress: Address) {
    return this.address.toLowerCase() === tokenAddress.toLowerCase();
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] || null;
  }

  private getPoolIdentifier(address: Address): string {
    return `${this.network}_${address}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (isETHAddress(srcToken.address) && this.isWETH(destToken.address)) {
      return [this.getPoolIdentifier(destToken.address)];
    } else if (
      this.isWETH(srcToken.address) &&
      isETHAddress(destToken.address)
    ) {
      return [this.getPoolIdentifier(srcToken.address)];
    } else {
      return [];
    }
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<WethData>> {
    const isWETHSwap =
      (isETHAddress(srcToken.address) && this.isWETH(destToken.address)) ||
      (this.isWETH(srcToken.address) && isETHAddress(destToken.address));

    if (!isWETHSwap) return null;

    const gasCost = isETHAddress(srcToken.address) ? 6_500 : 9000;

    return [
      {
        prices: amounts,
        unit: this.unitPrice,
        gasCost,
        exchange: this.dexKey,
        poolAddresses: [this.address],
        poolIdentifiers: [
          isETHAddress(srcToken.address)
            ? this.getPoolIdentifier(destToken.address)
            : this.getPoolIdentifier(srcToken.address),
        ],
        data: null,
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<WethData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WethData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: this.address,
      payload: '0x',
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WethData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const swapData = isETHAddress(srcToken)
      ? this.erc20Interface.encodeFunctionData(WethFunctions.deposit)
      : this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
          srcAmount,
        ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.address,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: WethData,
    side: SwapSide,
  ): DexExchangeParam {
    const swapData = isETHAddress(srcToken)
      ? this.erc20Interface.encodeFunctionData(WethFunctions.deposit)
      : this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
          srcAmount,
        ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.address,
      returnAmountPos: undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
  }

  getDepositWithdrawParam(
    srcAmount: string,
    destAmount: string,
    side: SwapSide,
    version: ParaSwapVersion,
  ): DepositWithdrawReturn {
    const wethToken = this.address;

    let deposit: DepositWithdrawData | undefined;
    let withdraw: DepositWithdrawData | undefined;

    let needWithdraw = false;

    if (srcAmount !== '0') {
      const opType = WethFunctions.deposit;
      const depositWethData = this.erc20Interface.encodeFunctionData(opType);

      deposit = {
        callee: wethToken,
        calldata: depositWethData,
        value: srcAmount,
      };

      if (side === SwapSide.BUY) needWithdraw = true;
    }

    if (needWithdraw || destAmount !== '0') {
      const withdrawWethData =
        version === ParaSwapVersion.V5
          ? this.simpleSwapHelper.encodeFunctionData(
              WethFunctions.withdrawAllWETH,
              [wethToken],
            )
          : this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
              destAmount,
            ]);

      withdraw = {
        callee: this.augustusAddress, // FXME CALLEE NOT USED IN V6
        calldata: withdrawWethData,
        value: '0',
      };
    }

    return { deposit, withdraw };
  }
}
