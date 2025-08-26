import { IRouter } from './irouter';
import { IDex } from '../dex/idex';
import { Address, OptimalRate, TxInfo, Adapters } from '../types';
import { SwapSide } from '../constants';
import { DexAdapterService } from '../dex';
import { assert } from 'ts-essentials';
import {
  encodeFeePercent,
  encodeFeePercentForReferrer,
  encodePartnerAddressForFeeLogic,
} from './payload-encoder';

export class DirectSwap<DexDirectReturn> implements IRouter<DexDirectReturn> {
  // This is just pseudo name as the DirectSwap
  // is more generic and works with multiple
  // contract methods.
  contractMethodName: string = 'directSwap';

  constructor(private dexAdapterService: DexAdapterService) {}

  getContractMethodName(): string {
    return this.contractMethodName;
  }

  build(
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
  ): TxInfo<DexDirectReturn> {
    // TODO: add checks for src and dest amounts
    if (
      priceRoute.bestRoute.length !== 1 ||
      priceRoute.bestRoute[0].percent !== 100 ||
      priceRoute.bestRoute[0].swaps.length !== 1 ||
      priceRoute.bestRoute[0].swaps[0].swapExchanges.length !== 1 ||
      priceRoute.bestRoute[0].swaps[0].swapExchanges[0].percent !== 100
    )
      throw new Error(`DirectSwap invalid bestRoute`);

    const dexName = priceRoute.bestRoute[0].swaps[0].swapExchanges[0].exchange;
    if (!dexName) throw new Error(`Invalid dex name`);

    const dex = this.dexAdapterService.getTxBuilderDexByKey(dexName);
    if (!dex) throw new Error(`Failed to find dex : ${dexName}`);

    if (!dex.getDirectParam)
      throw new Error(
        `Invalid DEX: dex should have getDirectParam : ${dexName}`,
      );

    const swapExchange = priceRoute.bestRoute[0].swaps[0].swapExchanges[0];

    const srcAmount =
      priceRoute.side === SwapSide.SELL ? swapExchange.srcAmount : minMaxAmount;
    const destAmount =
      priceRoute.side === SwapSide.SELL
        ? minMaxAmount
        : swapExchange.destAmount;

    const expectedAmount =
      priceRoute.side === SwapSide.SELL
        ? priceRoute.destAmount
        : priceRoute.srcAmount;

    const [partner, feePercent] = referrerAddress
      ? [referrerAddress, encodeFeePercentForReferrer(priceRoute.side)]
      : [
          encodePartnerAddressForFeeLogic({
            partnerAddress,
            partnerFeePercent,
            takeSurplus,
          }),
          encodeFeePercent(partnerFeePercent, takeSurplus, priceRoute.side),
        ];

    return dex.getDirectParam!(
      priceRoute.srcToken,
      priceRoute.destToken,
      srcAmount,
      destAmount,
      expectedAmount,
      swapExchange.data,
      priceRoute.side,
      permit,
      uuid,
      feePercent,
      deadline,
      partner,
      beneficiary,
      priceRoute.contractMethod,
    );
  }
}
