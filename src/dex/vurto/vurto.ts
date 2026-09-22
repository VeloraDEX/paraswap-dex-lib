import { AsyncOrSync } from 'ts-essentials';
import BigNumber from 'bignumber.js';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
  ExchangeTxInfo,
  OptimalSwapExchange,
  PreprocessTransactionOptions,
  NumberAsString,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { VurtoData, DexParams, VurtoQuoteResponse } from './types';
import { SimpleExchange } from '../simple-exchange';
import {
  VurtoConfig,
  VURTO_PRICING_TIMEOUT_MS,
  VURTO_ROUTER_GAS,
} from './config';

/**
 * Vurto Swap, a DEX aggregator with its own settlement router.
 *
 * WHY THIS INTEGRATION DOES NOT SUBSCRIBE TO POOL EVENTS
 *
 * DexLib's usual shape is: load pool state, subscribe to events, price locally.
 * That shape assumes the integration owns the pools it prices. Vurto owns none.
 * It reads pools from several venues over RPC, ranks the candidates by what the
 * user actually receives after fee and gas, and can chain two different venues
 * inside a single transaction. Reproducing that selection here would mean
 * running a second copy of our router inside ParaSwap's process, and the two
 * copies would disagree the first time either side changed.
 *
 * So this integration prices over HTTP against our public aggregator surface,
 * the same way the RFQ-style integrations in this repo do, and settles through
 * one address per chain. There is no API key: the surface is public.
 *
 * WHAT PARASWAP GETS THAT IT DOES NOT ALREADY HAVE
 *
 * ParaSwap already integrates the individual venues Vurto reads. The route that
 * is ours and not theirs is the cross-venue two-hop: the first hop on one venue
 * and the second on another, settled atomically by our router in one call. The
 * venues do not produce it and, priced separately, neither does a per-venue
 * integration. Every quote below can come back as that route, and `data.venue`
 * says which one won.
 *
 * WHAT THE NUMBERS MEAN
 *
 * `amountOut` and `minAmountOut` from our surface are already net of our fee, so
 * the number ParaSwap ranks is the number the user receives. The minimum encoded
 * inside the calldata is the gross one our router checks before the fee comes
 * out; those two differ on purpose and must not be swapped.
 */
export class Vurto extends SimpleExchange implements IDex<VurtoData> {
  /** Our output is not linear in the input: it comes from real pool math. */
  readonly hasConstantPriceLargeAmounts = false;

  /** The router takes wrapped tokens and the native sentinel alike. */
  readonly needWrapNative = false;

  /**
   * Quoting does not model a transfer tax.
   *
   * The router itself measures every ERC-20 pull with a balanceOf before and
   * after and uses the real delta, so settlement survives such a token. The
   * PRICE would still be optimistic, and announcing support for a price we
   * cannot stand behind is worse than declining it.
   */
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(VurtoConfig);

  logger: Logger;
  private readonly params: DexParams;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.params = VurtoConfig[dexKey][network];
  }

  /** Nothing to warm: there is no local pool state behind this integration. */
  async initializePricing(_blockNumber: number): Promise<void> {}

  /** V5 adapters only. This integration is V6, which uses getDexParam. */
  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  /**
   * One identifier per chain, because there is one settlement target per chain.
   *
   * A pool-shaped identifier would be a lie here: the underlying venue is chosen
   * per quote and can differ between two calls seconds apart, which is the whole
   * point of an aggregator.
   */
  async getPoolIdentifiers(
    _srcToken: Token,
    _destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    return [this.poolIdentifier];
  }

  get poolIdentifier(): string {
    return `${this.dexKey}_${this.params.router}`.toLowerCase();
  }

  /**
   * SELL only, and the refusal is honest rather than approximate.
   *
   * Our surface quotes an exact input. A BUY would need us to invert that, and
   * an inverted aggregate quote is an estimate that the settlement would not
   * honour. Returning null costs ParaSwap nothing; returning a number we cannot
   * settle costs the user the difference.
   */
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    _blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<VurtoData>> {
    if (side === SwapSide.BUY) return null;
    if (limitPools && !limitPools.includes(this.poolIdentifier)) return null;

    const pedidos = amounts.map(async amount => {
      if (amount === 0n) return 0n;
      const cotacao = await this.cotar(srcToken, destToken, amount);
      return cotacao ? BigInt(cotacao.amountOut) : 0n;
    });

    const saidas = await Promise.all(pedidos);
    /* A pool that answered nothing for every non-zero amount is a pool that is
       not there for this pair right now, and saying so is cheaper for the
       router than a row of zeroes it has to filter. */
    if (saidas.every(v => v === 0n)) return null;

    const maior = await this.cotar(
      srcToken,
      destToken,
      amounts[amounts.length - 1],
    );

    return [
      {
        unit: await this.unidade(srcToken, destToken),
        prices: saidas,
        data: {
          exchange: this.params.router,
          calldata: maior?.tx.data ?? '0x',
          value: maior?.tx.value ?? '0',
          venue: maior?.venue ?? 'vurto',
          validUntil: maior?.validUntil ?? 0,
        },
        poolIdentifiers: [this.poolIdentifier],
        // Alvo conhecido ja na cotacao: e sempre o nosso roteador.
        targetExchange: this.params.router,
        exchange: this.dexKey,
        gasCost: Number(maior?.estimatedGas ?? VURTO_ROUTER_GAS),
        poolAddresses: [this.params.router],
      },
    ];
  }

  /** Output for one whole unit of the source token, which is what `unit` means. */
  private async unidade(srcToken: Token, destToken: Token): Promise<bigint> {
    const uma = BigInt(10) ** BigInt(srcToken.decimals);
    const cotacao = await this.cotar(srcToken, destToken, uma);
    return cotacao ? BigInt(cotacao.amountOut) : 0n;
  }

  /**
   * One quote from the aggregator surface.
   *
   * A failure here is never thrown upward: pricing runs for every DEX on every
   * request, and one source being slow or down must not fail the user's whole
   * quote. It degrades to "no price from Vurto", which is the truth.
   */
  private async cotar(
    srcToken: Token,
    destToken: Token,
    amount: bigint,
  ): Promise<VurtoQuoteResponse | null> {
    try {
      const resposta = await this.dexHelper.httpRequest.post<VurtoQuoteResponse>(
        `${this.params.gateway}/quote`,
        {
          chainId: this.network,
          tokenIn: srcToken.address,
          tokenOut: destToken.address,
          amountRaw: amount.toString(),
          slippageBps: 100,
          taker: this.augustusAddress,
        },
        VURTO_PRICING_TIMEOUT_MS,
      );
      if (!resposta?.amountOut || !resposta?.tx?.data) return null;
      return resposta;
    } catch (e) {
      this.logger.warn(`${this.dexKey}: quote failed`, e);
      return null;
    }
  }

  /**
   * The calldata is rebuilt here, and that is the point of this hook.
   *
   * A quote priced seconds ago carries a minimum that was computed against the
   * pool state of that moment. Reusing its calldata at settlement is how an
   * aggregator ships a transaction that reverts. This asks our surface once more,
   * with the real recipient and the real slippage, and settles on THAT.
   */
  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<VurtoData>,
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<VurtoData>, ExchangeTxInfo]> {
    if (side === SwapSide.BUY) {
      throw new Error(`${this.dexKey}: BUY is not supported`);
    }

    const slippageBps = Math.round(
      new BigNumber(1)
        .minus(options.slippageFactor)
        .multipliedBy(10_000)
        .toNumber(),
    );

    const fresca = await this.dexHelper.httpRequest.post<VurtoQuoteResponse>(
      `${this.params.gateway}/build`,
      {
        chainId: this.network,
        tokenIn: srcToken.address,
        tokenOut: destToken.address,
        amountRaw: optimalSwapExchange.srcAmount,
        slippageBps: slippageBps > 0 ? slippageBps : 100,
        taker: options.executionContractAddress,
        receiver: options.recipient,
      },
      VURTO_PRICING_TIMEOUT_MS,
    );

    if (!fresca?.tx?.data) {
      throw new Error(`${this.dexKey}: build returned no calldata`);
    }

    return [
      {
        ...optimalSwapExchange,
        data: {
          exchange: this.params.router,
          calldata: fresca.tx.data,
          value: fresca.tx.value,
          venue: fresca.venue,
          validUntil: fresca.validUntil,
        },
      },
      { deadline: BigInt(fresca.validUntil) },
    ];
  }

  getCalldataGasCost(_poolPrices: PoolPrices<VurtoData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  /** V5 only, and this integration does not ship a V5 adapter. */
  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    _data: VurtoData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    throw new Error(`${this.dexKey}: V5 adapters are not supported`);
  }

  /**
   * Target and spender are the same address, always, and that is deliberate.
   *
   * The router pulls the token, approves the venue for exactly what arrived,
   * calls it, revokes that approval and only then checks the output against the
   * minimum. The venue's own router never appears as a target, which is what
   * lets one allowlist entry per chain cover every route we can ever produce.
   */
  async getDexParam(
    _srcToken: Address,
    _destToken: Address,
    _srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    data: VurtoData,
    _side: SwapSide,
    _executorAddress: Address,
  ): Promise<DexExchangeParam> {
    if (!data.calldata || data.calldata === '0x') {
      throw new Error(`${this.dexKey}: no calldata, preProcessTransaction must run first`);
    }
    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: data.calldata,
      targetExchange: data.exchange,
      spender: data.exchange,
      returnAmountPos: undefined,
    };
  }

  async updatePoolState(): Promise<void> {}

  /**
   * Deliberately empty, and this is not a stub left behind.
   *
   * This method exists so ParaSwap can find the most liquid pools of a venue by
   * subgraph. Vurto has no pools and no subgraph: the liquidity it routes
   * against belongs to Uniswap, SushiSwap, PancakeSwap, Aerodrome and QuickSwap,
   * which this repository already indexes on their own. Reporting their
   * liquidity as ours would double-count it in the connector search.
   */
  async getTopPoolsForToken(
    _tokenAddress: Address,
    _limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
  }

  releaseResources(): AsyncOrSync<void> {}
}
