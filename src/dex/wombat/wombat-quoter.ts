import { AssetState, PoolParams } from './types';
import { fromWad, sqrt, toWad, WAD, wdiv, wmul } from './utils';

export class WombatQuoter {
  private readonly ampFactor: bigint;
  private readonly haircutRate: bigint;
  private readonly withdrawalHaircutRate: bigint;
  private readonly startCovRatio: bigint;
  private readonly endCovRatio: bigint;

  constructor(poolParams: PoolParams) {
    this.ampFactor = poolParams.ampFactor;
    this.haircutRate = poolParams.haircutRate;
    this.withdrawalHaircutRate = poolParams.withdrawalHaircutRate;
    this.startCovRatio = poolParams.startCovRatio;
    this.endCovRatio = poolParams.endCovRatio;
  }

  public getQuote(
    fromAsset: AssetState,
    toAsset: AssetState,
    fromAmount: bigint,
  ): bigint {
    if (fromAmount === 0n || fromAsset.paused) {
      return 0n;
    }

    fromAmount = toWad(fromAmount, BigInt(fromAsset.underlyingTokenDecimals));

    try {
      const { actualToAmount, haircut } = this._highCovRatioPoolQuoteFrom(
        fromAsset,
        toAsset,
        fromAmount,
      );
      const toCash = toAsset.cash - actualToAmount - haircut;

      if (wdiv(toCash, toAsset.liability) < WAD / 100n) {
        return 0n;
      }

      return fromWad(actualToAmount, BigInt(toAsset.underlyingTokenDecimals));
    } catch (e) {
      return 0n;
    }
  }

  private _highCovRatioPoolQuoteFrom(
    fromAsset: AssetState,
    toAsset: AssetState,
    fromAmount: bigint,
  ): { actualToAmount: bigint; haircut: bigint } {
    let { actualToAmount, haircut } = this._quoteFrom(
      fromAsset,
      toAsset,
      fromAmount,
    );

    if (fromAmount > 0n) {
      const fromCash = fromAsset.cash;
      const fromLiability = fromAsset.liability;

      const finalFromAssetCovRatio = wdiv(fromCash + fromAmount, fromLiability);
      if (finalFromAssetCovRatio > this.startCovRatio) {
        // charge high cov ratio fee
        const highCovRatioFee = wmul(
          this._highCovRatioFee(
            wdiv(fromCash, fromLiability),
            finalFromAssetCovRatio,
          ),
          actualToAmount,
        );

        actualToAmount -= highCovRatioFee;
        haircut += highCovRatioFee;
      }
    } else {
      // reverse quote
      const toCash = toAsset.cash;
      const toLiability = toAsset.liability;

      const finalToAssetCovRatio = wdiv(toCash + actualToAmount, toLiability);
      if (finalToAssetCovRatio <= this.startCovRatio) {
        // happy path: no high cov ratio fee is charged
        return { actualToAmount, haircut };
      } else if (wdiv(toCash, toLiability) >= this.endCovRatio) {
        // the to-asset exceeds it's cov ratio limit, further swap to increase cov ratio is impossible
        throw new Error('WOMBAT_COV_RATIO_LIMIT_EXCEEDED');
      }

      // reverse quote: cov ratio of the to-asset exceed endCovRatio. direct reverse quote is not supported
      // we binary search for a upper bound
      actualToAmount = this._findUpperBound(toAsset, fromAsset, -fromAmount);
      const result = this._highCovRatioPoolQuoteFrom(
        toAsset,
        fromAsset,
        actualToAmount,
      );
      haircut = result.haircut;
    }

    return { actualToAmount, haircut };
  }

  private _highCovRatioFee(
    initCovRatio: bigint,
    finalCovRatio: bigint,
  ): bigint {
    const startCovRatio = this.startCovRatio!;
    const endCovRatio = this.endCovRatio!;
    if (finalCovRatio > endCovRatio) {
      // invalid swap
      throw new Error('WOMBAT_COV_RATIO_LIMIT_EXCEEDED');
    } else if (
      finalCovRatio <= startCovRatio ||
      finalCovRatio <= initCovRatio
    ) {
      return 0n;
    }

    // 1. Calculate the area of fee(r) = (r - startCovRatio) / (endCovRatio - startCovRatio)
    // when r increase from initCovRatio to finalCovRatio
    // 2. Then multiply it by (endCovRatio - startCovRatio) / (finalCovRatio - initCovRatio)
    // to get the average fee over the range
    const a =
      initCovRatio <= startCovRatio
        ? 0n
        : (initCovRatio - startCovRatio) * (initCovRatio - startCovRatio);
    const b = (finalCovRatio - startCovRatio) * (finalCovRatio - startCovRatio);
    return wdiv(
      (b - a) / (finalCovRatio - initCovRatio) / BigInt(2),
      endCovRatio - startCovRatio,
    );
  }

  private _quoteFrom(
    fromAsset: AssetState,
    toAsset: AssetState,
    fromAmount: bigint,
  ): { actualToAmount: bigint; haircut: bigint } {
    if (fromAmount < 0n) {
      fromAmount = wdiv(fromAmount, WAD - this.haircutRate);
      if (this.withdrawalHaircutRate > 0n) {
        fromAmount = wdiv(fromAmount, WAD - this.withdrawalHaircutRate);
      }
    }

    let fromCash = fromAsset.cash;
    const toCash = toAsset.cash;
    let fromLiability = fromAsset.liability;
    const toLiability = toAsset.liability;

    const scaleFactor = this._quoteFactor(fromAsset, toAsset);
    if (scaleFactor !== WAD) {
      fromCash = (fromCash * scaleFactor) / WAD;
      fromLiability = (fromLiability * scaleFactor) / WAD;
      fromAmount = (fromAmount * scaleFactor) / WAD;
    }

    const idealToAmount = WombatQuoter.swapQuoteFunc(
      fromCash,
      toCash,
      fromLiability,
      toLiability,
      fromAmount,
      this.ampFactor,
    );
    if (
      (fromAmount > 0n && toCash < idealToAmount) ||
      (fromAmount < 0n && fromCash < -fromAmount)
    ) {
      throw new Error('WOMBAT_CASH_NOT_ENOUGH');
    }

    let actualToAmount, haircut;
    if (fromAmount > 0) {
      const baseHaircut = wmul(idealToAmount, this.haircutRate);
      const withdrawalHaircut =
        this.withdrawalHaircutRate > 0n
          ? wmul(idealToAmount - baseHaircut, this.withdrawalHaircutRate)
          : 0n;
      haircut = baseHaircut + withdrawalHaircut;
      actualToAmount = idealToAmount - haircut;
    } else {
      actualToAmount = idealToAmount;
      haircut = wmul(-fromAmount, this.haircutRate);
      if (this.withdrawalHaircutRate > 0n) {
        haircut += wmul(-fromAmount, this.withdrawalHaircutRate);
      }
    }

    return { actualToAmount, haircut };
  }

  private _findUpperBound(
    fromAsset: AssetState,
    toAsset: AssetState,
    toAmount: bigint,
  ): bigint {
    const decimals = BigInt(fromAsset.underlyingTokenDecimals);
    const toWadFactor = toWad(1n, decimals);
    // the search value uses the same number of digits as the token
    let high = fromWad(
      wmul(fromAsset.liability, this.endCovRatio!) - fromAsset.cash,
      decimals,
    );
    let low = 1n;

    // verify `high` is a valid upper bound
    const { actualToAmount: quote } = this._highCovRatioPoolQuoteFrom(
      fromAsset,
      toAsset,
      high * toWadFactor,
    );
    if (quote < toAmount) {
      throw new Error('WOMBAT_COV_RATIO_LIMIT_EXCEEDED');
    }

    // Note: we might limit the maximum number of rounds if the request is always rejected by the RPC server
    while (low < high) {
      const mid = (low + high) / BigInt(2);
      const { actualToAmount: quote } = this._highCovRatioPoolQuoteFrom(
        fromAsset,
        toAsset,
        mid * toWadFactor,
      );
      if (quote >= toAmount) {
        high = mid;
      } else {
        low = mid + 1n;
      }
    }
    return high * toWadFactor;
  }

  private _quoteFactor(fromAsset: AssetState, toAsset: AssetState): bigint {
    if (!fromAsset.relativePrice || !toAsset.relativePrice) {
      return WAD;
    }
    return (WAD * fromAsset.relativePrice) / toAsset.relativePrice;
  }

  static solveQuad(b: bigint, c: bigint): bigint {
    return (sqrt(b * b + c * 4n * WAD, b) - b) / 2n;
  }

  static swapQuoteFunc(
    aX: bigint,
    aY: bigint,
    lX: bigint,
    lY: bigint,
    dX: bigint,
    a: bigint,
  ): bigint {
    if (lX == 0n || lY == 0n) {
      // in case div of 0, CORE_UNDERFLOW
      return 0n;
    }

    // int256 D = Ax + Ay - A.wmul((Lx * Lx) / Ax + (Ly * Ly) / Ay); // flattened _invariantFunc
    const d = aX + aY - wmul(a, (lX * lX) / aX + (lY * lY) / aY);
    // int256 rx_ = (Ax + Dx).wdiv(Lx);
    const rX = wdiv(aX + dX, lX);
    // int256 b = (Lx * (rx_ - A.wdiv(rx_))) / Ly - D.wdiv(Ly); // flattened _coefficientFunc
    const b = (lX * (rX - wdiv(a, rX))) / lY - wdiv(d, lY);
    // int256 ry_ = _solveQuad(b, A);
    const rY = WombatQuoter.solveQuad(b, a);
    // int256 Dy = Ly.wmul(ry_) - Ay;
    const dY = wmul(lY, rY) - aY;

    // if (Dy < 0) {
    //     quote = uint256(-Dy);
    // } else {
    //     quote = uint256(Dy);
    // }
    if (dY < 0n) {
      return -dY;
    } else {
      return dY;
    }
  }
}
