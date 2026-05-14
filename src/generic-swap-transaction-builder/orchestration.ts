import { SwapSide } from '@paraswap/core';
import { ETHER_ADDRESS, NULL_ADDRESS } from '../constants';
import type { DepositWithdrawReturn } from '../dex/weth/types';
import { getApprovalTokenAndTarget } from '../executor/approval';
import type { ExecutorEncodingContext } from '../executor/encoding-types';
import type {
  Address,
  DexExchangeBuildParam,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
} from '../types';
import { isETHAddress } from '../utils';
import { routePositionKey, walkRoutePlan } from './resolved/route-plan';
import type { ResolvedLeg, RoutePlan } from './resolved/types';

export type GenericDexCallParams = {
  srcToken: Address;
  destToken: Address;
  recipient: Address;
  srcAmount: string;
  destAmount: string;
  wethDeposit: bigint;
  wethWithdraw: bigint;
};

export type WethCallDataProvider = (
  srcAmountWeth: string,
  destAmountWeth: string,
  side: SwapSide,
) =>
  | DepositWithdrawReturn
  | undefined
  | Promise<DepositWithdrawReturn | undefined>;

export type ResolvedLegWithWeth = {
  resolvedLeg: ResolvedLeg;
  wethDeposit: bigint;
  wethWithdraw: bigint;
};

export type DexExchangeApprovalRequest = {
  params: [token: Address, target: Address, permit2: boolean];
  routePositionKey: string;
};

export function resolveQuotedAmount(
  priceRoute: Pick<OptimalRate, 'side' | 'srcAmount' | 'destAmount'>,
  quotedAmount?: string,
): string {
  if (quotedAmount) return quotedAmount;

  return priceRoute.side === SwapSide.SELL
    ? priceRoute.destAmount
    : priceRoute.srcAmount;
}

export function resolveBeneficiary(
  userAddress: Address,
  beneficiary: Address = NULL_ADDRESS,
): Address {
  return beneficiary !== NULL_ADDRESS &&
    beneficiary.toLowerCase() !== userAddress.toLowerCase()
    ? beneficiary
    : NULL_ADDRESS;
}

export function resolvePermit(permit?: string): string {
  return permit || '0x';
}

export function buildGenericDexCallParams({
  priceRoute,
  routeIndex,
  swap,
  swapIndex,
  swapExchange,
  minMaxAmount,
  dexNeedWrapNative,
  executionContractAddress,
  wrappedNativeTokenAddress,
  augustusV6Address,
}: {
  priceRoute: OptimalRate;
  routeIndex: number;
  swap: OptimalSwap;
  swapIndex: number;
  swapExchange: OptimalSwapExchange<unknown>;
  minMaxAmount: string;
  dexNeedWrapNative: boolean;
  executionContractAddress: Address;
  wrappedNativeTokenAddress: Address;
  augustusV6Address: Address;
}): GenericDexCallParams {
  const side = priceRoute.side;

  const isMegaSwap = priceRoute.bestRoute.length > 1;
  const isMultiSwap = !isMegaSwap && priceRoute.bestRoute[0].swaps.length > 1;

  const isLastSwap =
    swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;

  let srcToken = swap.srcToken;
  let destToken = swap.destToken;
  let wethDeposit = 0n;
  let wethWithdraw = 0n;

  // For buys, apply slippage to the first swap srcAmount in the same
  // proportion as the complete swap.
  const srcAmount =
    swapIndex > 0 || side === SwapSide.SELL
      ? swapExchange.srcAmount
      : (
          (BigInt(swapExchange.srcAmount) * BigInt(minMaxAmount)) /
          BigInt(priceRoute.srcAmount)
        ).toString();

  const destAmount = side === SwapSide.SELL ? '1' : swapExchange.destAmount;

  if (isETHAddress(swap.srcToken) && dexNeedWrapNative) {
    srcToken = wrappedNativeTokenAddress;
    wethDeposit = BigInt(srcAmount);
  }

  const forceUnwrap =
    isETHAddress(swap.destToken) &&
    (isMultiSwap || isMegaSwap) &&
    !dexNeedWrapNative &&
    !isLastSwap;

  if ((isETHAddress(swap.destToken) && dexNeedWrapNative) || forceUnwrap) {
    destToken =
      forceUnwrap && !dexNeedWrapNative ? destToken : wrappedNativeTokenAddress;
    wethWithdraw = BigInt(swapExchange.destAmount);
  }

  const needToWithdrawAfterSwap =
    destToken === wrappedNativeTokenAddress && wethWithdraw > 0n;

  return {
    srcToken,
    destToken,
    recipient:
      needToWithdrawAfterSwap || !isLastSwap || priceRoute.side === SwapSide.BUY
        ? executionContractAddress
        : augustusV6Address,
    srcAmount,
    destAmount,
    wethDeposit,
    wethWithdraw,
  };
}

export async function buildResolvedWethPlan({
  resolvedLegsWithWeth,
  side,
  routePlan,
  getWethCallData,
  wrappedNativeTokenAddress,
}: {
  resolvedLegsWithWeth: ResolvedLegWithWeth[];
  side: SwapSide;
  routePlan: RoutePlan;
  getWethCallData: WethCallDataProvider;
  wrappedNativeTokenAddress: Address;
}): Promise<{
  resolvedLegs: ResolvedLeg[];
  wethPlan?: DepositWithdrawReturn;
}> {
  const { resolvedLegs, srcAmountWethToDeposit, destAmountWethToWithdraw } =
    resolvedLegsWithWeth.reduce<{
      resolvedLegs: ResolvedLeg[];
      srcAmountWethToDeposit: bigint;
      destAmountWethToWithdraw: bigint;
    }>(
      (acc, resolvedLegWithWeth) => {
        acc.srcAmountWethToDeposit += BigInt(resolvedLegWithWeth.wethDeposit);
        acc.destAmountWethToWithdraw += BigInt(
          resolvedLegWithWeth.wethWithdraw,
        );
        acc.resolvedLegs.push(resolvedLegWithWeth.resolvedLeg);
        return acc;
      },
      {
        resolvedLegs: [],
        srcAmountWethToDeposit: 0n,
        destAmountWethToWithdraw: 0n,
      },
    );

  if (srcAmountWethToDeposit === 0n && destAmountWethToWithdraw === 0n) {
    return { resolvedLegs };
  }

  if (
    srcAmountWethToDeposit === destAmountWethToWithdraw &&
    !hasAnyRouteWithEthAndDifferentNeedWrapNative({
      routePlan,
      resolvedLegs,
      wrappedNativeTokenAddress,
    })
  ) {
    return { resolvedLegs };
  }

  return {
    resolvedLegs,
    wethPlan: await getWethCallData(
      srcAmountWethToDeposit.toString(),
      destAmountWethToWithdraw.toString(),
      side,
    ),
  };
}

export function hasAnyRouteWithEthAndDifferentNeedWrapNative({
  routePlan,
  resolvedLegs,
  wrappedNativeTokenAddress,
}: {
  routePlan: RoutePlan;
  resolvedLegs: ResolvedLeg[];
  wrappedNativeTokenAddress: Address;
}): boolean {
  const eth = ETHER_ADDRESS.toLowerCase();
  const weth = wrappedNativeTokenAddress.toLowerCase();
  const resolvedLegByKey = buildResolvedLegMap(resolvedLegs);

  return !routePlan.routes.every((route, routeIndex) => {
    const swapExchangeParams: DexExchangeBuildParam[] = [];

    route.swaps.forEach((swap, swapIndex) => {
      swap.swapExchanges.forEach((_swapExchange, swapExchangeIndex) => {
        const key = routePositionKey({
          routeIndex,
          swapIndex,
          swapExchangeIndex,
        });
        const curResolvedLeg = resolvedLegByKey.get(key);

        if (!curResolvedLeg) {
          throw new Error(`missing resolved leg for route position ${key}`);
        }

        if (
          swap.destToken.toLowerCase() === weth ||
          swap.destToken.toLowerCase() === eth ||
          swap.srcToken.toLowerCase() === weth ||
          swap.srcToken.toLowerCase() === eth
        ) {
          swapExchangeParams.push(curResolvedLeg.exchangeParam);
        }
      });
    });

    return (
      swapExchangeParams.every(p => p.needWrapNative === true) ||
      swapExchangeParams.every(p => p.needWrapNative === false)
    );
  });
}

export function buildDexExchangeApprovalRequests({
  executorEncodingContext,
  priceRoute,
  routePlan,
  resolvedLegs,
}: {
  executorEncodingContext: ExecutorEncodingContext;
  priceRoute: OptimalRate;
  routePlan: RoutePlan;
  resolvedLegs: ResolvedLeg[];
}): DexExchangeApprovalRequest[] {
  const resolvedLegByKey = buildResolvedLegMap(resolvedLegs);
  const approvalRequests: DexExchangeApprovalRequest[] = [];

  walkRoutePlan(routePlan).forEach(routePosition => {
    const key = routePositionKey(routePosition);
    const curResolvedLeg = resolvedLegByKey.get(key);

    if (!curResolvedLeg) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }

    const swap =
      priceRoute.bestRoute[routePosition.routeIndex].swaps[
        routePosition.swapIndex
      ];
    const curExchangeParam = curResolvedLeg.exchangeParam;
    const approveParams = getApprovalTokenAndTarget(
      swap,
      curExchangeParam,
      executorEncodingContext,
    );

    if (approveParams) {
      approvalRequests.push({
        params: [
          approveParams.token,
          approveParams.target,
          !!curExchangeParam.permit2Approval,
        ],
        routePositionKey: key,
      });
    }
  });

  return approvalRequests;
}

export function applyDexExchangeApprovalDecisions({
  resolvedLegs,
  approvalRequests,
  approvalDecisions,
}: {
  resolvedLegs: ResolvedLeg[];
  approvalRequests: DexExchangeApprovalRequest[];
  approvalDecisions: boolean[];
}): ResolvedLeg[] {
  if (approvalDecisions.length !== approvalRequests.length) {
    throw new Error(
      'approval decision length must match approval request count',
    );
  }

  const resolvedLegByKey = buildResolvedLegMap(resolvedLegs);

  approvalDecisions.forEach((alreadyApproved, index) => {
    if (alreadyApproved) return;

    const [token, target] = approvalRequests[index].params;
    const key = approvalRequests[index].routePositionKey;
    const curResolvedLeg = resolvedLegByKey.get(key);

    if (!curResolvedLeg) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }

    resolvedLegByKey.set(key, {
      ...curResolvedLeg,
      exchangeParam: {
        ...curResolvedLeg.exchangeParam,
        approveData: {
          token: normalizeAddress(token),
          target: normalizeAddress(target),
        },
      },
    });
  });

  return resolvedLegs.map(resolvedLeg => {
    const key = routePositionKey(resolvedLeg);
    const curResolvedLeg = resolvedLegByKey.get(key);

    if (!curResolvedLeg) {
      throw new Error(`missing resolved leg for route position ${key}`);
    }

    return curResolvedLeg;
  });
}

function buildResolvedLegMap(
  resolvedLegs: ResolvedLeg[],
): Map<string, ResolvedLeg> {
  return new Map(
    resolvedLegs.map(resolvedLeg => [
      routePositionKey(resolvedLeg),
      resolvedLeg,
    ]),
  );
}

function normalizeAddress(address: Address): Address {
  return address.toLowerCase();
}
