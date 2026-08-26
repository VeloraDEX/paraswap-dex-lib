import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import { BPS_MAX_VALUE, Network, SwapSide } from '../../../../constants';
import {
  Address,
  DexExchangeParam,
  ExchangePrices,
  GetDexParamOptions,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
} from '../../../../types';
import { getDexKeysWithNetwork } from '../../../../utils';
import { extractReturnAmountPosition } from '../../../../executor/utils';
import { uint256ToBigInt } from '../../../../lib/decoders';
import { applyTransferFee } from '../../../../lib/token-transfer-fee';
import { getLocalDeadlineAsFriendlyPlaceholder } from '../../../simple-exchange';
import AerostratRouterABI from '../../../../abi/aerostrat/AerostratRouter.abi.json';
import AerostratTokenABI from '../../../../abi/aerostrat/AerostratToken.abi.json';
import * as CALLDATA_GAS_COST from '../../../../calldata-gas-cost';
import { UniswapV3Config } from '../../config';
import {
  VelodromeSlipstream,
  VelodromeSlipstreamData,
} from '../velodrome-slipstream/velodrome-slipstream';

export type AerostratSlipstreamData = VelodromeSlipstreamData & {
  // The rate this route was priced at. Carried because the instance building the
  // transaction need not be the one that priced it, and only initializePricing
  // populates the live rate.
  taxBps?: NumberAsString;
};

/*
 * AEROSTRAT charges a transfer tax whenever one side of a transfer is on the
 * token's taxlist. Its AERO pool is taxlisted, so:
 *
 *   - selling, only (1 - tax) of the input ever reaches the pool. The stock
 *     Aerodrome router cannot do this at all: it pays the pool the full
 *     amount0Delta, 10% evaporates in transit, and the pool's
 *     `balance0Before + amount0 <= balance0()` check reverts. Sells therefore
 *     go through AEROSTRATRouter, which swaps the post-tax amount and grosses
 *     the charge back up in the swap callback.
 *   - buying, the pool's outgoing transfer is taxed, so the recipient receives
 *     (1 - tax) of the pool's output. The stock router executes this, but the
 *     quote has to account for the tax, and an exact-output swap has to ask the
 *     pool for the grossed-up amount.
 *
 * The tax rate is read from the token rather than supplied by the caller,
 * because it is governed on-chain and can move.
 */
export class AerostratSlipstream extends VelodromeSlipstream {
  /*
   * Declared so pricing-helper does not drop this dexKey when the backend flags
   * AEROSTRAT as fee-on-transfer. The on-chain getCurrentFee() is authoritative
   * here; any caller-supplied transferFees for AEROSTRAT would be the same rate
   * and is deliberately not applied a second time.
   */
  readonly isFeeOnTransferSupported: boolean = true;

  private static readonly TAX_REFRESH_INTERVAL_MS = 60 * 1000;

  // Extra gas over the stock router: the getCurrentFee() call plus the
  // gross-up arithmetic in the swap callback.
  private static readonly SELL_ROUTER_GAS_OVERHEAD = 15_000;

  // Undefined until a successful read. Never seeded with a guess: quoting with
  // an assumed tax would misprice every route if the real rate differs.
  private taxBps?: bigint;

  private taxUpdateIntervalTask?: NodeJS.Timeout;

  private readonly taxedTokenIface = new Interface(AerostratTokenABI);
  private readonly taxedRouterIface = new Interface(AerostratRouterABI);

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(UniswapV3Config, ['AerostratSlipstream']));

  private get taxedToken(): Address {
    return this.config.taxedToken!;
  }

  private isTaxedToken(tokenAddress: Address): boolean {
    return tokenAddress.toLowerCase() === this.taxedToken.toLowerCase();
  }

  private isQuotable(): boolean {
    return this.inRangeTax(this.taxBps) !== undefined;
  }

  private applyTax(
    amounts: bigint[],
    side: SwapSide,
    taxBps: bigint,
  ): bigint[] {
    return applyTransferFee(amounts, side, Number(taxBps), 1);
  }

  protected async updateTax(): Promise<void> {
    try {
      const [result] = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        [
          {
            target: this.taxedToken,
            callData: this.taxedTokenIface.encodeFunctionData('getCurrentFee'),
            decodeFunction: uint256ToBigInt,
          },
        ],
      );

      if (!result.success) {
        this.logger.warn(
          `${this.dexKey}: failed to read getCurrentFee, keeping ${this.taxBps}`,
        );
        return;
      }

      this.taxBps = result.returnData;
    } catch (error) {
      this.logger.error(`${this.dexKey}: error updating tax:`, error);
    }
  }

  async initializePricing(blockNumber: number) {
    await Promise.all([super.initializePricing(blockNumber), this.updateTax()]);

    clearInterval(this.taxUpdateIntervalTask);

    // Not folded into the parent's fee refresh: that is slave-gated and
    // early-returns while eventPools is empty, and seeding the rate there would
    // deadlock - no rate means isQuotable() is false, so no pool is ever
    // discovered, so the refresh keeps early-returning.
    this.taxUpdateIntervalTask = setInterval(
      this.updateTax.bind(this),
      AerostratSlipstream.TAX_REFRESH_INTERVAL_MS,
    );
  }

  releaseResources() {
    super.releaseResources();

    if (this.taxUpdateIntervalTask !== undefined) {
      clearInterval(this.taxUpdateIntervalTask);
      this.taxUpdateIntervalTask = undefined;
    }
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    /*
     * Not gated on isQuotable(): pool tracking runs on a service instance that
     * never calls initializePricing, so the rate is never populated there.
     *
     * Only the taxed pair belongs to this key - the config carries the whole
     * AerodromeSlipstreamNewFactory subgraph, and every other pool it lists
     * would resolve to no identifiers here.
     */
    if (!this.isTaxedToken(tokenAddress)) return [];

    const taxedPool = this.config.taxedPool!.toLowerCase();
    return (await super.getTopPoolsForToken(tokenAddress, limit)).filter(
      pool => pool.address.toLowerCase() === taxedPool,
    );
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.isSupportedSwap(srcToken.address, destToken.address, side)) {
      return [];
    }

    return super.getPoolIdentifiers(srcToken, destToken, side, blockNumber);
  }

  /*
   * BUY with AEROSTRAT as input is unsupported: AEROSTRATRouter only exposes an
   * exact-input entry point, so an exact-output sell cannot be encoded.
   */
  private isSupportedSwap(
    srcAddress: Address,
    destAddress: Address,
    side: SwapSide,
  ): boolean {
    if (!this.isQuotable()) return false;

    const srcIsAerostrat = this.isTaxedToken(srcAddress);
    const destIsAerostrat = this.isTaxedToken(destAddress);

    if (!srcIsAerostrat && !destIsAerostrat) return false;
    if (srcIsAerostrat && side === SwapSide.BUY) return false;

    return true;
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<AerostratSlipstreamData>> {
    if (!this.isSupportedSwap(srcToken.address, destToken.address, side)) {
      return null;
    }

    const taxOnPoolInput = this.isTaxedToken(srcToken.address);

    /*
     * Snapshot the rate once. The refresh interval can fire during the await
     * below, and amounts and prices computed against different rates would make
     * a single quote internally inconsistent.
     */
    const taxBps = this.taxBps!;

    const results = await super.getPricesVolume(
      srcToken,
      destToken,
      this.toPoolAmounts(amounts, side, taxOnPoolInput, taxBps),
      side,
      blockNumber,
      limitPools,
    );

    if (!results) return null;

    /*
     * A results filter rather than a pool-lookup override: the parent caches a
     * pool in _initPool before an override could reject it, and its limitPools
     * branch returns that cache entry directly - so a caller-supplied identifier
     * naming another tickSpacing of the same pair could otherwise be priced here
     * with a tax that does not apply to it. Filtering the results covers every
     * branch the parent takes.
     */
    const taxedPool = this.config.taxedPool!.toLowerCase();
    const owned = results.filter(
      result => result.poolAddresses?.[0]?.toLowerCase() === taxedPool,
    );

    if (owned.length === 0) return null;

    return owned.map(result => ({
      ...result,
      data: { ...result.data, taxBps: taxBps.toString() },
      // Scaled rather than re-priced: unit is a ranking heuristic on a single
      // token, where the curve is linear to well under a basis point.
      unit: this.toUserPrices(
        this.toPoolAmounts([result.unit], side, taxOnPoolInput, taxBps),
        side,
        taxOnPoolInput,
        taxBps,
      )[0],
      prices: this.toUserPrices(result.prices, side, taxOnPoolInput, taxBps),
      gasCost: this.addRouterOverhead(result.gasCost, taxOnPoolInput),
    }));
  }

  async getPricingFromRpc(): Promise<null> {
    return null;
  }

  /*
   * amounts and prices mean different things per side:
   *   SELL: amounts = src in,   prices = dest out
   *   BUY:  amounts = dest out, prices = src in
   * The tax lands on the AEROSTRAT side, so the transform follows which side of
   * the pool AEROSTRAT sits on rather than the swap side.
   */
  private toPoolAmounts(
    amounts: bigint[],
    side: SwapSide,
    taxOnPoolInput: boolean,
    taxBps: bigint,
  ): bigint[] {
    if (taxOnPoolInput) return this.applyTax(amounts, SwapSide.SELL, taxBps);
    if (side === SwapSide.BUY)
      return this.applyTax(amounts, SwapSide.BUY, taxBps);
    return amounts;
  }

  private toUserPrices(
    prices: bigint[],
    side: SwapSide,
    taxOnPoolInput: boolean,
    taxBps: bigint,
  ): bigint[] {
    if (!taxOnPoolInput && side === SwapSide.SELL) {
      return this.applyTax(prices, SwapSide.SELL, taxBps);
    }
    return prices;
  }

  private addRouterOverhead(
    gasCost: number | number[],
    taxOnPoolInput: boolean,
  ) {
    if (!taxOnPoolInput) return gasCost;

    const overhead = AerostratSlipstream.SELL_ROUTER_GAS_OVERHEAD;

    if (typeof gasCost === 'number') return gasCost + overhead;

    // Zero entries mark amounts that could not be priced; leave them at zero.
    return gasCost.map(cost => (cost === 0 ? cost : cost + overhead));
  }

  /*
   * A route carrying no rate - one priced before this field existed - falls back
   * to the live one. A malformed rate does not: the quote was made against some
   * rate, and sizing the swap with a different one is worse than refusing to.
   */
  private pricedTaxBps(data: AerostratSlipstreamData): bigint | undefined {
    const recorded = data.taxBps;

    if (recorded === undefined) return this.inRangeTax(this.taxBps);

    // Digits only. BigInt(''), BigInt([]) and BigInt(false) are all 0n, which a
    // range check cannot tell apart from a genuine zero-tax route, and BigInt
    // throws outright on anything else non-numeric.
    if (typeof recorded !== 'string' || !/^\d{1,5}$/.test(recorded)) {
      // Only a value already known to be a string is interpolated. JSON.stringify
      // and String() both recurse, so either would blow the stack on a deeply
      // nested array - inside the one function here that must not throw.
      this.logger.warn(
        `${this.dexKey}: unusable taxBps on route: ${
          typeof recorded === 'string' ? recorded.slice(0, 32) : typeof recorded
        }`,
      );
      return undefined;
    }

    return this.inRangeTax(BigInt(recorded));
  }

  /*
   * At BPS_MAX_VALUE the router's calculateAmountToCharge divides by zero, and
   * above it the token underflows on every taxed transfer - so a rate at or
   * over the bound is refused rather than quoted or encoded. Returns the rate
   * itself, so callers must test against undefined: zero is a valid rate.
   */
  private inRangeTax(taxBps?: bigint): bigint | undefined {
    return taxBps !== undefined && taxBps < BPS_MAX_VALUE ? taxBps : undefined;
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: AerostratSlipstreamData,
    side: SwapSide,
    executorAddress?: Address,
    options?: GetDexParamOptions,
  ): DexExchangeParam {
    if (!this.isTaxedToken(srcToken)) {
      /*
       * Buys execute through the stock Aerodrome router. On an exact-output buy
       * the pool's outgoing transfer is taxed, so it must be asked for the
       * grossed-up amount at the rate the route was priced at - otherwise it
       * emits exactly what was requested and the recipient is handed ~10% less.
       *
       * Only BUY: every SELL leg is built with destAmount '1'
       * (generic-swap-transaction-builder), so there is no leg-level bound to
       * adjust there. Either way the real protection is the route-level
       * received >= toAmount check, which is post-tax and already correct.
       */
      let poolDestAmount = destAmount;

      if (side === SwapSide.BUY && this.isTaxedToken(destToken)) {
        const taxBps = this.pricedTaxBps(data);

        if (taxBps === undefined) {
          // Encoding it ungrossed would return a transaction certain to revert:
          // a BUY leg has no slippage buffer, so the shortfall always trips the
          // route-level check and the caller pays gas to find out. Failing the
          // build loses them the rest of this route, but no gas.
          throw new Error(
            `${this.dexKey}: no usable tax rate to size an exact-output buy`,
          );
        }

        poolDestAmount = this.applyTax(
          [BigInt(destAmount)],
          SwapSide.BUY,
          taxBps,
        )[0].toString();
      }

      const param = super.getDexParam(
        srcToken,
        destToken,
        srcAmount,
        poolDestAmount,
        recipient,
        data,
        side,
        executorAddress,
        options,
      );

      /*
       * The router returns the pool's output, but the pool's outgoing transfer
       * is taxed, so the recipient receives ~10% less than that. Reading the
       * return value would overstate what actually arrived; force the executor
       * to measure the balance instead, as the other fee-on-transfer
       * integration in this repo does.
       */
      return this.isTaxedToken(destToken)
        ? { ...param, returnAmountPos: undefined }
        : param;
    }

    // A throw here rejects the caller's whole transaction build, not just this
    // leg, so the pricing guards make these unreachable for any route this key
    // priced. The exception is the missing-rate throw above, which is reachable
    // from tampered or pre-field route data by design.
    if (side !== SwapSide.SELL) {
      throw new Error(
        `${this.dexKey}: BUY with AEROSTRAT input is unsupported`,
      );
    }
    const tickSpacing = data.path[0]?.tickSpacing;
    if (
      tickSpacing !== undefined &&
      !this.config.tickSpacings!.includes(BigInt(tickSpacing))
    ) {
      throw new Error(`${this.dexKey}: unsupported tickSpacing ${tickSpacing}`);
    }
    if (data.path.length !== 1 || tickSpacing === undefined) {
      throw new Error(
        `${this.dexKey}: sell requires a single hop with a known tickSpacing`,
      );
    }

    const exchangeData = this.taxedRouterIface.encodeFunctionData(
      'exactInputSellAEROSTRAT',
      [
        {
          tokenIn: srcToken,
          tokenOut: destToken,
          tickSpacing,
          recipient,
          deadline: getLocalDeadlineAsFriendlyPlaceholder(
            options?.nowTimestampMs,
          ),
          // Pre-tax on purpose: the router applies the tax itself.
          amountIn: srcAmount,
          amountOutMinimum: destAmount,
          sqrtPriceLimitX96: 0,
        },
      ],
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: this.config.taxedRouter!,
      returnAmountPos: extractReturnAmountPosition(
        this.taxedRouterIface,
        'exactInputSellAEROSTRAT',
        'amountOut',
      ),
      /*
       * amountIn is the sixth field of an all-static tuple: 4 selector bytes
       * plus five words. Pinning it stops the executor scanning the calldata
       * for the quoted value, which could otherwise match tickSpacing or the
       * deadline on a small enough amount.
       */
      insertFromAmountPos: 4 + 5 * 32,
    };
  }

  getCalldataGasCost(
    poolPrices: PoolPrices<AerostratSlipstreamData>,
  ): number | number[] {
    if (!this.isTaxedToken(poolPrices.data.path[0]?.tokenIn ?? '')) {
      return super.getCalldataGasCost(poolPrices);
    }

    const cost =
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      // tokenIn, tokenOut, recipient. Every field of the router's params tuple
      // is static, so it is encoded inline with no offset word.
      CALLDATA_GAS_COST.ADDRESS * 3 +
      // tickSpacing, one non-zero byte at the configured spacings
      CALLDATA_GAS_COST.wordNonZeroBytes(1) +
      CALLDATA_GAS_COST.TIMESTAMP +
      // amountIn, amountOutMinimum
      CALLDATA_GAS_COST.AMOUNT * 2 +
      // sqrtPriceLimitX96, always zero
      CALLDATA_GAS_COST.ZERO;

    // Must mirror the shape of gasCost, which is a per-amount array with zeros
    // for unpriceable amounts. pricing-helper throws and discards the whole
    // quote if the two disagree.
    return poolPrices.prices.map(price => (price === 0n ? 0 : cost));
  }

  /*
   * getAdapters() returning null is the gate that keeps the V5 adapter path from
   * ever selecting this key; PayloadEncoder throws before getAdapterParam could
   * be reached. The empty direct-function lists de-advertise the direct paths,
   * and getSimpleParam below throws. Between them they cover every remaining
   * route that would otherwise encode this.config.router - the stock Aerodrome
   * router - with untaxed amounts.
   */
  getAdapters() {
    return null;
  }

  static getDirectFunctionName(): string[] {
    return [];
  }

  static getDirectFunctionNameV6(): string[] {
    return [];
  }

  async getSimpleParam(): Promise<SimpleExchangeParam> {
    return this.unsupported('V5 simple swap');
  }

  private unsupported(what: string): never {
    throw new Error(`${this.dexKey}: ${what} is not supported`);
  }
}
