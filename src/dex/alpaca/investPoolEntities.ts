import { Token } from '../../types';
import { InvestPoolLiquidityDirection } from './config';
import { IInvestPoolProps } from './types';
import { BigNumber, constants } from 'ethers';
import {
  compareAddress,
  divScaleBN,
  etherToTether,
  mulOneNegative,
  mulTruncateBN,
  tetherToEther,
  toAbsoluteBPSRate,
} from './utils';

export class InvestPoolEntities {
  protected props: IInvestPoolProps[];

  constructor(props: IInvestPoolProps[]) {
    this.props = props;
  }

  public estimateSwapAmountOut(
    srcToken: Token,
    destToken: Token,
    amount: bigint,
  ): BigNumber {
    const matchedTokenIn: IInvestPoolProps | undefined = this.props.find(
      investPool => {
        return compareAddress(investPool.tokenAddress, srcToken.address);
      },
    );
    const matchedTokenOut: IInvestPoolProps | undefined = this.props.find(
      investPool => {
        return compareAddress(investPool.tokenAddress, destToken.address);
      },
    );

    if (
      !matchedTokenIn ||
      !matchedTokenOut ||
      matchedTokenOut.maxPrice.isZero()
    ) {
      return constants.Zero;
    }

    const amountIn = BigNumber.from(amount);

    const feeAmount = this._estimateSwapFeeAmount(
      matchedTokenIn.isDynamicFeeEnable,
      matchedTokenIn.stableSwapFeeRate,
      matchedTokenIn.stableTaxRate,
      matchedTokenIn.swapFeeRate,
      matchedTokenIn.taxRate,
      matchedTokenIn,
      this._getCurrentValueOf(matchedTokenIn, true),
      this._getTargetValueOf(matchedTokenIn, false),
      matchedTokenOut,
      this._getCurrentValueOf(matchedTokenOut, true),
      this._getTargetValueOf(matchedTokenOut, false),
      amountIn,
    );

    const amountInAfterFee: BigNumber = amountIn.sub(feeAmount);

    // NOTE: for same token no exchange rate
    const exchangeRate = compareAddress(
      matchedTokenIn.tokenAddress,
      matchedTokenOut.tokenAddress,
    )
      ? constants.WeiPerEther
      : divScaleBN(matchedTokenIn.minPrice, matchedTokenOut.maxPrice);
    const amountOut = mulTruncateBN(amountInAfterFee, exchangeRate);

    return amountOut;
  }

  private swapFeeRate(
    srcToken: Token,
    destToken: Token,
    amounts: bigint,
  ): BigNumber {
    const matchedTokenIn: IInvestPoolProps | undefined = this.props.find(
      investPool => {
        return compareAddress(investPool.tokenAddress, srcToken.address);
      },
    );
    const matchedTokenOut: IInvestPoolProps | undefined = this.props.find(
      investPool => {
        return compareAddress(investPool.tokenAddress, destToken.address);
      },
    );

    if (!matchedTokenIn || !matchedTokenOut) {
      return constants.Zero;
    }

    const feeRate: BigNumber = this._estimateSwapFeeRate(
      matchedTokenIn.isDynamicFeeEnable,
      matchedTokenIn.stableSwapFeeRate,
      matchedTokenIn.stableTaxRate,
      matchedTokenIn.swapFeeRate,
      matchedTokenIn.taxRate,
      matchedTokenIn,
      this._getCurrentValueOf(matchedTokenIn, true),
      this._getTargetValueOf(matchedTokenIn, false),
      matchedTokenOut,
      this._getCurrentValueOf(matchedTokenOut, true),
      this._getTargetValueOf(matchedTokenOut, false),
      BigNumber.from(amounts),
    );

    return feeRate;
  }

  private _getCurrentValueOf(
    matchedTokenIn: IInvestPoolProps,
    isUseMaxPrice: boolean,
  ): BigNumber {
    const priceE30: BigNumber = !isUseMaxPrice
      ? etherToTether(matchedTokenIn.minPrice)
      : etherToTether(matchedTokenIn.maxPrice);

    let liquidity: BigNumber = matchedTokenIn.liquidity;

    // Handle strategy delta
    if (matchedTokenIn.isStrategyProfit) {
      liquidity = liquidity.add(matchedTokenIn.strategyDelta);
    } else {
      liquidity = liquidity.sub(matchedTokenIn.strategyDelta);
    }

    if (matchedTokenIn.tokenMetas.isStable) {
      // Handing value if it is stable coin
      // If token is a stable coin, try to find
      // best-effort value due to we compressed PnL to one variable.
      // best-effort short PnL alloc = Pool's short profits * stable coin utilization
      // current value = liquidity * price - best-effort short PnL alloc

      let totalStableReserved: BigNumber = constants.Zero;
      let shortPnlE30: BigNumber = constants.Zero;
      for (const investPool of this.props) {
        if (investPool.tokenMetas.isStable) {
          // If it is a stablecoin then sum to totalStableReserved normalized in token's decimals
          totalStableReserved = totalStableReserved.add(investPool.reservedOf);
        } else {
          // If not then calculate short profit
          shortPnlE30 = shortPnlE30.add(this._getShortPnlOfE30(investPool));
        }
      }
      const liquidityValueE30: BigNumber = mulTruncateBN(liquidity, priceE30);
      const finalShortPnlE30: BigNumber = totalStableReserved.gt(constants.Zero)
        ? shortPnlE30.mul(matchedTokenIn.reservedOf).div(totalStableReserved)
        : constants.Zero;

      return tetherToEther(
        liquidityValueE30.add(
          finalShortPnlE30.lt(constants.Zero)
            ? constants.Zero
            : liquidityValueE30.add(finalShortPnlE30),
        ),
      );
    }

    //   // Handing value calculation if it is volitle asset
    //   // If token is a volatile asset,
    //   // current value = ((liquidity - reserved) * price) + guaranteedUsd
    return tetherToEther(
      mulTruncateBN(liquidity.sub(matchedTokenIn.reservedOf), priceE30).add(
        matchedTokenIn.guaranteedUsdOfE30,
      ),
    );
  }

  private _getShortPnlOfE30(investPoolProp: IInvestPoolProps): BigNumber {
    const shortSizeE30: BigNumber = investPoolProp.shortSizeOfE30;
    const shortAveragePriceE30: BigNumber =
      investPoolProp.shortAveragePriceOfE30;
    if (
      shortSizeE30.gt(constants.Zero) &&
      shortAveragePriceE30.gt(constants.Zero)
    ) {
      let priceDeltaE30: BigNumber = constants.Zero;
      const maxPriceE30: BigNumber = etherToTether(investPoolProp.maxPrice);

      priceDeltaE30 = shortAveragePriceE30.gt(maxPriceE30)
        ? shortAveragePriceE30.sub(maxPriceE30)
        : maxPriceE30.sub(shortAveragePriceE30);

      // Findout delta (can be either profit or loss) of short positions.
      const deltaE30: BigNumber = shortSizeE30
        .mul(priceDeltaE30)
        .div(shortAveragePriceE30);
      if (maxPriceE30.lt(shortAveragePriceE30)) {
        return mulOneNegative(deltaE30);
      } else {
        return deltaE30;
      }
    }

    return constants.Zero;
  }

  private _getTargetValueOf(
    investPool: IInvestPoolProps,
    isUseMaxPrice: boolean,
  ): BigNumber {
    const aum: BigNumber = this._getAum(isUseMaxPrice);
    if (aum.isZero()) {
      return constants.Zero;
    }

    return aum.mul(investPool.tokenMetas.weight).div(this._totalWeight());
  }

  private _totalWeight(): BigNumber {
    const totalWeight = this.props.reduce(
      (totalWeight: BigNumber, cur: IInvestPoolProps) => {
        return totalWeight.add(cur.tokenMetas.weight);
      },
      constants.Zero,
    );

    return totalWeight;
  }

  private _getAum(isUseMaxPrice: boolean): BigNumber {
    return tetherToEther(this._getAumE30(isUseMaxPrice));
  }

  private _getAumE30(isUseMaxPrice: boolean): BigNumber {
    let aum: BigNumber = this.props[0].additionalAum;
    let shortProfit: BigNumber = constants.Zero;

    for (const tokenPool of this.props) {
      const priceE30: BigNumber = !isUseMaxPrice
        ? etherToTether(tokenPool.minPrice)
        : etherToTether(tokenPool.maxPrice);
      const liquidity: BigNumber = tokenPool.isStrategyProfit
        ? tokenPool.liquidity.add(tokenPool.strategyDelta)
        : tokenPool.liquidity.sub(tokenPool.strategyDelta);
      const decimals: BigNumber = BigNumber.from('10').pow(18);

      if (tokenPool.tokenMetas.isStable) {
        aum = aum.add(liquidity.mul(priceE30).div(decimals));
      } else {
        const shortSizeE30: BigNumber = tokenPool.shortSizeOfE30;
        const shortAveragePriceE30: BigNumber =
          tokenPool.shortAveragePriceOfE30;

        if (
          shortSizeE30.gt(constants.Zero) &&
          shortAveragePriceE30.gt(constants.Zero)
        ) {
          const maxPriceE30: BigNumber = etherToTether(tokenPool.maxPrice);
          const priceDeltaE30: BigNumber = shortAveragePriceE30.gt(maxPriceE30)
            ? shortAveragePriceE30.sub(maxPriceE30)
            : maxPriceE30.sub(shortAveragePriceE30);

          // Findout delta (can be either profit or loss) of short positions.
          const delta: BigNumber = shortSizeE30
            .mul(priceDeltaE30)
            .div(shortAveragePriceE30);

          if (maxPriceE30.gt(shortAveragePriceE30)) {
            // Short position is at loss, then count it as aum
            aum = aum.add(delta);
          } else {
            // Short position is at profit, then count it as shortProfits
            shortProfit = shortProfit.add(delta);
          }
        }

        // Add guaranteed USD to the aum.
        aum = aum.add(tokenPool.guaranteedUsdOfE30);

        // Add actual liquidity of the token to the aum.
        aum = aum.add(
          liquidity.sub(tokenPool.reservedOf).mul(priceE30).div(decimals),
        );
      }
    }

    aum = shortProfit.gt(aum) ? constants.Zero : aum.sub(shortProfit);
    return this.props[0].discountedAum.gt(aum)
      ? constants.Zero
      : aum
          .sub(this.props[0].discountedAum)
          .sub(this.props[0].fundingFeePayableE30)
          .add(this.props[0].fundingFeeReceivableE30);
  }

  private _estimateSwapFeeAmount(
    isDynamicFeeEnable: boolean,
    stableSwapFeeRate: BigNumber,
    stableTaxRate: BigNumber,
    swapFeeRate: BigNumber,
    taxRate: BigNumber,
    tokenIn: IInvestPoolProps,
    tokenInCurrentValue: BigNumber,
    tokenInTargetValue: BigNumber,
    tokenOut: IInvestPoolProps,
    tokenOutCurrentValue: BigNumber,
    tokenOutTargetValue: BigNumber,
    amount: BigNumber,
  ): BigNumber {
    const feeRate: BigNumber = this._estimateSwapFeeRate(
      isDynamicFeeEnable,
      stableSwapFeeRate,
      stableTaxRate,
      swapFeeRate,
      taxRate,
      tokenIn,
      tokenInCurrentValue,
      tokenInTargetValue,
      tokenOut,
      tokenOutCurrentValue,
      tokenOutTargetValue,
      amount,
    );
    const feeAmount: BigNumber = mulTruncateBN(amount, feeRate);

    return feeAmount;
  }

  private _estimateSwapFeeRate(
    isDynamicFeeEnable: boolean,
    stableSwapFeeRate: BigNumber,
    stableTaxRate: BigNumber,
    swapFeeRate: BigNumber,
    taxRate: BigNumber,
    tokenIn: IInvestPoolProps,
    tokenInCurrentValue: BigNumber,
    tokenInTargetValue: BigNumber,
    tokenOut: IInvestPoolProps,
    tokenOutCurrentValue: BigNumber,
    tokenOutTargetValue: BigNumber,
    amount: BigNumber,
  ): BigNumber {
    if (compareAddress(tokenIn.tokenAddress, tokenOut.tokenAddress)) {
      return constants.Zero;
    }

    const feeRate: BigNumber = this._getSwapFeeRate(
      isDynamicFeeEnable,
      stableSwapFeeRate,
      stableTaxRate,
      swapFeeRate,
      taxRate,
      tokenIn,
      tokenInCurrentValue,
      tokenInTargetValue,
      tokenOut,
      tokenOutCurrentValue,
      tokenOutTargetValue,
      this._estimateAddTokenValue(tokenIn, amount),
    );

    return feeRate;
  }

  private _getSwapFeeRate(
    isDynamicFeeEnable: boolean,
    stableSwapFeeRate: BigNumber,
    stableTaxRate: BigNumber,
    swapFeeRate: BigNumber,
    taxRate: BigNumber,
    tokenIn: IInvestPoolProps,
    tokenInCurrentValue: BigNumber,
    tokenInTargetValue: BigNumber,
    tokenOut: IInvestPoolProps,
    tokenOutCurrentValue: BigNumber,
    tokenOutTargetValue: BigNumber,
    usdValue: BigNumber,
  ): BigNumber {
    const isStableSwap =
      tokenIn.tokenMetas.isStable && tokenOut.tokenMetas.isStable;
    const feeBps = isStableSwap ? stableSwapFeeRate : swapFeeRate;
    const taxBps = isStableSwap ? stableTaxRate : taxRate;
    const feeBpsIn = this._estimateFeeRate(
      tokenInCurrentValue,
      tokenInTargetValue,
      isDynamicFeeEnable,
      feeBps,
      taxBps,
      usdValue,
      InvestPoolLiquidityDirection.ADD,
    );
    const feeBpsOut = this._estimateFeeRate(
      tokenOutCurrentValue,
      tokenOutTargetValue,
      isDynamicFeeEnable,
      feeBps,
      taxBps,
      usdValue,
      InvestPoolLiquidityDirection.REMOVE,
    );

    return feeBpsIn.gt(feeBpsOut) ? feeBpsIn : feeBpsOut;
  }

  private _estimateFeeRate(
    startValue: BigNumber,
    targetValue: BigNumber,
    isDynamicFeeEnable: boolean,
    baseFeeRate: BigNumber,
    taxRate: BigNumber,
    usdValue: BigNumber,
    direction: InvestPoolLiquidityDirection,
  ): BigNumber {
    if (!isDynamicFeeEnable) {
      return baseFeeRate;
    }

    let nextValue: BigNumber = startValue.add(usdValue);
    if (direction == InvestPoolLiquidityDirection.REMOVE) {
      nextValue = usdValue.gt(startValue)
        ? constants.Zero
        : startValue.sub(usdValue);
    }

    if (targetValue.isZero()) {
      return baseFeeRate;
    }

    const startDiff = targetValue.gt(startValue)
      ? targetValue.sub(startValue)
      : startValue.sub(targetValue);
    const nextDiff = targetValue.gt(nextValue)
      ? targetValue.sub(nextValue)
      : nextValue.sub(targetValue);

    if (startDiff.gt(nextDiff)) {
      const rebateRate = mulTruncateBN(
        taxRate,
        divScaleBN(startDiff, targetValue),
      );
      return rebateRate.gt(baseFeeRate)
        ? constants.Zero
        : // NOTE: for preventing precision lost between frontend and contract calculation
          // need to convert fee rate that be calculated on the frontend to BPS(1e4) format
          // then convert back to rate format(1e18) for easier calculation in the website
          toAbsoluteBPSRate(baseFeeRate.sub(rebateRate));
    }

    let midDiff = startDiff.add(nextDiff).div(2);
    if (targetValue.lt(midDiff)) {
      midDiff = targetValue;
    }
    const newTaxRate = mulTruncateBN(taxRate, divScaleBN(midDiff, targetValue));

    // NOTE: for preventing precision lost between frontend and contract calculation
    // need to convert fee rate that be calculated on the frontend to BPS(1e4) format
    // then convert back to rate format(1e18) for easier calculation in the website
    return toAbsoluteBPSRate(baseFeeRate.add(newTaxRate));
  }

  private _estimateAddTokenValue(
    tokenIn: IInvestPoolProps,
    tokenAmount: BigNumber,
  ): BigNumber {
    const tokenValue: BigNumber = mulTruncateBN(tokenAmount, tokenIn.minPrice);

    return tokenValue;
  }
}
