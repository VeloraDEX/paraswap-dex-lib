import {
  Address,
  DexExchangeBuildParam,
  DexExchangeParam,
  DexExchangeParamWithBooleanNeedWrapNative,
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
import AugustusV6ABI from './abi/augustus-v6/ABI.json';
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
import { IDexTxBuilder } from './dex/idex';
import { ContractMethod, ParaSwapVersion, SwapSide } from '@paraswap/core';

const {
  utils: { hexlify, hexConcat, hexZeroPad },
} = ethers;

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

  protected async buildCalls(
    priceRoute: OptimalRate,
    minMaxAmount: string,
    bytecodeBuilder: ExecutorBytecodeBuilder,
    userAddress: string,
  ): Promise<string> {
    const side = priceRoute.side;
    const rawDexParams = await Promise.all(
      priceRoute.bestRoute.flatMap((route, routeIndex) =>
        route.swaps.flatMap((swap, swapIndex) =>
          swap.swapExchanges.map(async se => {
            const dex = this.dexAdapterService.getTxBuilderDexByKey(
              se.exchange,
            );

            const executorAddress = bytecodeBuilder.getAddress();
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
              dex,
              executorAddress,
            );

            let dexParams = await dex.getDexParam!(
              srcToken,
              destToken,
              side === SwapSide.BUY ? se.srcAmount : srcAmount, // in other case we would not be able to make insert from amount on Ex3
              destAmount,
              recipient,
              se.data,
              side,
              {
                isGlobalSrcToken:
                  priceRoute.srcToken.toLowerCase() === srcToken.toLowerCase(),
                isGlobalDestToken:
                  priceRoute.destToken.toLowerCase() ===
                  destToken.toLowerCase(),
              },
              executorAddress,
            );

            if (typeof dexParams.needWrapNative === 'function') {
              dexParams.needWrapNative = dexParams.needWrapNative(
                priceRoute,
                swap,
                se,
              );
            }

            return {
              dexParams: <DexExchangeParamWithBooleanNeedWrapNative>dexParams,
              wethDeposit,
              wethWithdraw,
            };
          }),
        ),
      ),
    );

    const { exchangeParams, srcAmountWethToDeposit, destAmountWethToWithdraw } =
      await rawDexParams.reduce<{
        exchangeParams: DexExchangeParamWithBooleanNeedWrapNative[];
        srcAmountWethToDeposit: bigint;
        destAmountWethToWithdraw: bigint;
      }>(
        (acc, se) => {
          acc.srcAmountWethToDeposit += BigInt(se.wethDeposit);
          acc.destAmountWethToWithdraw += BigInt(se.wethWithdraw);
          acc.exchangeParams.push(se.dexParams);
          return acc;
        },
        {
          exchangeParams: [],
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

    return bytecodeBuilder.buildByteCode(
      priceRoute,
      buildExchangeParams,
      userAddress,
      maybeWethCallData,
    );
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
    genericWithPartnerFee: boolean,
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

    let method = isSell ? 'swapExactAmountIn' : 'swapExactAmountOut';

    if (genericWithPartnerFee) {
      method = isSell ? 'swapExactAmountInPro' : 'swapExactAmountOutPro';
    }

    const encoder = (...params: any[]) =>
      this.augustusV6Interface.encodeFunctionData(method, params);

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
    genericWithPartnerFee = false,
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
    genericWithPartnerFee?: boolean;
  }): Promise<TxObject | (string | string[])[]> {
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
        genericWithPartnerFee,
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
    dex: IDexTxBuilder<any, any>,
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

    const dexNeedWrapNative =
      typeof dex.needWrapNative === 'function'
        ? dex.needWrapNative(priceRoute, swap, se)
        : dex.needWrapNative;

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

    const approvals =
      await this.dexAdapterService.dexHelper.augustusApprovals.hasApprovals(
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
