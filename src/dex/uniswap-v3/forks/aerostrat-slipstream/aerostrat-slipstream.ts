import _ from 'lodash';
import { Interface } from '@ethersproject/abi';
import { BPS_MAX_VALUE, Network, SwapSide } from '../../../../constants';
import { IDexHelper } from '../../../../dex-helper';
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
import { booleanDecode, uint256ToBigInt } from '../../../../lib/decoders';
import { applyTransferFee } from '../../../../lib/token-transfer-fee';
import { getLocalDeadlineAsFriendlyPlaceholder } from '../../../simple-exchange';
import AerostratRouterABI from '../../../../abi/aerostrat/AerostratRouter.abi.json';
import AerostratTokenABI from '../../../../abi/aerostrat/AerostratToken.abi.json';
import * as CALLDATA_GAS_COST from '../../../../calldata-gas-cost';
import { PoolState } from '../../types';
import { UniswapV3EventPool } from '../../uniswap-v3-pool';
import { Adapters, UniswapV3Config } from '../../config';
import {
  VelodromeSlipstream,
  VelodromeSlipstreamData,
} from '../velodrome-slipstream/velodrome-slipstream';

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
 *     (1 - tax) of the pool's output. The stock router can execute this, but the
 *     pool has to be asked for the grossed-up amount, both when quoting and when
 *     encoding an exact-output swap.
 *
 * The tax rate is read from the token rather than supplied by the caller,
 * because it is governed on-chain and can move.
 */
const AEROSTRAT_DECIMALS = 18;

// Page requested from the subgraph before filtering down to the taxed pool.
const TOP_POOLS_SEARCH_COUNT = 20;

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

  /*
   * Quotable means: a rate has been read, it is usable, and it is recent.
   * At BPS_MAX_VALUE the router's calculateAmountToCharge divides by zero and
   * above it the token underflows on every taxed transfer; and a rate that
   * could not be refreshed is no more trustworthy than a guessed one, so it
   * expires. Refuse to quote rather than emit a route that cannot be filled.
   */
  private isQuotable(): boolean {
    // At BPS_MAX_VALUE the router's calculateAmountToCharge divides by zero and
    // above it the token underflows on every taxed transfer.
    return this.taxBps !== undefined && this.taxBps < BPS_MAX_VALUE;
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

    // Deliberately unconditional: the parent refreshes pool fees only on the
    // slave branch, and copying that would leave a master node serving a tax
    // rate frozen at boot. The parent's own fee refresh keeps its slave-only
    // behaviour, so on a master the pool fee is still the boot value - that is
    // pre-existing and unchanged by this key.
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

  /*
   * The config carries the full AerodromeSlipstreamNewFactory subgraph, so the
   * inherited implementation would advertise every Aerodrome pool as belonging
   * to this dexKey - each of which then resolves to no pool identifiers. Only
   * the taxed pair is ours.
   */
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
  ): Promise<null | ExchangePrices<VelodromeSlipstreamData>> {
    if (!this.isSupportedSwap(srcToken.address, destToken.address, side)) {
      return null;
    }

    const taxOnPoolInput = this.isTaxedToken(srcToken.address);

    /*
     * Snapshot the rate once. The refresh interval can fire during the await
     * below, and a quote whose amounts, prices and recorded rate came from
     * different rates would be internally inconsistent - getDexParam trusts the
     * recorded one to size the swap.
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
     * Belt and braces over the getPool guard. The parent writes a pool into
     * this.eventPools inside _initPool before this fork can reject it, and its
     * limitPools branch returns that cache entry directly without calling
     * getPool - so a caller-supplied identifier naming another tickSpacing of
     * the same pair could otherwise be priced here with a tax that does not
     * apply to it. Filtering the results covers every branch the parent takes.
     */
    const taxedPool = this.config.taxedPool!.toLowerCase();
    const owned = results.filter(
      result => result.poolAddresses?.[0]?.toLowerCase() === taxedPool,
    );

    if (owned.length === 0) return null;

    return owned.map(result => ({
      ...result,
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

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: VelodromeSlipstreamData,
    side: SwapSide,
    executorAddress?: Address,
    options?: GetDexParamOptions,
  ): DexExchangeParam {
    if (!this.isTaxedToken(srcToken)) {
      // Buys execute through the stock Aerodrome router. On an exact-output buy
      // the pool's outgoing transfer is taxed, so the pool has to be asked for
      // more than the user is to receive - otherwise it emits exactly the
      // requested amount, the recipient is handed ~10% less, and Augustus's
      // final received >= toAmount check reverts the whole swap.
      /*
       * On an exact-output buy destAmount is what the user must end up with,
       * but the router asks the pool for it and the pool's outgoing transfer is
       * taxed - so the pool has to be asked for the grossed-up amount.
       *
       * Only BUY: the caller builds every SELL leg with destAmount '1'
       * (generic-swap-transaction-builder), so there is no leg-level bound to
       * adjust on that side. The user's actual protection on both sides is
       * Augustus checking the received balance once at route level, which is
       * post-tax and therefore already correct.
       */
      const poolDestAmount =
        side === SwapSide.BUY && this.isTaxedToken(destToken)
          ? this.applyTax(
              [BigInt(destAmount)],
              SwapSide.BUY,
              this.taxBps!,
            )[0].toString()
          : destAmount;

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

    // Assertions of last resort. A throw here rejects the whole transaction
    // build, not just this leg, so the pricing guards above must make these
    // unreachable.
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

  /*
   * The rate a route was priced at, not the current one. A refresh between
   * quoting and building would otherwise size the swap against a rate the quote
   * never used.
   */
  getCalldataGasCost(
    poolPrices: PoolPrices<VelodromeSlipstreamData>,
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
   * be reached. The throws below cover the remaining paths, all of which would
   * otherwise encode this.config.router - the stock Aerodrome router - with
   * untaxed amounts.
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
