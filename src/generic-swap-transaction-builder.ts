import {
  Address,
  DexExchangeBuildParam,
  DexExchangeParam,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
  TxObject,
} from './types';
import { NULL_ADDRESS } from './constants';
import { AbiCoder, Interface } from '@ethersproject/abi';
import AugustusV6ABI from './abi/augustus-v6/ABI.json';
import {
  DepositWithdrawReturn,
  IWethDepositorWithdrawer,
} from './dex/weth/types';
import { DexAdapterService } from './dex';
import ERC20ABI from './abi/erc20.json';
import { ExecutorDetector } from './executor/ExecutorDetector';
import { createExecutorEncodingContextFromDexHelper } from './executor/encoding-context';
import type { ExecutorEncodingContext } from './executor/encoding-types';
import {
  ContractMethod,
  ContractMethodV6,
  ParaSwapVersion,
  SwapSide,
} from '@paraswap/core';
import {
  buildDirectTransactionFromResolved,
  buildFeesV6,
  buildRoutePlan,
  buildTransactionFromResolved,
  type BuildInput,
  type DirectBuildInput,
  type ResolvedBuildOutput,
  type ResolvedDirectCall,
  type ResolvedLeg,
  type RoutePlan,
  walkRoutePlan,
} from './generic-swap-transaction-builder/resolved';
import {
  applyDexExchangeApprovalDecisions,
  buildDexExchangeApprovalRequests,
  buildGenericDexCallParams,
  buildResolvedWethPlan,
  resolveBeneficiary,
  resolvePermit,
  resolveQuotedAmount,
} from './generic-swap-transaction-builder/orchestration';
import {
  createTsDexEncoderRegistry,
  createWethCallDataProvider,
  type DexEncoderRegistryPort,
  type DexEncoderSwapExchangeData,
  type DexParamInput,
  type NeedWrapNativeInput,
  type WethDepositWithdrawResult,
  type WethCallDataProviderPort,
} from './generic-swap-transaction-builder/dex-encoder';

export type GenericSwapTransactionBuildParams =
  | ResolvedBuildOutput['params']
  | ResolvedDirectCall['params'];

export type ResolvedBuildInputObserver = {
  onGenericBuildInput?: (input: BuildInput) => void;
  onDirectBuildInput?: (input: DirectBuildInput) => void;
};

export type GenericSwapTransactionBuilderOptions = {
  dexEncoderRegistry?: DexEncoderRegistryPort;
  skipApprovalCheck?: boolean;
  resolvedBuildInputObserver?: ResolvedBuildInputObserver;
  wethCallDataProvider?: WethCallDataProviderPort;
  /**
   * @deprecated Use `wethCallDataProvider`. Kept so existing callers with a
   * custom WETH DEX-key mapping continue to route through their configured WETH
   * builder until they migrate to the provider port.
   */
  wExchangeNetworkToKey?: Readonly<Record<number, string>>;
};

export class GenericSwapTransactionBuilder {
  augustusV6Interface: Interface;
  augustusV6Address: Address;

  erc20Interface: Interface;

  abiCoder: AbiCoder;

  executorDetector: ExecutorDetector;
  executorEncodingContext?: ExecutorEncodingContext;
  protected readonly dexEncoderRegistry: DexEncoderRegistryPort;
  protected skipApprovalCheck: boolean;
  protected resolvedBuildInputObserver?: ResolvedBuildInputObserver;
  protected wethCallDataProvider?: WethCallDataProviderPort;

  constructor(
    protected dexAdapterService: DexAdapterService,
    options: GenericSwapTransactionBuilderOptions = {},
  ) {
    // Used only for testing outdated price routes.
    this.skipApprovalCheck = options.skipApprovalCheck ?? false;
    this.resolvedBuildInputObserver = options.resolvedBuildInputObserver;
    this.dexEncoderRegistry =
      options.dexEncoderRegistry ??
      createTsDexEncoderRegistry(this.dexAdapterService);
    this.wethCallDataProvider =
      options.wethCallDataProvider ??
      (options.wExchangeNetworkToKey
        ? createLegacyWethCallDataProvider(
            this.dexAdapterService,
            options.wExchangeNetworkToKey,
          )
        : undefined);
    this.abiCoder = new AbiCoder();
    this.erc20Interface = new Interface(ERC20ABI);
    this.augustusV6Interface = new Interface(AugustusV6ABI);
    this.augustusV6Address =
      this.dexAdapterService.dexHelper.config.data.augustusV6Address!;
    this.executorDetector = new ExecutorDetector();
  }

  private ensureExecutorEncodingContext(): ExecutorEncodingContext {
    if (!this.executorEncodingContext) {
      this.executorEncodingContext = createExecutorEncodingContextFromDexHelper(
        this.dexAdapterService.dexHelper,
      );
    }

    return this.executorEncodingContext;
  }

  private ensureWethCallDataProvider(
    context: ExecutorEncodingContext,
  ): WethCallDataProviderPort {
    if (!this.wethCallDataProvider) {
      this.wethCallDataProvider = createWethCallDataProvider(context);
    }

    return this.wethCallDataProvider;
  }

  protected async buildResolvedCalls(
    priceRoute: OptimalRate,
    routePlan: RoutePlan,
    minMaxAmount: string,
    executorAddress: Address,
    executorEncodingContext: ExecutorEncodingContext,
  ): Promise<{
    resolvedLegs: ResolvedLeg[];
    maybeWethCallData?: DepositWithdrawReturn;
  }> {
    const side = priceRoute.side;
    const rawResolvedLegs = await Promise.all(
      walkRoutePlan(routePlan).map(async routePosition => {
        const { routeIndex, swapIndex, swapExchangeIndex } = routePosition;
        const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
        const se = swap.swapExchanges[swapExchangeIndex];
        const dexEncoder = await this.dexEncoderRegistry.getDexEncoder({
          network: priceRoute.network,
          dexKey: se.exchange,
        });
        const needWrapNativeInput = this.buildNeedWrapNativeInput({
          priceRoute,
          routeIndex,
          swap,
          swapIndex,
          swapExchange: se,
          swapExchangeIndex,
        });
        const dexNeedWrapNative = await dexEncoder.needWrapNative(
          needWrapNativeInput,
        );

        const {
          srcToken,
          destToken,
          srcAmount,
          destAmount,
          recipient,
          wethDeposit,
          wethWithdraw,
        } = buildGenericDexCallParams({
          priceRoute,
          routeIndex,
          swap,
          swapIndex,
          swapExchange: se,
          minMaxAmount,
          dexNeedWrapNative,
          executionContractAddress: executorAddress,
          wrappedNativeTokenAddress:
            this.dexAdapterService.dexHelper.config.data
              .wrappedNativeTokenAddress,
          augustusV6Address: this.augustusV6Address,
        });

        const dexParamInput: DexParamInput = {
          ...needWrapNativeInput,
          dexKey: se.exchange,
          srcToken: this.normalizeAddress(srcToken),
          destToken: this.normalizeAddress(destToken),
          srcAmount: side === SwapSide.BUY ? se.srcAmount : srcAmount, // in other case we would not be able to make insert from amount on Ex3
          side,
          destAmount,
          recipient: this.normalizeAddress(recipient),
          executorAddress: this.normalizeAddress(executorAddress),
          data: se.data as DexEncoderSwapExchangeData,
        };
        const dexParams: DexExchangeParam = await dexEncoder.getDexParam(
          dexParamInput,
        );

        return {
          resolvedLeg: {
            routeIndex,
            swapIndex,
            swapExchangeIndex,
            exchangeParam: this.normalizeDexExchangeBuildParam(
              dexParams as DexExchangeBuildParam,
            ),
            normalizedSrcToken: this.normalizeAddress(srcToken),
            normalizedDestToken: this.normalizeAddress(destToken),
            normalizedSrcAmount: srcAmount,
            normalizedDestAmount: destAmount,
            recipient: this.normalizeAddress(recipient),
          },
          wethDeposit,
          wethWithdraw,
        };
      }),
    );

    const wethCallDataProvider = this.ensureWethCallDataProvider(
      executorEncodingContext,
    );
    const { resolvedLegs, wethPlan } = await buildResolvedWethPlan({
      resolvedLegsWithWeth: rawResolvedLegs,
      side,
      routePlan,
      wrappedNativeTokenAddress:
        executorEncodingContext.wrappedNativeTokenAddress,
      getWethCallData: (srcAmountWeth, destAmountWeth, wethSide) =>
        wethCallDataProvider.getDepositWithdrawCallData({
          srcAmountWeth,
          destAmountWeth,
          side: wethSide,
        }),
    });

    const maybeWethCallData = this.normalizeWethPlan(wethPlan);

    const resolvedLegsWithApprovals = await this.addDexExchangeApproveParams(
      executorEncodingContext,
      executorAddress,
      priceRoute,
      routePlan,
      resolvedLegs,
    );

    return {
      resolvedLegs: resolvedLegsWithApprovals,
      maybeWethCallData,
    };
  }

  private buildNeedWrapNativeInput({
    priceRoute,
    routeIndex,
    swap,
    swapIndex,
    swapExchange,
    swapExchangeIndex,
  }: {
    priceRoute: OptimalRate;
    routeIndex: number;
    swap: OptimalSwap;
    swapIndex: number;
    swapExchange: OptimalSwapExchange<unknown>;
    swapExchangeIndex: number;
  }): NeedWrapNativeInput {
    const route = priceRoute.bestRoute[routeIndex];

    return {
      route: {
        network: priceRoute.network,
        side: priceRoute.side,
        routeIndex,
        routePercent: route.percent,
        blockNumber: priceRoute.blockNumber,
        srcToken: this.normalizeAddress(priceRoute.srcToken),
        destToken: this.normalizeAddress(priceRoute.destToken),
        srcAmount: priceRoute.srcAmount,
        destAmount: priceRoute.destAmount,
      },
      swap: {
        swapIndex,
        srcToken: this.normalizeAddress(swap.srcToken),
        destToken: this.normalizeAddress(swap.destToken),
        srcAmount: sumSwapExchangeAmounts(swap.swapExchanges, 'srcAmount'),
        destAmount: sumSwapExchangeAmounts(swap.swapExchanges, 'destAmount'),
      },
      swapExchange: {
        swapExchangeIndex,
        exchange: swapExchange.exchange,
        srcAmount: swapExchange.srcAmount,
        destAmount: swapExchange.destAmount,
        percent: swapExchange.percent,
        data: swapExchange.data as DexEncoderSwapExchangeData,
      },
    };
  }

  protected async _build(
    priceRoute: OptimalRate,
    minMaxAmount: string,
    quotedAmount: string,
    userAddress: Address,
    referrerAddress: Address | undefined,
    partnerAddress: Address,
    partnerFeePercent: string,
    takeSurplus: boolean,
    isCapSurplus: boolean,
    isSurplusToUser: boolean,
    isDirectFeeTransfer: boolean,
    beneficiary: Address,
    permit: string,
    uuid: string,
    gas?: {
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
    },
  ): Promise<ResolvedBuildOutput> {
    const executorName =
      this.executorDetector.getExecutorByPriceRoute(priceRoute);
    const executorEncodingContext = this.ensureExecutorEncodingContext();
    const executionContractAddress =
      executorEncodingContext.executorsAddresses[executorName];
    const routePlan = buildRoutePlan(priceRoute);
    const { resolvedLegs, maybeWethCallData } = await this.buildResolvedCalls(
      priceRoute,
      routePlan,
      minMaxAmount,
      executionContractAddress,
      executorEncodingContext,
    );

    const buildInput: BuildInput = {
      routePlan,
      resolvedLegs,
      wethPlan: maybeWethCallData,
      executorType: executorName,
      executorAddress: this.normalizeAddress(executionContractAddress),
      augustusV6Address: this.normalizeAddress(this.augustusV6Address),
      wrappedNativeTokenAddress: this.normalizeAddress(
        this.dexAdapterService.dexHelper.config.data.wrappedNativeTokenAddress,
      ),
      network: this.dexAdapterService.network,
      srcToken: this.normalizeAddress(priceRoute.srcToken),
      destToken: this.normalizeAddress(priceRoute.destToken),
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      minMaxAmount,
      quotedAmount,
      side: priceRoute.side,
      contractMethod: priceRoute.contractMethod as ContractMethodV6,
      blockNumber: priceRoute.blockNumber,
      userAddress: this.normalizeAddress(userAddress),
      beneficiary: this.normalizeAddress(beneficiary),
      permit,
      uuid,
      fee: {
        partnerAddress: this.normalizeAddress(partnerAddress),
        partnerFeePercent,
        referrerAddress:
          referrerAddress === undefined
            ? undefined
            : this.normalizeAddress(referrerAddress),
        takeSurplus,
        isCapSurplus,
        isSurplusToUser,
        isDirectFeeTransfer,
      },
      gas,
    };

    this.resolvedBuildInputObserver?.onGenericBuildInput?.(buildInput);

    return buildTransactionFromResolved(buildInput, {
      encodingContext: executorEncodingContext,
      augustusV6Interface: this.augustusV6Interface,
    });
  }

  // TODO: Improve
  protected async _buildDirect(
    priceRoute: OptimalRate,
    minMaxAmount: string,
    quotedAmount: string,
    referrerAddress: Address | undefined,
    partnerAddress: Address,
    partnerFeePercent: string,
    takeSurplus: boolean,
    isCapSurplus: boolean,
    isSurplusToUser: boolean,
    isDirectFeeTransfer: boolean,
    permit: string,
    uuid: string,
    beneficiary: Address,
  ): Promise<ResolvedDirectCall> {
    const isRfqTryBatchFill =
      priceRoute.contractMethod ===
      ContractMethod.swapOnAugustusRFQTryBatchFill;

    if (
      priceRoute.bestRoute.length !== 1 ||
      priceRoute.bestRoute[0].percent !== 100 ||
      priceRoute.bestRoute[0].swaps.length !== 1 ||
      (!isRfqTryBatchFill &&
        priceRoute.bestRoute[0].swaps[0].swapExchanges.length !== 1) ||
      (!isRfqTryBatchFill &&
        priceRoute.bestRoute[0].swaps[0].swapExchanges[0].percent !== 100)
    )
      throw new Error(`DirectSwap invalid bestRoute`);

    const dexName = priceRoute.bestRoute[0].swaps[0].swapExchanges[0].exchange;
    if (!dexName) throw new Error(`Invalid dex name`);

    const dex = this.dexAdapterService.getTxBuilderDexByKey(dexName);
    if (!dex) throw new Error(`Failed to find dex : ${dexName}`);

    if (!dex.getDirectParamV6)
      throw new Error(
        `Invalid DEX: dex should have getDirectParamV6: ${dexName}`,
      );

    const swapExchange = priceRoute.bestRoute[0].swaps[0].swapExchanges[0];

    const srcAmount =
      priceRoute.side === SwapSide.SELL ? swapExchange.srcAmount : minMaxAmount;
    const destAmount =
      priceRoute.side === SwapSide.SELL
        ? minMaxAmount
        : swapExchange.destAmount;

    const partnerAndFee = buildFeesV6({
      referrerAddress,
      partnerAddress,
      partnerFeePercent,
      takeSurplus,
      isCapSurplus,
      isSurplusToUser,
      isDirectFeeTransfer,
    });

    const directTxInfo = dex.getDirectParamV6!(
      priceRoute.srcToken,
      priceRoute.destToken,
      srcAmount,
      destAmount,
      quotedAmount,
      swapExchange.data,
      priceRoute.side,
      permit,
      uuid,
      partnerAndFee,
      beneficiary,
      priceRoute.blockNumber,
      priceRoute.contractMethod,
    );

    return {
      contractMethod: priceRoute.contractMethod as ContractMethodV6,
      params: directTxInfo.params,
    };
  }

  public async build({
    priceRoute,
    minMaxAmount,
    quotedAmount,
    userAddress,
    referrerAddress,
    partnerAddress,
    partnerFeePercent,
    takeSurplus,
    isCapSurplus,
    isSurplusToUser,
    isDirectFeeTransfer,
    gasPrice,
    maxFeePerGas,
    maxPriorityFeePerGas,
    permit,
    uuid,
    beneficiary = NULL_ADDRESS,
    onlyParams = false,
  }: {
    priceRoute: OptimalRate;
    minMaxAmount: string;
    quotedAmount?: string;
    userAddress: Address;
    referrerAddress?: Address;
    partnerAddress: Address;
    partnerFeePercent: string;
    takeSurplus?: boolean;
    isCapSurplus?: boolean;
    isSurplusToUser?: boolean;
    isDirectFeeTransfer?: boolean;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    permit?: string;
    deadline: string;
    uuid: string;
    beneficiary?: Address;
    onlyParams?: boolean;
  }): Promise<TxObject | GenericSwapTransactionBuildParams> {
    const _quotedAmount = resolveQuotedAmount(priceRoute, quotedAmount);
    const _beneficiary = resolveBeneficiary(userAddress, beneficiary);
    const _permit = resolvePermit(permit);

    if (
      this.dexAdapterService.isDirectFunctionNameV6(priceRoute.contractMethod)
    ) {
      const directCall = await this._buildDirect(
        priceRoute,
        minMaxAmount,
        _quotedAmount,
        referrerAddress,
        partnerAddress,
        partnerFeePercent,
        takeSurplus ?? false,
        isCapSurplus ?? true,
        isSurplusToUser ?? false,
        isDirectFeeTransfer ?? false,
        _permit,
        uuid,
        _beneficiary,
      );

      const directBuildInput: DirectBuildInput = {
        ...directCall,
        userAddress: this.normalizeAddress(userAddress),
        augustusV6Address: this.normalizeAddress(this.augustusV6Address),
        srcToken: this.normalizeAddress(priceRoute.srcToken),
        srcAmount: priceRoute.srcAmount,
        minMaxAmount,
        side: priceRoute.side,
        gas: {
          gasPrice,
          maxFeePerGas,
          maxPriorityFeePerGas,
        },
      };

      this.resolvedBuildInputObserver?.onDirectBuildInput?.(directBuildInput);

      const resolvedDirectOutput = buildDirectTransactionFromResolved(
        directBuildInput,
        {
          augustusV6Interface: this.augustusV6Interface,
        },
      );

      return onlyParams
        ? resolvedDirectOutput.params
        : resolvedDirectOutput.txObject;
    }

    const resolvedOutput = await this._build(
      priceRoute,
      minMaxAmount,
      _quotedAmount,
      userAddress,
      referrerAddress,
      partnerAddress,
      partnerFeePercent,
      takeSurplus ?? false,
      isCapSurplus ?? true,
      isSurplusToUser ?? false,
      isDirectFeeTransfer ?? false,
      _beneficiary,
      _permit,
      uuid,
      {
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
      },
    );

    return onlyParams ? resolvedOutput.params : resolvedOutput.txObject;
  }

  public getExecutionContractAddress(priceRoute: OptimalRate): Address {
    const isDirectMethod = this.dexAdapterService.isDirectFunctionNameV6(
      priceRoute.contractMethod,
    );
    if (isDirectMethod) return this.augustusV6Address;

    const executorName =
      this.executorDetector.getExecutorByPriceRoute(priceRoute);
    const executorEncodingContext = this.ensureExecutorEncodingContext();

    return executorEncodingContext.executorsAddresses[executorName];
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
    return buildGenericDexCallParams({
      priceRoute,
      routeIndex,
      swap,
      swapIndex,
      swapExchange: se,
      minMaxAmount,
      dexNeedWrapNative,
      executionContractAddress,
      wrappedNativeTokenAddress:
        this.dexAdapterService.dexHelper.config.data.wrappedNativeTokenAddress,
      augustusV6Address: this.augustusV6Address,
    });
  }

  private async addDexExchangeApproveParams(
    executorEncodingContext: ExecutorEncodingContext,
    spender: Address,
    priceRoute: OptimalRate,
    routePlan: RoutePlan,
    resolvedLegs: ResolvedLeg[],
  ): Promise<ResolvedLeg[]> {
    const approvalRequests = buildDexExchangeApprovalRequests({
      executorEncodingContext,
      priceRoute,
      routePlan,
      resolvedLegs,
    });

    const approvals = this.skipApprovalCheck // used only for testing outdated price routes
      ? approvalRequests.map(() => false)
      : await this.dexAdapterService.dexHelper.augustusApprovals.hasApprovals(
          spender,
          approvalRequests.map(t => t.params),
        );

    return applyDexExchangeApprovalDecisions({
      resolvedLegs,
      approvalRequests,
      approvalDecisions: approvals,
    });
  }

  private normalizeDexExchangeBuildParam(
    exchangeParam: DexExchangeBuildParam,
  ): DexExchangeBuildParam {
    return {
      ...exchangeParam,
      targetExchange: this.normalizeAddress(exchangeParam.targetExchange),
      wethAddress:
        exchangeParam.wethAddress === undefined
          ? undefined
          : this.normalizeAddress(exchangeParam.wethAddress),
      transferSrcTokenBeforeSwap:
        exchangeParam.transferSrcTokenBeforeSwap === undefined
          ? undefined
          : this.normalizeAddress(exchangeParam.transferSrcTokenBeforeSwap),
      spender:
        exchangeParam.spender === undefined
          ? undefined
          : this.normalizeAddress(exchangeParam.spender),
      approveData:
        exchangeParam.approveData === undefined
          ? undefined
          : {
              token: this.normalizeAddress(exchangeParam.approveData.token),
              target: this.normalizeAddress(exchangeParam.approveData.target),
            },
    };
  }

  private normalizeWethPlan(
    wethPlan?: DepositWithdrawReturn,
  ): DepositWithdrawReturn | undefined {
    if (!wethPlan) return undefined;

    return {
      deposit:
        wethPlan.deposit === undefined
          ? undefined
          : {
              ...wethPlan.deposit,
              callee: this.normalizeAddress(wethPlan.deposit.callee),
            },
      withdraw:
        wethPlan.withdraw === undefined
          ? undefined
          : {
              ...wethPlan.withdraw,
              callee: this.normalizeAddress(wethPlan.withdraw.callee),
            },
    };
  }

  private normalizeAddress(address: Address): Address {
    return address.toLowerCase();
  }
}

function sumSwapExchangeAmounts(
  swapExchanges: OptimalSwapExchange<unknown>[],
  field: 'srcAmount' | 'destAmount',
): string {
  return swapExchanges
    .reduce((total, swapExchange) => total + BigInt(swapExchange[field]), 0n)
    .toString();
}

function createLegacyWethCallDataProvider(
  dexAdapterService: DexAdapterService,
  wExchangeNetworkToKey: Readonly<Record<number, string>>,
): WethCallDataProviderPort {
  return {
    getDepositWithdrawCallData({ srcAmountWeth, destAmountWeth, side }) {
      const dexKey = wExchangeNetworkToKey[dexAdapterService.network];
      if (!dexKey) {
        throw new Error(
          `Missing WETH exchange mapping for network ${dexAdapterService.network}`,
        );
      }

      return normalizeLegacyWethResult(
        (
          dexAdapterService.getTxBuilderDexByKey(
            dexKey,
          ) as unknown as IWethDepositorWithdrawer
        ).getDepositWithdrawParam(
          srcAmountWeth,
          destAmountWeth,
          side,
          ParaSwapVersion.V6,
        ),
      );
    },
  };
}

function normalizeLegacyWethResult(
  result?: DepositWithdrawReturn,
): WethDepositWithdrawResult | undefined {
  if (!result) return undefined;

  return {
    deposit:
      result.deposit === undefined
        ? undefined
        : {
            ...result.deposit,
            calldata: result.deposit.calldata as `0x${string}`,
          },
    withdraw:
      result.withdraw === undefined
        ? undefined
        : {
            ...result.withdraw,
            calldata: result.withdraw.calldata as `0x${string}`,
          },
  };
}
