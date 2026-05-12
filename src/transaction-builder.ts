import {
  OptimalRate,
  Address,
  Adapters,
  OptimalSwap,
  OptimalSwapExchange,
} from './types';
import { ETHER_ADDRESS, SwapSide } from './constants';
import { RouterService } from './router';
import { DexAdapterService } from './dex';
import { IDexTxBuilder } from './dex/idex';

export class TransactionBuilder {
  routerService: RouterService;
  augustusAddress: Address;

  constructor(protected dexAdapterService: DexAdapterService) {
    this.routerService = new RouterService(this.dexAdapterService);
    this.augustusAddress =
      this.dexAdapterService.dexHelper.config.data.augustusAddress;
  }

  public async build({
    priceRoute,
    minMaxAmount,
    userAddress,
    referrerAddress,
    partnerAddress,
    partnerFeePercent,
    takeSurplus,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    permit,
    deadline,
    uuid,
    beneficiary,
    onlyParams = false,
  }: {
    priceRoute: OptimalRate;
    minMaxAmount: string;
    userAddress: Address;
    referrerAddress?: Address;
    partnerAddress: Address;
    partnerFeePercent: string;
    takeSurplus?: boolean;
    gasPrice?: string; // // @TODO: improve types? so that either gasPrice or ALL of max.*FeePerGas MUST be returned?
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    permit?: string;
    deadline: string;
    uuid: string;
    beneficiary?: Address;
    onlyParams?: boolean;
  }) {
    const _beneficiary = beneficiary || userAddress;
    const { encoder, params, networkFee } = await this.routerService
      .getRouterByContractMethod(priceRoute.contractMethod)
      .build(
        priceRoute,
        minMaxAmount,
        userAddress,
        referrerAddress,
        partnerAddress,
        partnerFeePercent,
        takeSurplus ?? false,
        _beneficiary,
        permit || '0x',
        deadline,
        uuid,
      );

    if (onlyParams) return params;

    const value = (
      priceRoute.srcToken.toLowerCase() === ETHER_ADDRESS.toLowerCase()
        ? BigInt(
            priceRoute.side === SwapSide.SELL
              ? priceRoute.srcAmount
              : minMaxAmount,
          ) + BigInt(networkFee)
        : BigInt(networkFee)
    ).toString();

    return {
      from: userAddress,
      to: priceRoute.contractAddress,
      value,
      data: encoder.apply(null, params),
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  }

  public getExecutionContractAddress(): Address {
    return this.augustusAddress;
  }

  public getDexCallsParams(
    priceRoute: OptimalRate,
    routeIndex: number,
    swap: OptimalSwap,
    swapIndex: number,
    se: OptimalSwapExchange<any>,
    minMaxAmount: string,
    dexNeedWrapNative: boolean,
    executionContractAddress: string,
  ): {
    srcToken: Address;
    destToken: Address;
    recipient: Address;
    srcAmount: string;
    destAmount: string;
    wethDeposit: bigint;
    wethWithdraw: bigint;
  } {
    // for v5 only recipient param is used
    return {
      srcToken: swap.srcToken,
      destToken: swap.destToken,
      recipient: this.augustusAddress,
      srcAmount: se.srcAmount,
      destAmount: se.destAmount,
      wethDeposit: 0n,
      wethWithdraw: 0n,
    };
  }
}
