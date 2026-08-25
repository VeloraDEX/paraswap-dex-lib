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
  SimpleExchangeParam,
  Token,
} from '../../../../types';
import {
  getBigIntPow,
  getDexKeysWithNetwork,
  isTruthy,
} from '../../../../utils';
import { extractReturnAmountPosition } from '../../../../executor/utils';
import { uint256ToBigInt } from '../../../../lib/decoders';
import { applyTransferFee } from '../../../../lib/token-transfer-fee';
import { getLocalDeadlineAsFriendlyPlaceholder } from '../../../simple-exchange';
import AerostratRouterABI from '../../../../abi/aerostrat/AerostratRouter.abi.json';
import AerostratTokenABI from '../../../../abi/aerostrat/AerostratToken.abi.json';
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

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
  ) {
    super(network, dexKey, dexHelper, adapters);
  }

  private get taxedToken(): Address {
    return this.config.taxedToken!;
  }

  private isAerostrat(tokenAddress: Address): boolean {
    return tokenAddress.toLowerCase() === this.taxedToken.toLowerCase();
  }

  /*
   * A tax of BPS_MAX_VALUE or more makes the router's calculateAmountToCharge divide by
   * zero, and above BPS the token itself underflows on every taxed transfer.
   * Refuse to quote rather than emit a route that cannot be filled.
   */
  private isQuotable(): boolean {
    return this.taxBps !== undefined && this.taxBps < BPS_MAX_VALUE;
  }

  private applyTax(amounts: bigint[], side: SwapSide): bigint[] {
    return applyTransferFee(amounts, side, Number(this.taxBps!), 1);
  }

  protected async updateTax(): Promise<void> {
    try {
      const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        [
          {
            target: this.taxedToken,
            callData: this.taxedTokenIface.encodeFunctionData('getCurrentFee'),
            decodeFunction: uint256ToBigInt,
          },
        ],
      );

      if (!results[0].success) {
        this.logger.warn(
          `${this.dexKey}: failed to read getCurrentFee, keeping ${this.taxBps}`,
        );
        return;
      }

      this.taxBps = results[0].returnData;
    } catch (error) {
      this.logger.error(`${this.dexKey}: error updating tax:`, error);
    }
  }

  async initializePricing(blockNumber: number) {
    await Promise.all([super.initializePricing(blockNumber), this.updateTax()]);

    // Deliberately unconditional. The parent refreshes pool fees only on the
    // slave branch; copying that would leave a master node serving a tax rate
    // frozen at boot.
    clearInterval(this.taxUpdateIntervalTask);
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
    const pools = await super.getTopPoolsForToken(tokenAddress, limit);

    if (this.isAerostrat(tokenAddress)) return pools;

    return pools.filter(pool =>
      pool.connectorTokens.some(token => this.isAerostrat(token.address)),
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

    const srcIsAerostrat = this.isAerostrat(srcAddress);
    const destIsAerostrat = this.isAerostrat(destAddress);

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

    const taxOnPoolInput = this.isAerostrat(srcToken.address);

    const results = await super.getPricesVolume(
      srcToken,
      destToken,
      this.toPoolAmounts(amounts, side, taxOnPoolInput),
      side,
      blockNumber,
      limitPools,
    );

    if (!results) return null;

    return results.map(result => ({
      ...result,
      unit: this.toUserPrices([result.unit], side, taxOnPoolInput)[0],
      prices: this.toUserPrices(result.prices, side, taxOnPoolInput),
      gasCost: this.addRouterOverhead(result.gasCost, taxOnPoolInput),
    }));
  }

  // Priced on the same basis as the amounts, in the parent's existing pass.
  protected getUnitAmount(
    side: SwapSide,
    srcToken: Token,
    destToken: Token,
  ): bigint {
    return this.toPoolAmounts(
      [super.getUnitAmount(side, srcToken, destToken)],
      side,
      this.isAerostrat(srcToken.address),
    )[0];
  }

  /*
   * The quoter prices the pool untaxed, and RPC results carry no tickSpacing for
   * the sell calldata, so this key must never fall back to it.
   */
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
  ): bigint[] {
    if (taxOnPoolInput) return this.applyTax(amounts, SwapSide.SELL);
    if (side === SwapSide.BUY) return this.applyTax(amounts, SwapSide.BUY);
    return amounts;
  }

  private toUserPrices(
    prices: bigint[],
    side: SwapSide,
    taxOnPoolInput: boolean,
  ): bigint[] {
    if (!taxOnPoolInput && side === SwapSide.SELL) {
      return this.applyTax(prices, SwapSide.SELL);
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
    // Assertions of last resort. A throw here rejects the whole transaction
    // build, not just this leg, so the pricing guards must make them unreachable.
    if (!this.isQuotable()) {
      throw new Error(
        `${this.dexKey}: transfer tax is unknown or out of range`,
      );
    }

    if (!this.isAerostrat(srcToken)) {
      // Buys execute through the stock Aerodrome router. On an exact-output buy
      // the pool's outgoing transfer is taxed, so the pool has to be asked for
      // more than the user is to receive - otherwise it emits exactly the
      // requested amount, the recipient is handed ~10% less, and Augustus's
      // final received >= toAmount check reverts the whole swap.
      const poolDestAmount =
        side === SwapSide.BUY && this.isAerostrat(destToken)
          ? this.applyTax([BigInt(destAmount)], SwapSide.BUY)[0].toString()
          : destAmount;

      return super.getDexParam(
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
    };
  }

  /*
   * Everything below encodes this.config.router - the stock Aerodrome router -
   * with untaxed amounts. Base has a non-null adapter mapping, so these paths go
   * live the moment the dexKey is registered. Throwing is the real gate: the
   * direct-method name list is global across Dex classes, so a static override
   * there would remove nothing.
   */
  getAdapters() {
    return null;
  }

  async getSimpleParam(): Promise<SimpleExchangeParam> {
    return this.unsupported('V5 simple swap');
  }

  getDirectParam(): never {
    return this.unsupported('direct swaps');
  }

  getDirectParamV6(): never {
    return this.unsupported('direct swaps');
  }

  private unsupported(what: string): never {
    throw new Error(`${this.dexKey}: ${what} is not supported`);
  }
}
