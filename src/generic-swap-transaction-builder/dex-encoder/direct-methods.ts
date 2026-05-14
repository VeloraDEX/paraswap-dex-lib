import { ContractMethodV6, SwapSide } from '@paraswap/core';

export const DIRECT_CONTRACT_METHODS_V6 = [
  ContractMethodV6.swapExactAmountInOnUniswapV2,
  ContractMethodV6.swapExactAmountOutOnUniswapV2,
  ContractMethodV6.swapExactAmountInOnUniswapV3,
  ContractMethodV6.swapExactAmountOutOnUniswapV3,
  ContractMethodV6.swapExactAmountInOnBalancerV2,
  ContractMethodV6.swapExactAmountOutOnBalancerV2,
  ContractMethodV6.swapExactAmountInOnCurveV1,
  ContractMethodV6.swapExactAmountInOnCurveV2,
  ContractMethodV6.swapOnAugustusRFQTryBatchFill,
  ContractMethodV6.swapExactAmountInOutOnMakerPSM,
] as const satisfies readonly ContractMethodV6[];

export type DirectContractMethodV6 =
  (typeof DIRECT_CONTRACT_METHODS_V6)[number];

const DIRECT_CONTRACT_METHOD_SET_V6 = new Set<string>(
  DIRECT_CONTRACT_METHODS_V6,
);

// Omits swapOnAugustusRFQTryBatchFill and swapExactAmountInOutOnMakerPSM:
// those methods do not encode side in the method name. An undefined lookup
// means side must come from the per-call route input.
export const DIRECT_CONTRACT_METHOD_SIDES_V6: Partial<
  Record<DirectContractMethodV6, SwapSide>
> = {
  [ContractMethodV6.swapExactAmountInOnUniswapV2]: SwapSide.SELL,
  [ContractMethodV6.swapExactAmountOutOnUniswapV2]: SwapSide.BUY,
  [ContractMethodV6.swapExactAmountInOnUniswapV3]: SwapSide.SELL,
  [ContractMethodV6.swapExactAmountOutOnUniswapV3]: SwapSide.BUY,
  [ContractMethodV6.swapExactAmountInOnBalancerV2]: SwapSide.SELL,
  [ContractMethodV6.swapExactAmountOutOnBalancerV2]: SwapSide.BUY,
  [ContractMethodV6.swapExactAmountInOnCurveV1]: SwapSide.SELL,
  [ContractMethodV6.swapExactAmountInOnCurveV2]: SwapSide.SELL,
};

export function isDirectContractMethodV6(
  contractMethod: string,
): contractMethod is DirectContractMethodV6 {
  return DIRECT_CONTRACT_METHOD_SET_V6.has(contractMethod);
}

export function getDirectContractMethodSideV6(
  contractMethod: DirectContractMethodV6,
): SwapSide | undefined {
  return DIRECT_CONTRACT_METHOD_SIDES_V6[contractMethod];
}
