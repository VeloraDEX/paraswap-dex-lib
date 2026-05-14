import {
  Address,
  DexExchangeBuildParam,
  DexExchangeParam,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
  TxObject,
} from './types';
import { BigNumber } from 'ethers';
import {
  ETHER_ADDRESS,
  FEE_PERCENT_IN_BASIS_POINTS_MASK,
  IS_CAP_SURPLUS_MASK,
  IS_DIRECT_TRANSFER_MASK,
  IS_REFERRAL_MASK,
  IS_SKIP_BLACKLIST_MASK,
  IS_TAKE_SURPLUS_MASK,
  IS_USER_SURPLUS_MASK,
  NULL_ADDRESS,
} from './constants';
import { AbiCoder, Interface } from '@ethersproject/abi';
import joi from 'joi';
import AugustusV6ABI from './abi/augustus-v6/ABI.json';
import { validateAndCast } from './lib/validators';
import { isETHAddress } from './utils';
import {
  DepositWithdrawReturn,
  IWethDepositorWithdrawer,
} from './dex/weth/types';
import { DexAdapterService } from './dex';
import { Weth } from './dex/weth/weth';
import ERC20ABI from './abi/erc20.json';
import { ExecutorDetector } from './executor/ExecutorDetector';
import { ExecutorBytecodeBuilder } from './executor/ExecutorBytecodeBuilder';
import { createExecutorEncodingContextFromDexHelper } from './executor/encoding-context';
import type { ExecutorEncodingContext } from './executor/encoding-types';
import { createExecutorBytecodeBuilder } from './executor/factory';
import { IDexTxBuilder } from './dex/idex';
import {
  ContractMethod,
  ContractMethodV6,
  ParaSwapVersion,
  SwapSide,
} from '@paraswap/core';
import {
  buildDirectTransactionFromResolved,
  buildRoutePlan,
  buildTransactionFromResolved,
  routePositionKey,
  walkRoutePlan,
  type BuildInput,
  type DirectBuildInput,
  type ResolvedBuildOutput,
  type ResolvedDirectCall,
  type ResolvedLeg,
  type RoutePlan,
} from './generic-swap-transaction-builder/resolved';

const REMOTE_DEX_PARAM_TIMEOUT_MS = 10_000;

export type GenericSwapTransactionBuildParams =
  | ResolvedBuildOutput['params']
  | ResolvedDirectCall['params'];

export type ResolvedBuildInputObserver = {
  onGenericBuildInput?: (input: BuildInput) => void;
  onDirectBuildInput?: (input: DirectBuildInput) => void;
};

// `.empty(null)` makes joi treat a JSON `null` as missing (i.e. undefined),
// which is what downstream `value !== undefined` checks expect — see
// docs/specs/get-dex-param.md §3.1 and DEX-PARAM-API.md:123 (returnAmountPos
// may be omitted *or* null on BUY).
const remoteDexExchangeParamSchema = joi
  .object({
    needWrapNative: joi.boolean().required(),
    exchangeData: joi.string().required(),
    targetExchange: joi.string().required(),
    dexFuncHasRecipient: joi.boolean().required(),

    needUnwrapNative: joi.boolean().empty(null),
    skipApproval: joi.boolean().empty(null),
    wethAddress: joi.string().empty(null),
    specialDexFlag: joi.number().integer().min(0).max(255).empty(null),
    transferSrcTokenBeforeSwap: joi.string().empty(null),
    spender: joi.string().empty(null),
    sendEthButSupportsInsertFromAmount: joi.boolean().empty(null),
    specialDexSupportsInsertFromAmount: joi.boolean().empty(null),
    swappedAmountNotPresentInExchangeData: joi.boolean().empty(null),
    returnAmountPos: joi.number().integer().min(0).max(255).empty(null),
    insertFromAmountPos: joi.number().integer().min(0).max(65535).empty(null),
    amountsPacked128: joi.boolean().empty(null),
    permit2Approval: joi.boolean().empty(null),
  })
  .unknown(true);

export function normaliseRemoteDexExchangeParam(
  raw: unknown,
): DexExchangeParam {
  return validateAndCast<DexExchangeParam>(
    raw,
    remoteDexExchangeParamSchema,
    'DexExchangeParam',
  );
}

export type NewDexConfig = { needWrapNative: boolean };
export type NewDexsConfig = { [dexKey: string]: NewDexConfig };
type NewDexEntry = NewDexConfig & { key: string };

interface FeeParams {
  partner: string;
  feePercent: string;
  isTakeSurplus: boolean;
  isCapSurplus: boolean;
  isSurplusToUser: boolean;
  isDirectFeeTransfer: boolean;
  isReferral: boolean;
  isSkipBlacklist: boolean;
}

export class GenericSwapTransactionBuilder {
  augustusV6Interface: Interface;
  augustusV6Address: Address;

  erc20Interface: Interface;

  abiCoder: AbiCoder;

  executorDetector: ExecutorDetector;
  executorEncodingContext?: ExecutorEncodingContext;

  constructor(
    protected dexAdapterService: DexAdapterService,
    protected wExchangeNetworkToKey = Weth.dexKeysWithNetwork.reduce<
      Record<number, string>
    >((prev, current) => {
      for (const network of current.networks) {
        prev[network] = current.key;
      }
      return prev;
    }, {}),
    protected newDexsApiUrl?: string,
    // Held by reference, not snapshotted: callers can mutate this map between
    // `buildCalls` invocations and the next call will see the new state.
    protected newDexs?: NewDexsConfig,
    protected skipApprovalCheck = false, // used only for testing outdated price routes
    protected resolvedBuildInputObserver?: ResolvedBuildInputObserver,
  ) {
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

  protected getDepositWithdrawWethCallData(
    srcAmountWeth: bigint,
    destAmountWeth: bigint,
    side: SwapSide,
    routePlan: RoutePlan,
    resolvedLegs: ResolvedLeg[],
  ) {
    if (srcAmountWeth === 0n && destAmountWeth === 0n) return;

    if (
      srcAmountWeth === destAmountWeth &&
      !this.hasAnyRouteWithEthAndDifferentNeedWrapNative(
        routePlan,
        resolvedLegs,
      )
    )
      return;

    return (
      this.dexAdapterService.getTxBuilderDexByKey(
        this.wExchangeNetworkToKey[this.dexAdapterService.network],
      ) as unknown as IWethDepositorWithdrawer
    ).getDepositWithdrawParam(
      srcAmountWeth.toString(),
      destAmountWeth.toString(),
      side,
      ParaSwapVersion.V6,
    );
  }

  protected findNewDex(exchange: string): NewDexEntry | undefined {
    if (!this.newDexs) return undefined;

    const exchangeKey = exchange.toLowerCase();
    const newDexKey = Object.keys(this.newDexs).find(
      dexKey => dexKey.toLowerCase() === exchangeKey,
    );

    return newDexKey === undefined
      ? undefined
      : { key: newDexKey, ...this.newDexs[newDexKey] };
  }

  protected async buildResolvedCalls(
    priceRoute: OptimalRate,
    routePlan: RoutePlan,
    minMaxAmount: string,
    bytecodeBuilder: ExecutorBytecodeBuilder,
  ): Promise<{
    resolvedLegs: ResolvedLeg[];
    maybeWethCallData?: DepositWithdrawReturn;
  }> {
    const side = priceRoute.side;
    const executorAddress = bytecodeBuilder.getAddress();
    const rawResolvedLegs = await Promise.all(
      walkRoutePlan(routePlan).map(async routePosition => {
        const { routeIndex, swapIndex, swapExchangeIndex } = routePosition;
        const swap = priceRoute.bestRoute[routeIndex].swaps[swapIndex];
        const se = swap.swapExchanges[swapExchangeIndex];
        const newDex = this.findNewDex(se.exchange);

        let dexNeedWrapNative: boolean;
        let dex: IDexTxBuilder<any, any> | undefined;
        if (newDex) {
          dexNeedWrapNative = newDex.needWrapNative;
        } else {
          dex = this.dexAdapterService.getTxBuilderDexByKey(se.exchange);
          dexNeedWrapNative =
            typeof dex.needWrapNative === 'function'
              ? dex.needWrapNative(priceRoute, swap, se)
              : dex.needWrapNative;
        }

        const {
          srcToken,
          destToken,
          srcAmount,
          destAmount,
          recipient,
          wethDeposit,
          wethWithdraw,
        } = this.getDexCallsParams(
          priceRoute,
          routeIndex,
          swap,
          swapIndex,
          se,
          minMaxAmount,
          dexNeedWrapNative,
          executorAddress,
        );

        let dexParams: DexExchangeParam;
        if (newDex) {
          dexParams = await this.fetchRemoteDexParam({
            dexKey: newDex.key,
            srcToken,
            destToken,
            srcAmount: side === SwapSide.BUY ? se.srcAmount : srcAmount,
            destAmount,
            recipient,
            data: se.data,
            side,
            executorAddress,
          });

          // The local `newDexs[*].needWrapNative` is the single source of
          // truth: it already drove `getDexCallsParams` (and therefore
          // `wethDeposit`/`wethWithdraw`). Keep the executor builder in
          // lockstep so the wrap accounting and the bytecode wiring
          // can't diverge.
          dexParams.needWrapNative = newDex.needWrapNative;
        } else {
          dexParams = await dex!.getDexParam!(
            srcToken,
            destToken,
            side === SwapSide.BUY ? se.srcAmount : srcAmount, // in other case we would not be able to make insert from amount on Ex3
            destAmount,
            recipient,
            se.data,
            side,
            executorAddress,
          );
        }

        if (typeof dexParams.needWrapNative === 'function') {
          dexParams.needWrapNative = dexParams.needWrapNative(
            priceRoute,
            swap,
            se,
          );
        }

        if (typeof dexParams.needWrapNative !== 'boolean') {
          throw new Error(
            `Invalid DEX: needWrapNative must resolve to boolean for ${se.exchange}`,
          );
        }

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

    const { resolvedLegs, srcAmountWethToDeposit, destAmountWethToWithdraw } =
      rawResolvedLegs.reduce<{
        resolvedLegs: ResolvedLeg[];
        srcAmountWethToDeposit: bigint;
        destAmountWethToWithdraw: bigint;
      }>(
        (acc, se) => {
          acc.srcAmountWethToDeposit += BigInt(se.wethDeposit);
          acc.destAmountWethToWithdraw += BigInt(se.wethWithdraw);
          acc.resolvedLegs.push(se.resolvedLeg);
          return acc;
        },
        {
          resolvedLegs: [],
          srcAmountWethToDeposit: 0n,
          destAmountWethToWithdraw: 0n,
        },
      );

    const maybeWethCallData = this.normalizeWethPlan(
      this.getDepositWithdrawWethCallData(
        srcAmountWethToDeposit,
        destAmountWethToWithdraw,
        side,
        routePlan,
        resolvedLegs,
      ),
    );

    const resolvedLegsWithApprovals = await this.addDexExchangeApproveParams(
      bytecodeBuilder,
      priceRoute,
      routePlan,
      resolvedLegs,
      maybeWethCallData,
    );

    return {
      resolvedLegs: resolvedLegsWithApprovals,
      maybeWethCallData,
    };
  }

  protected async fetchRemoteDexParam(args: {
    dexKey: string;
    srcToken: Address;
    destToken: Address;
    srcAmount: string;
    destAmount: string;
    recipient: Address;
    data: any;
    side: SwapSide;
    executorAddress: Address;
  }): Promise<DexExchangeParam> {
    if (!this.newDexsApiUrl) {
      throw new Error(
        `[GenericSwapTransactionBuilder] new-dex API URL not configured; cannot encode swap for ${args.dexKey}`,
      );
    }

    const chainId = this.dexAdapterService.network;
    const base = this.newDexsApiUrl.replace(/\/+$/, '');
    const url = `${base}/api/v1/dexs/${chainId}/${encodeURIComponent(
      args.dexKey,
    )}/dex-param`;

    const body = {
      srcToken: args.srcToken,
      destToken: args.destToken,
      srcAmount: args.srcAmount,
      destAmount: args.destAmount,
      recipient: args.recipient,
      executorAddress: args.executorAddress,
      side: args.side,
      data: args.data,
    };

    const raw =
      await this.dexAdapterService.dexHelper.httpRequest.post<unknown>(
        url,
        body,
        REMOTE_DEX_PARAM_TIMEOUT_MS,
      );

    return normaliseRemoteDexExchangeParam(raw);
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
    const bytecodeBuilder = createExecutorBytecodeBuilder(
      executorName,
      executorEncodingContext,
    );
    const executionContractAddress = bytecodeBuilder.getAddress();
    const routePlan = buildRoutePlan(priceRoute);
    const { resolvedLegs, maybeWethCallData } = await this.buildResolvedCalls(
      priceRoute,
      routePlan,
      minMaxAmount,
      bytecodeBuilder,
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
      bytecodeBuilder,
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

    const partnerAndFee = this.buildFeesV6({
      referrerAddress,
      partnerAddress,
      partnerFeePercent,
      takeSurplus,
      isCapSurplus,
      isSurplusToUser,
      isDirectFeeTransfer,
      priceRoute,
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

  private buildFeesV6({
    referrerAddress,
    priceRoute,
    takeSurplus,
    isCapSurplus,
    isSurplusToUser,
    isDirectFeeTransfer,
    partnerAddress,
    partnerFeePercent,
    skipBlacklist = false,
  }: {
    referrerAddress?: Address;
    partnerAddress: Address;
    partnerFeePercent: string;
    takeSurplus: boolean;
    isCapSurplus: boolean;
    isSurplusToUser: boolean;
    isDirectFeeTransfer: boolean;
    priceRoute: OptimalRate;
    skipBlacklist?: boolean;
  }) {
    const partnerAndFee = referrerAddress
      ? this.packPartnerAndFeeData({
          partner: referrerAddress,
          feePercent: '0',
          isTakeSurplus: takeSurplus,
          isCapSurplus,
          isSurplusToUser,
          isDirectFeeTransfer,
          isReferral: true,
          isSkipBlacklist: skipBlacklist,
        })
      : this.packPartnerAndFeeData({
          partner: partnerAddress,
          feePercent: partnerFeePercent,
          isTakeSurplus: takeSurplus,
          isCapSurplus,
          isSurplusToUser,
          isDirectFeeTransfer,
          isSkipBlacklist: skipBlacklist,
          isReferral: false,
        });

    return partnerAndFee;
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
    // if quotedAmount wasn't passed, use the amount from the route
    const _quotedAmount = quotedAmount
      ? quotedAmount
      : priceRoute.side === SwapSide.SELL
      ? priceRoute.destAmount
      : priceRoute.srcAmount;

    // if beneficiary is not defined, then in smart contract it will be replaced to msg.sender
    const _beneficiary =
      beneficiary !== NULL_ADDRESS &&
      beneficiary.toLowerCase() !== userAddress.toLowerCase()
        ? beneficiary
        : NULL_ADDRESS;

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
        permit || '0x',
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
      permit || '0x',
      uuid,
      {
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
      },
    );

    return onlyParams ? resolvedOutput.params : resolvedOutput.txObject;
  }

  private packPartnerAndFeeData({
    partner,
    feePercent,
    isTakeSurplus,
    isCapSurplus,
    isSurplusToUser,
    isDirectFeeTransfer,
    isReferral,
    isSkipBlacklist,
  }: FeeParams): string {
    const partnerAddress =
      feePercent === '0' && !isTakeSurplus && !isReferral
        ? NULL_ADDRESS
        : partner;

    // Partner address shifted left to make room for flags and fee percent
    const partialFeeCodeWithPartnerAddress =
      BigNumber.from(partnerAddress).shl(96);
    let partialFeeCodeWithBitFlags = BigNumber.from(0); // default 0 is safe if none the conditions pass

    const isFixedFees = !BigNumber.from(feePercent).isZero();

    if (isFixedFees) {
      // Ensure feePercent fits within the FEE_PERCENT_IN_BASIS_POINTS_MASK range
      partialFeeCodeWithBitFlags = BigNumber.from(feePercent).and(
        FEE_PERCENT_IN_BASIS_POINTS_MASK,
      );

      // Apply flags using bitwise OR with the appropriate masks
    } else {
      if (isTakeSurplus) {
        partialFeeCodeWithBitFlags =
          partialFeeCodeWithBitFlags.or(IS_TAKE_SURPLUS_MASK);
      } else if (isReferral) {
        partialFeeCodeWithBitFlags =
          partialFeeCodeWithBitFlags.or(IS_REFERRAL_MASK);
      }
    }

    if (isSkipBlacklist) {
      partialFeeCodeWithBitFlags = partialFeeCodeWithBitFlags.or(
        IS_SKIP_BLACKLIST_MASK,
      );
    }

    if (isCapSurplus) {
      partialFeeCodeWithBitFlags =
        partialFeeCodeWithBitFlags.or(IS_CAP_SURPLUS_MASK);
    }

    if (isSurplusToUser) {
      partialFeeCodeWithBitFlags =
        partialFeeCodeWithBitFlags.or(IS_USER_SURPLUS_MASK);
    }

    if (isDirectFeeTransfer) {
      partialFeeCodeWithBitFlags = partialFeeCodeWithBitFlags.or(
        IS_DIRECT_TRANSFER_MASK,
      );
    }
    // Combine partnerBigInt and feePercentBigInt
    const feeCode = partialFeeCodeWithPartnerAddress.or(
      partialFeeCodeWithBitFlags,
    );

    return feeCode.toString();
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
    const wethAddress =
      this.dexAdapterService.dexHelper.config.data.wrappedNativeTokenAddress;

    const side = priceRoute.side;

    const isMegaSwap = priceRoute.bestRoute.length > 1;
    const isMultiSwap = !isMegaSwap && priceRoute.bestRoute[0].swaps.length > 1;

    const isLastSwap =
      swapIndex === priceRoute.bestRoute[routeIndex].swaps.length - 1;

    let _src = swap.srcToken;
    let wethDeposit = 0n;
    let _dest = swap.destToken;

    let wethWithdraw = 0n;

    // For case of buy apply slippage is applied to srcAmount in equal proportion as the complete swap
    // This assumes that the sum of all swaps srcAmount would sum to priceRoute.srcAmount
    // Also that it is a direct swap.
    const _srcAmount =
      swapIndex > 0 || side === SwapSide.SELL
        ? se.srcAmount
        : (
            (BigInt(se.srcAmount) * BigInt(minMaxAmount)) /
            BigInt(priceRoute.srcAmount)
          ).toString();

    // In case of sell the destAmount is set to minimum (1) as
    // even if the individual dex is rekt by slippage the swap
    // should work if the final slippage check passes.
    const _destAmount = side === SwapSide.SELL ? '1' : se.destAmount;

    if (isETHAddress(swap.srcToken) && dexNeedWrapNative) {
      _src = wethAddress;
      wethDeposit = BigInt(_srcAmount);
    }

    const forceUnwrap =
      isETHAddress(swap.destToken) &&
      (isMultiSwap || isMegaSwap) &&
      !dexNeedWrapNative &&
      !isLastSwap;

    if ((isETHAddress(swap.destToken) && dexNeedWrapNative) || forceUnwrap) {
      _dest = forceUnwrap && !dexNeedWrapNative ? _dest : wethAddress;
      wethWithdraw = BigInt(se.destAmount);
    }

    const needToWithdrawAfterSwap = _dest === wethAddress && wethWithdraw;

    return {
      srcToken: _src,
      destToken: _dest,
      recipient:
        needToWithdrawAfterSwap ||
        !isLastSwap ||
        priceRoute.side === SwapSide.BUY
          ? executionContractAddress
          : this.dexAdapterService.dexHelper.config.data.augustusV6Address!,
      srcAmount: _srcAmount,
      destAmount: _destAmount,
      wethDeposit,
      wethWithdraw,
    };
  }

  private async addDexExchangeApproveParams(
    bytecodeBuilder: ExecutorBytecodeBuilder,
    priceRoute: OptimalRate,
    routePlan: RoutePlan,
    resolvedLegs: ResolvedLeg[],
    maybeWethCallData?: DepositWithdrawReturn,
  ): Promise<ResolvedLeg[]> {
    const spender = bytecodeBuilder.getAddress();
    const tokenTargetMapping: {
      params: [token: Address, target: Address, permit2: boolean];
      routePositionKey: string;
    }[] = [];
    const resolvedLegByKey = this.buildResolvedLegMap(resolvedLegs);

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
      const approveParams = bytecodeBuilder.getApprovalTokenAndTarget(
        swap,
        curExchangeParam,
      );

      if (approveParams) {
        tokenTargetMapping.push({
          params: [
            approveParams.token,
            approveParams.target,
            !!curExchangeParam.permit2Approval,
          ],
          routePositionKey: key,
        });
      }
    });

    const approvals = this.skipApprovalCheck // used only for testing outdated price routes
      ? tokenTargetMapping.map(t => false)
      : await this.dexAdapterService.dexHelper.augustusApprovals.hasApprovals(
          spender,
          tokenTargetMapping.map(t => t.params),
        );

    approvals.forEach((alreadyApproved, index) => {
      if (!alreadyApproved) {
        const [token, target] = tokenTargetMapping[index].params;
        const key = tokenTargetMapping[index].routePositionKey;
        const curResolvedLeg = resolvedLegByKey.get(key);

        if (!curResolvedLeg) {
          throw new Error(`missing resolved leg for route position ${key}`);
        }

        resolvedLegByKey.set(key, {
          ...curResolvedLeg,
          exchangeParam: {
            ...curResolvedLeg.exchangeParam,
            approveData: {
              token: this.normalizeAddress(token),
              target: this.normalizeAddress(target),
            },
          },
        });
      }
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

  private hasAnyRouteWithEthAndDifferentNeedWrapNative(
    routePlan: RoutePlan,
    resolvedLegs: ResolvedLeg[],
  ) {
    const eth = ETHER_ADDRESS.toLowerCase();
    const weth =
      this.dexAdapterService.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    const resolvedLegByKey = this.buildResolvedLegMap(resolvedLegs);

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

  private buildResolvedLegMap(
    resolvedLegs: ResolvedLeg[],
  ): Map<string, ResolvedLeg> {
    return new Map(
      resolvedLegs.map(resolvedLeg => [
        routePositionKey(resolvedLeg),
        resolvedLeg,
      ]),
    );
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
