import {
  Address,
  DexExchangeBuildParam,
  DexExchangeParam,
  DexExchangeParamWithBooleanNeedWrapNative,
  GetDexParamOptions,
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
  TxObject,
} from './types';
import { BigNumber, ethers } from 'ethers';
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
import { isETHAddress, uuidToBytes16 } from './utils';
import {
  DepositWithdrawReturn,
  IWethDepositorWithdrawer,
} from './dex/weth/types';
import { DexAdapterService } from './dex';
import { Weth } from './dex/weth/weth';
import ERC20ABI from './abi/erc20.json';
import { ExecutorDetector } from './executor/ExecutorDetector';
import { ExecutorBytecodeBuilder } from './executor/ExecutorBytecodeBuilder';
import { Executors } from './executor/types';
import { IDexTxBuilder } from './dex/idex';
import {
  ContractMethod,
  ContractMethodV6,
  ParaSwapVersion,
  SwapSide,
} from '@paraswap/core';

const {
  utils: { hexlify, hexConcat, hexZeroPad },
} = ethers;

const REMOTE_DEX_PARAM_TIMEOUT_MS = 10_000;

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
  ) {
    this.abiCoder = new AbiCoder();
    this.erc20Interface = new Interface(ERC20ABI);
    this.augustusV6Interface = new Interface(AugustusV6ABI);
    this.augustusV6Address =
      this.dexAdapterService.dexHelper.config.data.augustusV6Address!;
    this.executorDetector = new ExecutorDetector(
      this.dexAdapterService.dexHelper,
    );
  }

  protected getDepositWithdrawWethCallData(
    srcAmountWeth: bigint,
    destAmountWeth: bigint,
    side: SwapSide,
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeParamWithBooleanNeedWrapNative[],
  ) {
    if (srcAmountWeth === 0n && destAmountWeth === 0n) return;

    if (
      srcAmountWeth === destAmountWeth &&
      !this.hasAnyRouteWithEthAndDifferentNeedWrapNative(
        priceRoute,
        exchangeParams,
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

  protected async buildCalls(
    priceRoute: OptimalRate,
    minMaxAmount: string,
    bytecodeBuilder: ExecutorBytecodeBuilder,
    userAddress: string,
    getDexParamOptions?: GetDexParamOptions,
  ): Promise<string> {
    const side = priceRoute.side;
    const rawDexParams = await Promise.all(
      priceRoute.bestRoute.flatMap((route, routeIndex) =>
        route.swaps.flatMap((swap, swapIndex) =>
          swap.swapExchanges.map(async se => {
            const primary = await this.buildSingleExchangeParam(
              priceRoute,
              routeIndex,
              swap,
              swapIndex,
              se,
              minMaxAmount,
              bytecodeBuilder,
              getDexParamOptions,
            );

            // Revertable fallback alternative attached during pricing (api).
            // Build it the same way as the primary so its setup (approve/wrap)
            // is encoded inside the group's fallback branch.
            //
            // Executor01 shapes its route-level executor->Augustus forward off
            // the PRIMARY's dexFuncHasRecipient (buildByteCode). When that
            // primary keeps its output on the executor (=false), the fallback
            // must end there too — so it is built with the executor as its
            // recipient (and flagged deliversToExecutor for the balance check).
            // Executor02 appends its forward per-branch from each branch's own
            // param, so it needs no recipient forcing.
            const groupPrimaryDeliversToExecutor =
              bytecodeBuilder.type === Executors.ONE &&
              !primary.dexParams.dexFuncHasRecipient;

            const seFallback = se.fallback;
            const fallback = seFallback
              ? await this.buildSingleExchangeParam(
                  priceRoute,
                  routeIndex,
                  swap,
                  swapIndex,
                  seFallback,
                  minMaxAmount,
                  bytecodeBuilder,
                  getDexParamOptions,
                  true, // isGroupFallback — keep ETH-dest output on the executor
                  groupPrimaryDeliversToExecutor,
                )
              : undefined;

            return { ...primary, swap, fallback };
          }),
        ),
      ),
    );

    const {
      exchangeParams,
      fallbackEntries,
      srcAmountWethToDeposit,
      destAmountWethToWithdraw,
    } = rawDexParams.reduce<{
      exchangeParams: DexExchangeParamWithBooleanNeedWrapNative[];
      fallbackEntries: (
        | {
            swap: OptimalSwap;
            dexParams: DexExchangeParamWithBooleanNeedWrapNative;
          }
        | undefined
      )[];
      srcAmountWethToDeposit: bigint;
      destAmountWethToWithdraw: bigint;
    }>(
      (acc, se) => {
        acc.srcAmountWethToDeposit += BigInt(se.wethDeposit);
        acc.destAmountWethToWithdraw += BigInt(se.wethWithdraw);
        acc.exchangeParams.push(se.dexParams);
        if (se.fallback) {
          // Count the fallback's wrap/unwrap too so the WETH deposit/withdraw
          // template exists for whichever branch runs (only one executes at
          // runtime; the amount is inserted dynamically per branch).
          acc.srcAmountWethToDeposit += BigInt(se.fallback.wethDeposit);
          acc.destAmountWethToWithdraw += BigInt(se.fallback.wethWithdraw);
          acc.fallbackEntries.push({
            swap: se.swap,
            dexParams: se.fallback.dexParams,
          });
        } else {
          acc.fallbackEntries.push(undefined);
        }
        return acc;
      },
      {
        exchangeParams: [],
        fallbackEntries: [],
        srcAmountWethToDeposit: 0n,
        destAmountWethToWithdraw: 0n,
      },
    );

    const maybeWethCallData = this.getDepositWithdrawWethCallData(
      srcAmountWethToDeposit,
      destAmountWethToWithdraw,
      side,
      priceRoute,
      exchangeParams,
    );

    const buildExchangeParams = await this.addDexExchangeApproveParams(
      bytecodeBuilder,
      priceRoute,
      exchangeParams,
      maybeWethCallData,
    );

    // Attach each fallback as a fully-built sub-param (with its own approval) so
    // the Executor01 builder can encode it as a revertable group.
    for (let idx = 0; idx < fallbackEntries.length; idx++) {
      const entry = fallbackEntries[idx];
      if (!entry) continue;
      buildExchangeParams[idx] = {
        ...buildExchangeParams[idx],
        fallbackParam: await this.buildFallbackBuildParam(
          bytecodeBuilder,
          entry.swap,
          entry.dexParams,
        ),
      };
    }

    return bytecodeBuilder.buildByteCode(
      priceRoute,
      buildExchangeParams,
      userAddress,
      maybeWethCallData,
    );
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
    options?: GetDexParamOptions;
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
      ...(args.options ? { options: args.options } : {}),
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
    getDexParamOptions?: GetDexParamOptions,
  ) {
    const executorName =
      this.executorDetector.getExecutorByPriceRoute(priceRoute);
    const executionContractAddress =
      this.getExecutionContractAddress(priceRoute);

    const bytecodeBuilder =
      this.executorDetector.getBytecodeBuilder(executorName);
    const bytecode = await this.buildCalls(
      priceRoute,
      minMaxAmount,
      bytecodeBuilder,
      userAddress,
      getDexParamOptions,
    );

    const side = priceRoute.side;
    const isSell = side === SwapSide.SELL;

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

    const swapParams = [
      executionContractAddress,
      [
        priceRoute.srcToken,
        priceRoute.destToken,
        isSell ? priceRoute.srcAmount : minMaxAmount,
        isSell ? minMaxAmount : priceRoute.destAmount,
        quotedAmount,
        hexConcat([
          hexZeroPad(uuidToBytes16(uuid), 16),
          hexZeroPad(hexlify(priceRoute.blockNumber), 16),
        ]),
        beneficiary,
      ],
      partnerAndFee,
      permit,
      bytecode,
    ];

    const encoder = (...params: any[]) =>
      this.augustusV6Interface.encodeFunctionData(
        priceRoute.contractMethod,
        params,
      );

    return {
      encoder,
      params: swapParams,
    };
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
  ) {
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

    return dex.getDirectParamV6!(
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
    getDexParamOptions,
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
    getDexParamOptions?: GetDexParamOptions;
  }): Promise<TxObject | (string | string[])[]> {
    // if quotedAmount wasn't passed, use the amount from the route
    const _quotedAmount = quotedAmount
      ? quotedAmount
      : priceRoute.side === SwapSide.SELL
      ? priceRoute.destAmount
      : priceRoute.srcAmount;

    const _beneficiary = beneficiary;

    let encoder: (...params: any[]) => string;
    let params: (string | string[])[];

    if (
      this.dexAdapterService.isDirectFunctionNameV6(priceRoute.contractMethod)
    ) {
      ({ encoder, params } = await this._buildDirect(
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
      ));
    } else {
      ({ encoder, params } = await this._build(
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
        getDexParamOptions,
      ));
    }

    if (onlyParams) return params;

    const value = (
      priceRoute.srcToken.toLowerCase() === ETHER_ADDRESS.toLowerCase()
        ? BigInt(
            priceRoute.side === SwapSide.SELL
              ? priceRoute.srcAmount
              : minMaxAmount,
          )
        : BigInt(0)
    ).toString();

    return {
      from: userAddress,
      to: this.dexAdapterService.dexHelper.config.data.augustusV6Address,
      value,
      data: encoder.apply(null, params),
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
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
    const bytecodeBuilder =
      this.executorDetector.getBytecodeBuilder(executorName);

    return bytecodeBuilder.getAddress();
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
    forceExecutorRecipientOnEthDest = false,
    // Executor01 group fallback whose primary keeps output on the executor
    // (dexFuncHasRecipient=false): the fallback must end there too, so the
    // route-level executor->Augustus forward finds the funds.
    groupPrimaryDeliversToExecutor = false,
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
        priceRoute.side === SwapSide.BUY ||
        // A revertable group's fallback on an ETH-dest hop must leave its
        // output ON the executor: direct delivery to Augustus can't be
        // reconciled with the try branch's end state (the post-group
        // machinery would double-send the threaded amount).
        (forceExecutorRecipientOnEthDest && isETHAddress(swap.destToken)) ||
        // Executor01 group fallback behind a false-recipient primary: the
        // route-level forward expects the output on the executor.
        groupPrimaryDeliversToExecutor
          ? executionContractAddress
          : this.dexAdapterService.dexHelper.config.data.augustusV6Address!,
      srcAmount: _srcAmount,
      destAmount: _destAmount,
      wethDeposit,
      wethWithdraw,
    };
  }

  // Build the DexExchangeParam for a single swap exchange (resolving needWrapNative
  // and the wrap/unwrap accounting). Shared by the primary swap and its revertable
  // fallback alternative so both go through the exact same path.
  private async buildSingleExchangeParam(
    priceRoute: OptimalRate,
    routeIndex: number,
    swap: OptimalSwap,
    swapIndex: number,
    se: OptimalSwapExchange<any>,
    minMaxAmount: string,
    bytecodeBuilder: ExecutorBytecodeBuilder,
    getDexParamOptions?: GetDexParamOptions,
    isGroupFallback = false,
    groupPrimaryDeliversToExecutor = false,
  ): Promise<{
    dexParams: DexExchangeParamWithBooleanNeedWrapNative;
    wethDeposit: bigint;
    wethWithdraw: bigint;
  }> {
    const side = priceRoute.side;
    const newDex = this.findNewDex(se.exchange);
    const executorAddress = bytecodeBuilder.getAddress();

    // TEST-ONLY safety: forceRfqRevert may only reach primaries that carry a
    // fallback alternative. Never the fallback build itself, and never an RFQ
    // hop without a fallback (its revert would fail the whole route for
    // nothing). AMM dexes ignore the flag either way.
    if (
      getDexParamOptions?.forceRfqRevert &&
      (isGroupFallback || !se.fallback)
    ) {
      getDexParamOptions = { ...getDexParamOptions, forceRfqRevert: false };
    }

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
      isGroupFallback,
      isGroupFallback && groupPrimaryDeliversToExecutor,
    );

    const callGetDexParam = async (
      recipientArg: Address,
    ): Promise<DexExchangeParam> => {
      let params: DexExchangeParam;
      if (newDex) {
        params = await this.fetchRemoteDexParam({
          dexKey: newDex.key,
          srcToken,
          destToken,
          srcAmount: side === SwapSide.BUY ? se.srcAmount : srcAmount,
          destAmount,
          recipient: recipientArg,
          data: se.data,
          side,
          executorAddress,
          options: getDexParamOptions,
        });

        // The local `newDexs[*].needWrapNative` is the single source of truth:
        // it already drove `getDexCallsParams` (and therefore `wethDeposit`/
        // `wethWithdraw`). Keep the executor builder in lockstep so the wrap
        // accounting and the bytecode wiring can't diverge.
        params.needWrapNative = newDex.needWrapNative;
      } else {
        params = await dex!.getDexParam!(
          srcToken,
          destToken,
          side === SwapSide.BUY ? se.srcAmount : srcAmount, // in other case we would not be able to make insert from amount on Ex3
          destAmount,
          recipientArg,
          se.data,
          side,
          executorAddress,
          getDexParamOptions,
        );
      }
      if (typeof params.needWrapNative === 'function') {
        params.needWrapNative = params.needWrapNative(priceRoute, swap, se);
      }
      return params;
    };

    let dexParams = await callGetDexParam(recipient);

    // A needUnwrapNative fallback on a WETH-dest hop outputs raw ETH, and the
    // executor's wrap-after machinery expects that ETH ON the executor — but
    // whether the dex needs the unwrap treatment is only known from the
    // returned param, after the recipient was already chosen. If it went to
    // Augustus, re-encode with the executor as recipient; the group then ends
    // the branch with an explicit WETH forward (buildRevertableGroup /
    // wrapInRevertableGroup) so both branches still finish in the same state.
    if (
      isGroupFallback &&
      dexParams.needUnwrapNative &&
      // Only recipient-capable params need the re-encode (e.g. remote api-go
      // params). A dex that already normalizes WETH-dest itself (FluidDex
      // delivers on the executor and reports dexFuncHasRecipient=false) is
      // handled by the standard false-recipient epilogue — re-encoding AND
      // marking deliversToExecutor would append the executor->Augustus
      // forward twice, and the second transfer reverts on an empty balance.
      dexParams.dexFuncHasRecipient &&
      this.dexAdapterService.dexHelper.config.isWETH(swap.destToken) &&
      recipient.toLowerCase() !== executorAddress.toLowerCase()
    ) {
      dexParams = await callGetDexParam(executorAddress);
      // The re-encoded param may itself flip to false-recipient (dex-level
      // normalization raced the flag) — mark deliversToExecutor only while
      // the param still claims recipient delivery, so exactly one forward
      // site fires.
      if (dexParams.dexFuncHasRecipient) {
        dexParams.deliversToExecutor = true;
      }
    }

    // Case C marker (Executor01): group fallback redirected to the executor
    // because its primary keeps output there — the flag builders force this
    // block's dest-balance check so the group threads the REAL fallback output
    // to the route-level forward. Never set on primaries.
    if (isGroupFallback && groupPrimaryDeliversToExecutor) {
      dexParams.deliversToExecutor = true;
    }

    return {
      dexParams: <DexExchangeParamWithBooleanNeedWrapNative>dexParams,
      wethDeposit,
      wethWithdraw,
    };
  }

  // Turn a fallback DexExchangeParam into a DexExchangeBuildParam, computing its
  // own approval (a distinct spender from the primary; built independently so the
  // primary's approval dedup never suppresses it).
  private async buildFallbackBuildParam(
    bytecodeBuilder: ExecutorBytecodeBuilder,
    swap: OptimalSwap,
    dexParams: DexExchangeParamWithBooleanNeedWrapNative,
  ): Promise<DexExchangeBuildParam> {
    const approveParams = bytecodeBuilder.getApprovalTokenAndTarget(
      swap,
      dexParams,
    );

    if (!approveParams) {
      return { ...dexParams };
    }

    const spender = bytecodeBuilder.getAddress();
    const [alreadyApproved] = this.skipApprovalCheck
      ? [false]
      : await this.dexAdapterService.dexHelper.augustusApprovals.hasApprovals(
          spender,
          [
            [
              approveParams.token,
              approveParams.target,
              !!dexParams.permit2Approval,
            ],
          ],
        );

    return alreadyApproved
      ? { ...dexParams }
      : {
          ...dexParams,
          approveData: {
            token: approveParams.token,
            target: approveParams.target,
          },
        };
  }

  private async addDexExchangeApproveParams(
    bytecodeBuilder: ExecutorBytecodeBuilder,
    priceRoute: OptimalRate,
    dexExchangeParams: DexExchangeParamWithBooleanNeedWrapNative[],
    maybeWethCallData?: DepositWithdrawReturn,
  ): Promise<DexExchangeBuildParam[]> {
    const spender = bytecodeBuilder.getAddress();
    const tokenTargetMapping: {
      params: [token: Address, target: Address, permit2: boolean];
      exchangeParamIndex: number;
    }[] = [];

    let currentExchangeParamIndex = 0;

    priceRoute.bestRoute.flatMap(route =>
      route.swaps.flatMap(swap =>
        swap.swapExchanges.map(async se => {
          const curExchangeParam = dexExchangeParams[currentExchangeParamIndex];
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
              exchangeParamIndex: currentExchangeParamIndex,
            });
          }

          currentExchangeParamIndex++;
        }),
      ),
    );

    const approvals = this.skipApprovalCheck // used only for testing outdated price routes
      ? tokenTargetMapping.map(t => false)
      : await this.dexAdapterService.dexHelper.augustusApprovals.hasApprovals(
          spender,
          tokenTargetMapping.map(t => t.params),
        );

    const dexExchangeBuildParams: DexExchangeBuildParam[] = [
      ...dexExchangeParams,
    ];

    approvals.forEach((alreadyApproved, index) => {
      if (!alreadyApproved) {
        const [token, target] = tokenTargetMapping[index].params;
        const exchangeParamIndex = tokenTargetMapping[index].exchangeParamIndex;
        const curExchangeParam = dexExchangeParams[exchangeParamIndex];
        dexExchangeBuildParams[exchangeParamIndex] = {
          ...curExchangeParam,
          approveData: { token, target },
        };
      }
    });

    return dexExchangeBuildParams;
  }

  private hasAnyRouteWithEthAndDifferentNeedWrapNative(
    priceRoute: OptimalRate,
    exchangeParams: DexExchangeParamWithBooleanNeedWrapNative[],
  ) {
    const eth = ETHER_ADDRESS.toLowerCase();
    const weth =
      this.dexAdapterService.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();

    let currentExchangeParamIndex = 0;

    return !priceRoute.bestRoute.every(route => {
      const swapExchangeParams: DexExchangeParamWithBooleanNeedWrapNative[] =
        [];

      route.swaps.forEach(swap => {
        swap.swapExchanges.forEach(se => {
          const curExchangeParam = exchangeParams[currentExchangeParamIndex];
          currentExchangeParamIndex++;
          if (
            swap.destToken.toLowerCase() === weth ||
            swap.destToken.toLowerCase() === eth ||
            swap.srcToken.toLowerCase() === weth ||
            swap.srcToken.toLowerCase() === eth
          ) {
            swapExchangeParams.push(curExchangeParam);
          }
        });
      });

      return (
        swapExchangeParams.every(p => p.needWrapNative === true) ||
        swapExchangeParams.every(p => p.needWrapNative === false)
      );
    });
  }
}
