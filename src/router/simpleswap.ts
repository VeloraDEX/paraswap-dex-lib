import { IRouter } from './irouter';
import {
  Address,
  OptimalRate,
  ConstractSimpleData,
  TxInfo,
  SimpleExchangeParam,
} from '../types';
import { SwapSide } from '../constants';
import IParaswapABI from '../abi/IParaswap.json';
import { Interface } from '@ethersproject/abi';
import { isETHAddress, uuidToBytes16 } from '../utils';
import { Weth } from '../dex/weth/weth';
import { IWethDepositorWithdrawer } from '../dex/weth/types';

import { DexAdapterService } from '../dex';
import {
  encodeFeePercent,
  encodeFeePercentForReferrer,
  encodePartnerAddressForFeeLogic,
} from './payload-encoder';
import { ParaSwapVersion } from '@paraswap/core';

type SimpleSwapParam = [ConstractSimpleData];

export type PartialContractSimpleData = Pick<
  ConstractSimpleData,
  'callees' | 'exchangeData' | 'values' | 'startIndexes'
>;

export abstract class SimpleRouterBase<RouterParam>
  implements IRouter<RouterParam>
{
  paraswapInterface: Interface;

  constructor(
    protected dexAdapterService: DexAdapterService,
    protected side: SwapSide,
    protected contractMethodName: string = side === SwapSide.SELL
      ? 'simpleSwap'
      : 'simpleBuy',

    // prepare mapping: network -> wrapped exchange key
    // It assumes that no network has more than one wrapped exchange
    protected wExchangeNetworkToKey = Weth.dexKeysWithNetwork.reduce<
      Record<number, string>
    >((prev, current) => {
      for (const network of current.networks) {
        prev[network] = current.key;
      }
      return prev;
    }, {}),
  ) {
    this.paraswapInterface = new Interface(IParaswapABI);
  }

  getContractMethodName(): string {
    return this.contractMethodName;
  }

  private buildPartialContractSimpleData(
    simpleExchangeParam: SimpleExchangeParam,
  ): PartialContractSimpleData {
    const calldata = simpleExchangeParam.calldata;
    let exchangeData = '0x';
    let startIndexes = [0];

    for (let i = 0; i < calldata.length; i++) {
      const tempCalldata = calldata[i].substring(2);
      const index = tempCalldata.length / 2;
      startIndexes.push(startIndexes[i] + index);
      exchangeData = exchangeData.concat(tempCalldata);
    }

    return {
      callees: simpleExchangeParam.callees,
      values: simpleExchangeParam.values,
      exchangeData,
      startIndexes,
    };
  }

  protected async buildCalls(
    priceRoute: OptimalRate,
    minMaxAmount: string,
  ): Promise<{
    partialContractSimpleData: PartialContractSimpleData;
    networkFee: string;
  }> {
    const wethAddress =
      this.dexAdapterService.dexHelper.config.data.wrappedNativeTokenAddress;

    const rawSimpleParams = await Promise.all(
      priceRoute.bestRoute[0].swaps.flatMap((swap, swapIndex) =>
        swap.swapExchanges.map(async se => {
          const dex = this.dexAdapterService.getTxBuilderDexByKey(se.exchange);
          let _src = swap.srcToken;
          let wethDeposit = 0n;
          let _dest = swap.destToken;
          let wethWithdraw = 0n;

          // For case of buy apply slippage is applied to srcAmount in equal proportion as the complete swap
          // This assumes that the sum of all swaps srcAmount would sum to priceRoute.srcAmount
          // Also that it is a direct swap.
          const _srcAmount =
            swapIndex > 0 || this.side === SwapSide.SELL
              ? se.srcAmount
              : (
                  (BigInt(se.srcAmount) * BigInt(minMaxAmount)) /
                  BigInt(priceRoute.srcAmount)
                ).toString();

          // In case of sell the destAmount is set to minimum (1) as
          // even if the individual dex is rekt by slippage the swap
          // should work if the final slippage check passes.
          const _destAmount = this.side === SwapSide.SELL ? '1' : se.destAmount;

          const dexNeedWrapNative =
            typeof dex.needWrapNative === 'function'
              ? dex.needWrapNative(priceRoute, swap, se)
              : dex.needWrapNative;

          if (dexNeedWrapNative) {
            if (isETHAddress(swap.srcToken)) {
              if (swapIndex !== 0) {
                throw new Error('Wrap native srcToken not in swapIndex 0');
              }
              _src = wethAddress;
              wethDeposit = BigInt(_srcAmount);
            }

            if (isETHAddress(swap.destToken)) {
              if (swapIndex !== priceRoute.bestRoute[0].swaps.length - 1) {
                throw new Error('Wrap native destToken not in swapIndex last');
              }
              _dest = wethAddress;
              wethWithdraw = BigInt(_destAmount);
            }
          }

          const simpleParams = await dex.getSimpleParam?.(
            _src,
            _dest,
            _srcAmount,
            _destAmount,
            se.data,
            this.side,
          );

          return {
            simpleParams,
            wethDeposit,
            wethWithdraw,
          };
        }),
      ),
    );

    const {
      simpleExchangeDataList,
      srcAmountWethToDeposit,
      destAmountWethToWithdraw,
    } = rawSimpleParams.reduce<{
      simpleExchangeDataList: SimpleExchangeParam[];
      srcAmountWethToDeposit: bigint;
      destAmountWethToWithdraw: bigint;
    }>(
      (acc, se) => {
        acc.srcAmountWethToDeposit += BigInt(se.wethDeposit);
        acc.destAmountWethToWithdraw += BigInt(se.wethWithdraw);
        // V6 doesn't have simpleParams
        if (se.simpleParams) {
          acc.simpleExchangeDataList.push(se.simpleParams);
        }

        return acc;
      },
      {
        simpleExchangeDataList: [],
        srcAmountWethToDeposit: 0n,
        destAmountWethToWithdraw: 0n,
      },
    );

    const simpleExchangeDataFlat = simpleExchangeDataList.reduce(
      (acc, se) => ({
        callees: acc.callees.concat(se.callees),
        calldata: acc.calldata.concat(se.calldata),
        values: acc.values.concat(se.values),
        networkFee: (BigInt(acc.networkFee) + BigInt(se.networkFee)).toString(),
      }),
      { callees: [], values: [], calldata: [], networkFee: '0' },
    );

    const maybeWethCallData = this.getDepositWithdrawWethCallData(
      srcAmountWethToDeposit,
      destAmountWethToWithdraw,
    );

    if (maybeWethCallData) {
      if (maybeWethCallData.deposit) {
        simpleExchangeDataFlat.callees.unshift(
          maybeWethCallData.deposit.callee,
        );
        simpleExchangeDataFlat.values.unshift(maybeWethCallData.deposit.value);
        simpleExchangeDataFlat.calldata.unshift(
          maybeWethCallData.deposit.calldata,
        );
      }
      if (maybeWethCallData.withdraw) {
        simpleExchangeDataFlat.callees.push(maybeWethCallData.withdraw.callee);
        simpleExchangeDataFlat.values.push(maybeWethCallData.withdraw.value);
        simpleExchangeDataFlat.calldata.push(
          maybeWethCallData.withdraw.calldata,
        );
      }
    }

    return {
      partialContractSimpleData: this.buildPartialContractSimpleData(
        simpleExchangeDataFlat,
      ),
      networkFee: simpleExchangeDataFlat.networkFee,
    };
  }

  abstract build(
    priceRoute: OptimalRate,
    minMaxAmount: string,
    userAddress: Address,
    referrerAddress: Address | undefined,
    partnerAddress: Address,
    partnerFeePercent: string,
    takeSurplus: boolean,
    beneficiary: Address,
    permit: string,
    deadline: string,
    uuid: string,
  ): Promise<TxInfo<RouterParam>>;

  protected getDepositWithdrawWethCallData(
    srcAmountWeth: bigint,
    destAmountWeth: bigint,
  ) {
    if (srcAmountWeth === 0n && destAmountWeth === 0n) return;

    return (
      this.dexAdapterService.getTxBuilderDexByKey(
        this.wExchangeNetworkToKey[this.dexAdapterService.network],
      ) as unknown as IWethDepositorWithdrawer
    ).getDepositWithdrawParam(
      srcAmountWeth.toString(),
      destAmountWeth.toString(),
      this.side,
      ParaSwapVersion.V5,
    );
  }
}

export abstract class SimpleRouter extends SimpleRouterBase<SimpleSwapParam> {
  constructor(
    dexAdapterService: DexAdapterService,
    side: SwapSide,
    contractMethodName: string,
  ) {
    super(dexAdapterService, side, contractMethodName);
  }

  protected validateBestRoute(priceRoute: OptimalRate): boolean {
    return (
      priceRoute.bestRoute.length === 1 &&
      priceRoute.bestRoute[0].percent === 100 &&
      priceRoute.bestRoute[0].swaps.length === 1
    );
  }

  async build(
    priceRoute: OptimalRate,
    minMaxAmount: string,
    userAddress: Address,
    referrerAddress: Address | undefined,
    partnerAddress: Address,
    partnerFeePercent: string,
    takeSurplus: boolean,
    beneficiary: Address,
    permit: string,
    deadline: string,
    uuid: string,
  ): Promise<TxInfo<SimpleSwapParam>> {
    if (!this.validateBestRoute(priceRoute))
      throw new Error(`${this.contractMethodName} invalid bestRoute`);

    const { partialContractSimpleData, networkFee } = await this.buildCalls(
      priceRoute,
      minMaxAmount,
    );

    const [partner, feePercent] = referrerAddress
      ? [referrerAddress, encodeFeePercentForReferrer(this.side)]
      : [
          encodePartnerAddressForFeeLogic({
            partnerAddress,
            partnerFeePercent,
            takeSurplus,
          }),
          encodeFeePercent(partnerFeePercent, takeSurplus, this.side),
        ];

    const sellData: ConstractSimpleData = {
      ...partialContractSimpleData,
      fromToken: priceRoute.srcToken,
      toToken: priceRoute.destToken,
      fromAmount:
        this.side === SwapSide.SELL ? priceRoute.srcAmount : minMaxAmount,
      toAmount:
        this.side === SwapSide.SELL ? minMaxAmount : priceRoute.destAmount,
      expectedAmount:
        this.side === SwapSide.SELL
          ? priceRoute.destAmount
          : priceRoute.srcAmount,
      beneficiary,
      partner,
      feePercent,
      permit,
      deadline,
      uuid: uuidToBytes16(uuid),
    };

    const encoder = (...params: any[]) =>
      this.paraswapInterface.encodeFunctionData(
        this.contractMethodName,
        params,
      );
    // TODO: fix network fee
    return {
      encoder,
      params: [sellData],
      networkFee,
    };
  }
}

export class SimpleSwap extends SimpleRouter {
  static isBuy = false;
  constructor(dexAdapterService: DexAdapterService) {
    super(dexAdapterService, SwapSide.SELL, 'simpleSwap');
  }
}

export class SimpleBuy extends SimpleRouter {
  static isBuy = true;
  constructor(dexAdapterService: DexAdapterService) {
    super(dexAdapterService, SwapSide.BUY, 'simpleBuy');
  }

  // Need to handle special case where second swap consists entirely of
  // AugustusRFQOrder executions
  protected validateBestRoute(priceRoute: OptimalRate): boolean {
    return (
      priceRoute.bestRoute.length === 1 &&
      priceRoute.bestRoute[0].percent === 100 &&
      (priceRoute.bestRoute[0].swaps.length === 1 ||
        (priceRoute.bestRoute[0].swaps.length === 2 &&
          !priceRoute.bestRoute[0].swaps[1].swapExchanges.find(
            se => se.exchange.toLowerCase() !== 'augustusrfqorder',
          )))
    );
  }
}
