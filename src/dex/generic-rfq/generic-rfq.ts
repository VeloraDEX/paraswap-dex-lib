import BigNumber from 'bignumber.js';
import {
  Token,
  ExchangePrices,
  ExchangeTxInfo,
  PreprocessTransactionOptions,
  Config,
  PoolLiquidity,
  Address,
  DexExchangeParam,
} from '../../types';
import { Network, SwapSide } from '../../constants';
import { IDexHelper } from '../../dex-helper';
import { ParaSwapLimitOrders } from '../paraswap-limit-orders/paraswap-limit-orders';
import { BN_0, BN_1, getBigNumberPow } from '../../bignumber-constants';
import { ParaSwapLimitOrdersData } from '../paraswap-limit-orders/types';
import { ONE_ORDER_GASCOST } from '../paraswap-limit-orders/constant';
import { RateFetcher } from './rate-fetcher';
import {
  PriceAndAmountBigNumber,
  RFQConfig,
  RFQDirectPayload,
  RFQParams,
  SlippageCheckError,
} from './types';
import {
  ContractMethodV6,
  NumberAsString,
  OptimalSwapExchange,
  ParaSwapVersion,
} from '@paraswap/core';
import { BI_MAX_UINT256 } from '../../bigint-constants';
import { SpecialDex } from '../../executor/types';
import { hexConcat, hexZeroPad, hexlify } from 'ethers/lib/utils';
import { isETHAddress, uuidToBytes16 } from '../../utils';

export const OVERORDER_BPS = 100;
export const BPS_MAX_VALUE = 10000n;

export const overOrder = (amount: string, bps: number) =>
  ((BigInt(amount) * (BPS_MAX_VALUE + BigInt(bps))) / BPS_MAX_VALUE).toString();

export class GenericRFQ extends ParaSwapLimitOrders {
  readonly isStatePollingDex = true;
  private rateFetcher: RateFetcher;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] = [];

  static builderDexKeysWithNetwork(config: Config): void {
    Object.keys(config.rfqConfigs).forEach(rfqName =>
      this.dexKeysWithNetwork.push({
        key: rfqName,
        networks: [config.network],
      }),
    );
  }

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    private config: RFQConfig,
  ) {
    super(network, dexKey, dexHelper);
    this.rateFetcher = new RateFetcher(dexHelper, config, dexKey, this.logger);
  }

  async initializePricing(blockNumber: number): Promise<void> {
    await this.rateFetcher.initialize();
    if (!this.dexHelper.config.isSlave) {
      this.rateFetcher.start();
    }
    return;
  }

  getIdentifier(srcToken: Address, destToken: Address) {
    // Keep only destination token in order to prevent taping into the same market maker liquidity during same swap (double spending)
    return `${this.dexKey}_${destToken}`.toLowerCase();
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _destToken = this.dexHelper.config
      .wrapETH(destToken)
      .address.toLowerCase();
    const _srcToken = this.dexHelper.config
      .wrapETH(srcToken)
      .address.toLowerCase();

    const currentPair = `${_srcToken}_${_destToken}`;
    const availablePairs = await this.rateFetcher.getAvailablePairs();

    return availablePairs
      .filter(p => p === currentPair)
      .map(_ => this.getIdentifier(_srcToken, _destToken));
  }

  calcOutsFromAmounts(
    amounts: BigNumber[],
    outMultiplier: BigNumber,
    amountsWithRates: PriceAndAmountBigNumber[],
  ): bigint[] {
    let lastOrderIndex = 0;
    let lastTotalSrcAmount = BN_0;
    let lastTotalDestAmount = BN_0;
    const outputs = new Array<BigNumber>(amounts.length).fill(BN_0);
    for (const [i, amount] of amounts.entries()) {
      if (amount.isZero()) {
        outputs[i] = BN_0;
      } else {
        let srcAmountLeft = amount.minus(lastTotalSrcAmount);
        let destAmountFilled = lastTotalDestAmount;
        while (lastOrderIndex < amountsWithRates.length) {
          const [price, amount] = amountsWithRates[lastOrderIndex];
          if (srcAmountLeft.gt(amount)) {
            const destAmount = amount.multipliedBy(price);

            srcAmountLeft = srcAmountLeft.minus(amount);
            destAmountFilled = destAmountFilled.plus(destAmount);

            lastTotalSrcAmount = lastTotalSrcAmount.plus(amount);
            lastTotalDestAmount = lastTotalDestAmount.plus(destAmount);
            lastOrderIndex++;
          } else {
            destAmountFilled = destAmountFilled.plus(
              srcAmountLeft.multipliedBy(price),
            );
            srcAmountLeft = BN_0;
            break;
          }
        }
        if (srcAmountLeft.isZero()) {
          outputs[i] = destAmountFilled;
        } else {
          // If current amount was unfillable, then bigger amounts are unfillable as well
          break;
        }
      }
    }

    return outputs.map(o => BigInt(o.multipliedBy(outMultiplier).toFixed(0)));
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<ExchangePrices<ParaSwapLimitOrdersData> | null> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    _srcToken.address = _srcToken.address.toLowerCase();
    _destToken.address = _destToken.address.toLowerCase();
    if (_srcToken.address === _destToken.address) return null;

    const expectedIdentifier = this.getIdentifier(
      _srcToken.address,
      _destToken.address,
    );

    if (!limitPools?.includes(expectedIdentifier)) {
      return null;
    }

    const rates = await this.rateFetcher.getOrderPrice(
      _srcToken,
      _destToken,
      side,
    );
    if (!rates) {
      return null;
    }

    const inDecimals =
      side === SwapSide.SELL ? _srcToken.decimals : _destToken.decimals;
    const outDecimals =
      side === SwapSide.SELL ? _destToken.decimals : _srcToken.decimals;

    const _amountsInBN = amounts.map(a =>
      new BigNumber(a.toString()).dividedBy(getBigNumberPow(inDecimals)),
    );

    const unitVolume = BN_1;

    const unitResults = this.calcOutsFromAmounts(
      [unitVolume],
      getBigNumberPow(outDecimals),
      rates,
    );

    const unit = unitResults[0];
    const outputs = this.calcOutsFromAmounts(
      _amountsInBN,
      getBigNumberPow(outDecimals),
      rates,
    );
    return [
      {
        gasCost: Number(ONE_ORDER_GASCOST),
        exchange: this.dexKey,
        poolIdentifier: expectedIdentifier,
        prices: outputs,
        unit,
        data: {
          orderInfos: null,
        },
      },
    ];
  }

  static getDirectFunctionNameV6(): string[] {
    return [ContractMethodV6.swapOnAugustusRFQTryBatchFill];
  }

  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: ParaSwapLimitOrdersData,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ) {
    if (!contractMethod) throw new Error(`contractMethod need to be passed`);
    if (!GenericRFQ.getDirectFunctionNameV6().includes(contractMethod!)) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }
    if (data.orderInfos === null) {
      throw new Error(
        `Error_${this.dexKey}_getDirectParamV6 payload is not received. It may be because of` +
          `not calling preProcessTransaction before`,
      );
    }

    // 2 if dest is ETH, 1 if src is ETH, 0 if none
    const wrap = isETHAddress(destToken) ? 2 : isETHAddress(srcToken) ? 1 : 0;

    // 1 if need approve, 0 if not
    const approve = data.isApproved ? 0 : 1;

    // 0 for SELL, 1 for BUY
    const direction = side === SwapSide.SELL ? 0 : 1;

    const wrapApproveDirection = (direction << 3) | (approve << 2) | wrap;

    const metadata = hexConcat([
      hexZeroPad(uuidToBytes16(uuid), 16),
      hexZeroPad(hexlify(blockNumber), 16),
    ]);

    const params: RFQParams = [
      fromAmount,
      toAmount,
      wrapApproveDirection.toString(),
      metadata,
      beneficiary,
    ];

    const payload: RFQDirectPayload = [params, data.orderInfos, permit];

    const encoder = (...params: (string | RFQDirectPayload)[]) => {
      return this.augustusV6Interface.encodeFunctionData(
        ContractMethodV6.swapOnAugustusRFQTryBatchFill,
        [...params],
      );
    };

    return { params: payload, encoder, networkFee: '0' };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ParaSwapLimitOrdersData,
    side: SwapSide,
  ): DexExchangeParam {
    const { orderInfos } = data;

    if (orderInfos === null) {
      throw new Error(
        `Error_${this.dexKey}_getDexParam payload is not received. It may be because of` +
          `not calling preProcessTransaction before`,
      );
    }

    const isSell = side === SwapSide.SELL;

    const specialDexExchangeData = this.rfqIface.encodeFunctionData(
      isSell ? 'tryBatchFillOrderTakerAmount' : 'tryBatchFillOrderMakerAmount',
      [orderInfos, isSell ? srcAmount : destAmount, recipient],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: specialDexExchangeData,
      specialDexFlag: SpecialDex.SWAP_ON_AUGUSTUS_RFQ,
      targetExchange: this.augustusRFQAddress,
      specialDexSupportsInsertFromAmount: true,
      returnAmountPos: undefined,
    };
  }

  async preProcessTransaction?(
    optimalSwapExchange: OptimalSwapExchange<ParaSwapLimitOrdersData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<ParaSwapLimitOrdersData>, ExchangeTxInfo]> {
    if (await this.isBlacklisted(options.txOrigin)) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted TX Origin address '${options.txOrigin}' trying to build a transaction. Bailing...`,
      );
      throw new Error(
        `${this.dexKey}-${this.network}: user=${options.txOrigin} is blacklisted`,
      );
    }

    if (
      options.userAddress !== options.txOrigin &&
      (await this.isBlacklisted(options.userAddress))
    ) {
      this.logger.warn(
        `${this.dexKey}-${this.network}: blacklisted user address '${options.userAddress}' trying to build a transaction. Bailing...`,
      );
      throw new Error(
        `${this.dexKey}-${this.network}: user=${options.userAddress} is blacklisted`,
      );
    }

    const isSell = side === SwapSide.SELL;

    const order = await this.rateFetcher.getFirmRate(
      srcToken,
      destToken,
      isSell
        ? overOrder(optimalSwapExchange.srcAmount, OVERORDER_BPS)
        : overOrder(optimalSwapExchange.destAmount, 1),
      side,
      options.executionContractAddress,
      options.userAddress,
      options.partner,
      options.special,
    );

    const expiryAsBigInt = BigInt(order.order.expiry);
    const minDeadline = expiryAsBigInt > 0 ? expiryAsBigInt : BI_MAX_UINT256;

    const makerAssetAmount = BigInt(order.order.makerAmount);
    const takerAssetAmount = BigInt(order.order.takerAmount);

    const srcAmount = BigInt(optimalSwapExchange.srcAmount);
    const destAmount = BigInt(optimalSwapExchange.destAmount);

    const slippageFactor = options.slippageFactor;

    if (side === SwapSide.SELL) {
      const makerAssetAmountFilled =
        takerAssetAmount > srcAmount
          ? (makerAssetAmount * srcAmount) / takerAssetAmount
          : makerAssetAmount;

      const requiredAmountWithSlippage = new BigNumber(destAmount.toString())
        .multipliedBy(slippageFactor)
        .toFixed(0);

      if (makerAssetAmountFilled < BigInt(requiredAmountWithSlippage)) {
        throw new SlippageCheckError(
          this.dexKey,
          this.network,
          side,
          requiredAmountWithSlippage,
          makerAssetAmountFilled.toString(),
          slippageFactor,
        );
      }
    } else {
      if (makerAssetAmount < destAmount) {
        throw new SlippageCheckError(
          this.dexKey,
          this.network,
          side,
          destAmount.toString(),
          makerAssetAmount.toString(),
          slippageFactor,
          true,
        );
      }

      const requiredAmountWithSlippage = new BigNumber(srcAmount.toString())
        .multipliedBy(slippageFactor)
        .toFixed(0);

      if (takerAssetAmount > BigInt(requiredAmountWithSlippage)) {
        throw new SlippageCheckError(
          this.dexKey,
          this.network,
          side,
          requiredAmountWithSlippage,
          takerAssetAmount.toString(),
          slippageFactor,
        );
      }
    }

    let isApproved = false;

    // isApproved is only used in direct method and available only for v6, then no need to check approve for v5
    // because it's either done in getSimpleParam or approve call in the adapter smart contract
    if (options.version === ParaSwapVersion.V6 && options.isDirectMethod) {
      isApproved = await this.dexHelper.augustusApprovals.hasApproval(
        options.executionContractAddress,
        // ETH always need to be wrapped for RFQ
        this.dexHelper.config.wrapETH(srcToken).address,
        this.augustusRFQAddress,
      );
    }

    return [
      { ...optimalSwapExchange, data: { orderInfos: [order], isApproved } },
      { deadline: minDeadline },
    ];
  }

  async getTopPoolsForToken(
    tokenAddress: string,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const pairs = this.rateFetcher.getPairsLiquidity(
      tokenAddress.toLowerCase(),
    );

    return pairs.map(pair => ({
      exchange: this.dexKey,
      address: this.config.maker,
      connectorTokens: pair.connectorTokens,
      liquidityUSD: pair.liquidityUSD,
    }));
  }

  async isBlacklisted(userAddress: string): Promise<boolean> {
    return this.rateFetcher.isBlackListed(userAddress);
  }

  async setBlacklist(userAddress: string): Promise<boolean> {
    await this.dexHelper.cache.hset(
      this.rateFetcher.blackListCacheKey,
      userAddress.toLowerCase(),
      'true',
    );
    return true;
  }

  releaseResources(): void {
    if (this.rateFetcher) {
      this.rateFetcher.stop();
    }
  }
}
