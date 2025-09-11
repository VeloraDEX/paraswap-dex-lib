import { Interface, JsonFragment } from '@ethersproject/abi';
import { NumberAsString, SwapSide } from '@paraswap/core';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
  TransferFeeParams,
} from '../../types';
import { IDex } from '../idex';
import YNETH_ABI from '../../abi/ynETH.json';
import { ETHER_ADDRESS, Network, NULL_ADDRESS } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { SimpleExchange } from '../simple-exchange';
import { BI_POWS } from '../../bigint-constants';
import { AsyncOrSync } from 'ts-essentials';
import { YnethPool } from './yneth-pool';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { WethFunctions } from '../weth/types';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import _ from 'lodash';
import { YieldnestConfig, Adapters } from './config';
import { BigNumber, ethers } from 'ethers';

export enum ynETHFunctions {
  deposit = 'depositETH',
}

export type YieldnestData = {};
export type YieldnestParams = {};

export class Yieldnest
  extends SimpleExchange
  implements IDex<YieldnestData, YieldnestParams>
{
  static dexKeys = ['Yieldnest'];
  ynETHInterface: Interface;
  needWrapNative = false;
  hasConstantPriceLargeAmounts: boolean = true;
  ynETHAddress: string;
  ynethPool: YnethPool;
  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(YieldnestConfig, ['Yieldnest']));

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected config = YieldnestConfig[dexKey][network],
    protected adapters = Adapters[network],
  ) {
    super(dexHelper, 'Yieldnest');

    this.network = dexHelper.config.data.network;
    this.ynETHInterface = new Interface(YNETH_ABI as JsonFragment[]);
    this.ynETHAddress = this.config.ynETH.toLowerCase();
    this.logger = dexHelper.getLogger(this.dexKey);
    this.ynethPool = new YnethPool(
      this.dexKey,
      dexHelper,
      this.ynETHAddress,
      this.ynETHInterface,
      this.logger,
    );
  }

  async initializePricing(blockNumber: number) {
    const data: { returnData: any[] } =
      await this.dexHelper.multiContract.methods
        .aggregate([
          {
            target: this.ynETHAddress,
            callData: this.ynETHInterface.encodeFunctionData('previewDeposit', [
              BigNumber.from(10).pow(18),
            ]),
          },
        ])
        .call({}, blockNumber);

    const decodedData = ethers.utils.defaultAbiCoder.decode(
      ['uint256'],
      data.returnData[0],
    );

    const ETHToynETHRateFixed = BigInt(decodedData.toString()) / 10n ** 18n;

    await Promise.all([
      this.ynethPool.initialize(blockNumber, {
        state: { ynETHToETHRateFixed: 1n / ETHToynETHRateFixed },
      }),
    ]);
  }

  isEligibleSwap(
    srcToken: Token | string,
    destToken: Token | string,
    side: SwapSide,
  ): boolean {
    if (side === SwapSide.BUY) return false;

    const srcTokenAddress = (
      typeof srcToken === 'string' ? srcToken : srcToken.address
    ).toLowerCase();
    const destTokenAddress = (
      typeof destToken === 'string' ? destToken : destToken.address
    ).toLowerCase();

    return (
      (isETHAddress(srcTokenAddress) || this.isWETH(srcTokenAddress)) &&
      destTokenAddress === this.ynETHAddress
    );
  }

  assertEligibility(
    srcToken: Token | string,
    destToken: Token | string,
    side: SwapSide,
  ) {
    if (!this.isEligibleSwap(srcToken, destToken, side)) {
      throw new Error('Only eth/weth -> ynETH swaps are supported');
    }
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.isEligibleSwap(srcToken, destToken, side)) return [];

    return [`${ETHER_ADDRESS}_${destToken.address}`.toLowerCase()];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amountsIn: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[] | undefined,
    transferFees?: TransferFeeParams | undefined,
    isFirstSwap?: boolean | undefined,
  ): Promise<ExchangePrices<YieldnestData> | null> {
    if (!this.isEligibleSwap(srcToken, destToken, side)) return null;

    const pool = this.ynethPool;

    if (!pool.getState(blockNumber)) return null;

    const unitIn = BI_POWS[18];
    const unitOut = pool.getPrice(blockNumber, unitIn);
    const amountsOut = amountsIn.map(amountIn =>
      pool.getPrice(blockNumber, amountIn),
    );

    return [
      {
        prices: amountsOut,
        unit: unitOut,
        data: {},
        exchange: this.dexKey,
        poolIdentifier: `${ETHER_ADDRESS}_${destToken.address}`.toLowerCase(),
        gasCost: 120_000,
        poolAddresses: [destToken.address],
      },
    ];
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: YieldnestData,
    side: SwapSide,
  ): AdapterExchangeParam {
    this.assertEligibility(srcToken, destToken, side);

    return {
      targetExchange: NULL_ADDRESS,
      payload: '0x',
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: YieldnestData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    this.assertEligibility(srcToken, destToken, side);

    const callees = [];
    const calldata = [];
    const values = [];

    if (this.isWETH(srcToken)) {
      // note: apparently ERC20 ABI contains wETH fns (deposit() and withdraw())
      const wethUnwrapData = this.erc20Interface.encodeFunctionData(
        WethFunctions.withdraw,
        [srcAmount],
      );
      callees.push(this.dexHelper.config.data.wrappedNativeTokenAddress);
      calldata.push(wethUnwrapData);
      values.push('0');
    }

    callees.push(destToken);
    calldata.push(
      this.ynETHInterface.encodeFunctionData(ynETHFunctions.deposit, [
        this.augustusAddress,
      ]),
    );
    values.push(srcAmount);

    return {
      callees,
      calldata,
      values,
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: YieldnestData,
    side: SwapSide,
  ): DexExchangeParam {
    this.assertEligibility(srcToken, destToken, side);

    const swapData = this.ynETHInterface.encodeFunctionData(
      ynETHFunctions.deposit,
      [recipient],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: destToken,
      swappedAmountNotPresentInExchangeData: true,
      preSwapUnwrapCalldata: this.isWETH(srcToken)
        ? this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
            srcAmount,
          ])
        : undefined,
      returnAmountPos: undefined,
    };
  }

  getCalldataGasCost(poolPrices: PoolPrices<YieldnestData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_OVERHEAD + CALLDATA_GAS_COST.LENGTH_SMALL;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters?.[side] || null;
  }

  getTopPoolsForToken(
    tokenAddress: string,
    limit: number,
  ): AsyncOrSync<PoolLiquidity[]> {
    return [];
  }
}
