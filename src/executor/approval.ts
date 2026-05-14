import type { Address, DexExchangeBuildParam } from '../types';
import type { ExecutorEncodingContext } from './encoding-types';
import { isETHAddress } from '../utils';

export type ApprovalTokenAndTarget = {
  target: string;
  token: Address;
};

export function getApprovalTokenAndTarget(
  swap: { srcToken: Address },
  exchangeParam: DexExchangeBuildParam,
  context: Pick<
    ExecutorEncodingContext,
    'wrappedNativeTokenAddress' | 'isWETH'
  >,
): ApprovalTokenAndTarget | null {
  if (exchangeParam.skipApproval) return null;

  const target = exchangeParam.spender || exchangeParam.targetExchange;

  if (exchangeParam.needUnwrapNative && context.isWETH(swap.srcToken)) {
    return null;
  }

  if (
    !isETHAddress(swap.srcToken) &&
    !exchangeParam.transferSrcTokenBeforeSwap
  ) {
    return {
      token: swap.srcToken,
      target,
    };
  }

  if (exchangeParam.needWrapNative && isETHAddress(swap.srcToken)) {
    return {
      token: exchangeParam.wethAddress || context.wrappedNativeTokenAddress,
      target,
    };
  }

  return null;
}
