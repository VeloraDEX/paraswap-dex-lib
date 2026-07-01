import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  NumberAsString,
  ExchangePrices,
  PoolPrices,
  PoolLiquidity,
  AdapterExchangeParam,
  DexExchangeParam,
  Logger,
} from '../../types';
import { Network, NULL_ADDRESS, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  addressDecode,
  uint256ToBigInt,
  uint8ToNumber,
} from '../../lib/decoders';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BaselineData, QuoteResult, QuoteState } from './types';
import { SimpleExchange } from '../simple-exchange';
import { BaselineConfig } from './config';
import { BaselineEventPool } from './baseline-pool';
import {
  quoteBuyExactIn,
  quoteBuyExactOut,
  quoteSellExactIn,
} from './baseline-curve';

// Execution-gas estimates per relay swap function, measured via forge gas
// reports and Tenderly simulations against the live pools (medians, rounded
// up; the first swap of a block pays extra for the snapshot commit).
// buyTokensExactIn is far costlier: it runs a binary-search solver on-chain.
const SELL_EXACT_IN_GAS_COST = 190_000;
const BUY_EXACT_IN_GAS_COST = 450_000;
const BUY_EXACT_OUT_GAS_COST = 210_000;

// Discovery pulls the full bToken set from the subgraph, paginated.
const DISCOVERY_TIMEOUT = 5000;
const DISCOVERY_PAGE_SIZE = 500;

type QuoteFn = (state: QuoteState, amount: bigint) => QuoteResult;

type BTokenItem = {
  address: string;
  decimals: number;
  reserve: { address: string; decimals: number };
};

// A discovered pool: its bToken and reserve, with both token decimals.
type PoolInfo = {
  bToken: Address;
  bTokenDecimals: number;
  reserve: Address;
  reserveDecimals: number;
};

/*
  Baseline (Mercury) is a power-law AMM with block-batched pricing. Each pool's
  full pricing state is fetched from the relay's getQuoteState view into an event
  subscriber; prices are then computed locally from that cached state, with no RPC
  on the pricing path. A pool is identified by its bToken; the counter-asset is the
  bToken's reserve.
*/
export class Baseline extends SimpleExchange implements IDex<BaselineData> {
  readonly hasConstantPriceLargeAmounts = false;
  // The relay's native-ETH support is partial: only buyTokensExactOut is payable
  // and outputs are always the wrapped ERC20 (handleOutgoing never unwraps), so
  // sending value would revert buyTokensExactIn and strand WETH on ETH-dest
  // routes. Wrapping in the executor covers every direction uniformly.
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BaselineConfig);

  logger: Logger;

  readonly relay: Address;
  readonly subgraphURL: string;

  // bToken (lowercased) -> discovered pool metadata.
  private readonly registry: Record<string, PoolInfo> = {};
  // bToken (lowercased) -> event subscriber holding that pool's state.
  private readonly pools: Record<string, BaselineEventPool> = {};
  // In-flight lazy subscriber initializations, keyed by lowercased bToken.
  private readonly poolInitPromises: Record<
    string,
    Promise<BaselineEventPool | null>
  > = {};
  // Guards a single registry load shared across concurrent callers.
  private registryPromise?: Promise<void>;

  // Shared interface instances, reused across calls.
  readonly relayIface = new Interface([
    'function reserve(address) view returns (address)',
    'function totalReserves(address) view returns (uint256)',
  ]);
  // State-changing swap calls encoded into Augustus. The relay pulls the input
  // via approval and sends output to the caller (no recipient arg).
  readonly relaySwapIface = new Interface([
    'function sellTokensExactIn(address,uint256,uint256) returns (uint256 amountOut_, uint256 feesReceived_)',
    'function buyTokensExactIn(address,uint256,uint256) returns (uint256 amountOut_, uint256 feesReceived_)',
    'function buyTokensExactOut(address,uint256,uint256) returns (uint256 amountIn_, uint256 feesReceived_)',
  ]);

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.relay = BaselineConfig[dexKey][network].relay;
    this.subgraphURL = BaselineConfig[dexKey][network].subgraphURL;
  }

  // Discover the chain's pools so pricing can resolve any of them.
  async initializePricing(_blockNumber: number): Promise<void> {
    await this.ensureRegistry();
  }

  // Populate the pool registry once, shared across concurrent callers. Discovery
  // comes from the subgraph; configured priority pools are resolved on-chain so
  // they remain tracked even when the subgraph is unavailable.
  private async ensureRegistry(): Promise<void> {
    if (!this.registryPromise) this.registryPromise = this.loadRegistry();
    return this.registryPromise;
  }

  private async loadRegistry(): Promise<void> {
    let discovered = false;
    try {
      for (const p of await this.discoverPools()) {
        this.register(p);
      }
      discovered = true;
    } catch (e) {
      this.logger.error(`${this.dexKey}: pool discovery failed`, e);
    }
    let preloaded = false;
    try {
      await this.preloadConfigured();
      preloaded = true;
    } catch (e) {
      this.logger.error(`${this.dexKey}: pool preload failed`, e);
    }
    // With both sources down the registry is empty for the process lifetime
    // unless retried: clear the cached promise so the next caller reloads, and
    // throw so the framework's initializePricing retry timer fires.
    if (!discovered && !preloaded) {
      this.registryPromise = undefined;
      throw new Error(`${this.dexKey}: registry load failed`);
    }
  }

  // Every bToken and its reserve for this chain, paged out of the subgraph.
  private async discoverPools(): Promise<PoolInfo[]> {
    if (!this.subgraphURL) return [];
    const found: PoolInfo[] = [];
    for (let offset = 0; ; offset += DISCOVERY_PAGE_SIZE) {
      const query = `{ bTokens(filter: { chainId: "${this.network}" } sortBy: { field: DEPLOYED_AT, direction: ASC } limit: ${DISCOVERY_PAGE_SIZE} offset: ${offset}) { items { address decimals reserve { address decimals } } } }`;
      const res = await this.dexHelper.httpRequest.post<{
        data?: { bTokens?: { items?: BTokenItem[] } };
      }>(this.subgraphURL, { query }, DISCOVERY_TIMEOUT);
      const items = res?.data?.bTokens?.items ?? [];
      for (const item of items) {
        if (!item?.address || !item?.reserve?.address) continue;
        found.push({
          bToken: item.address,
          bTokenDecimals: Number(item.decimals),
          reserve: item.reserve.address,
          reserveDecimals: Number(item.reserve.decimals),
        });
      }
      if (items.length < DISCOVERY_PAGE_SIZE) break;
    }
    return found;
  }

  // Resolve the configured priority pools on-chain and register any not already
  // discovered. bTokens in this protocol are 18-decimal.
  private async preloadConfigured(): Promise<void> {
    const configured = (
      BaselineConfig[this.dexKey][this.network].bTokens ?? []
    ).filter(bToken => !this.registry[bToken.toLowerCase()]);
    if (configured.length === 0) return;

    const reserveCalls: MultiCallParams<string>[] = configured.map(bToken => ({
      target: this.relay,
      callData: this.relayIface.encodeFunctionData('reserve', [bToken]),
      decodeFunction: addressDecode,
    }));
    const reserves = await this.dexHelper.multiWrapper.aggregate<string>(
      reserveCalls,
    );

    const live = configured
      .map((bToken, i) => ({ bToken, reserve: reserves[i] }))
      .filter(p => p.reserve.toLowerCase() !== NULL_ADDRESS);
    if (live.length === 0) return;

    const decimalCalls: MultiCallParams<number>[] = live.map(p => ({
      target: p.reserve,
      callData: this.erc20Interface.encodeFunctionData('decimals'),
      decodeFunction: uint8ToNumber,
    }));
    // Per-call tolerance: one bad configured entry must not drop the others.
    const reserveDecimals =
      await this.dexHelper.multiWrapper.tryAggregate<number>(
        false,
        decimalCalls,
      );

    live.forEach((p, i) => {
      if (!reserveDecimals[i].success) {
        this.logger.error(
          `${this.dexKey}: reserve decimals failed for ${p.bToken}`,
        );
        return;
      }
      this.register({
        bToken: p.bToken,
        bTokenDecimals: 18,
        reserve: p.reserve,
        reserveDecimals: reserveDecimals[i].returnData,
      });
    });
  }

  private register(info: PoolInfo): void {
    const key = info.bToken.toLowerCase();
    if (!this.registry[key]) this.registry[key] = info;
  }

  // The pool serving a (src, dest, side) request, or null when the pair is
  // unknown or the direction unsupported. Native ETH is priced against the
  // wrapped reserve (see needWrapNative).
  //
  // BUY with the bToken as input (an exact RESERVE amount out) is not supported:
  // the relay's sellTokensExactOut over-delivers the reserve and claws the excess
  // back via reserve.safeTransferFrom(msg.sender, ...), which requires the caller
  // to have approved the relay for the RESERVE token. Augustus only ever approves
  // the token being sold, so the clawback reverts. Emulating it with an exact-in
  // sell is not viable either: the input is fixed in calldata at build time, so
  // the user's slippage tolerance cannot absorb any price movement between quote
  // and execution — the swap would revert on any adverse move. Supporting this
  // direction needs a periphery adapter that holds the reserve approval.
  private async resolvePool(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
  ): Promise<{ info: PoolInfo; src: Token; dest: Token } | null> {
    await this.ensureRegistry();
    const src = this.dexHelper.config.wrapETH(srcToken);
    const dest = this.dexHelper.config.wrapETH(destToken);
    const srcKey = src.address.toLowerCase();
    const destKey = dest.address.toLowerCase();

    const asBToken = this.registry[srcKey];
    if (asBToken && asBToken.reserve.toLowerCase() === destKey) {
      // src is the bToken: only exact-in sells are supported (see above).
      return side === SwapSide.SELL ? { info: asBToken, src, dest } : null;
    }
    const reversed = this.registry[destKey];
    if (reversed && reversed.reserve.toLowerCase() === srcKey) {
      return { info: reversed, src, dest };
    }
    return null;
  }

  // Lazily start (and cache) the event subscriber for a discovered pool, so only
  // pools that are actually priced carry a live state subscription.
  private async getPool(
    info: PoolInfo,
    blockNumber: number,
  ): Promise<BaselineEventPool | null> {
    const key = info.bToken.toLowerCase();
    const existing = this.pools[key];
    if (existing) return existing;

    if (!this.poolInitPromises[key]) {
      this.poolInitPromises[key] = (async () => {
        const pool = new BaselineEventPool(
          this.dexKey,
          this.relay,
          info.bToken,
          info.reserve,
          this.dexHelper,
          this.logger,
        );
        await pool.initialize(blockNumber);
        this.pools[key] = pool;
        return pool;
      })();
    }
    try {
      return await this.poolInitPromises[key];
    } catch (e) {
      this.logger.error(`${this.dexKey}: pool init ${key}`, e);
      return null;
    } finally {
      delete this.poolInitPromises[key];
    }
  }

  getPoolIdentifier(bToken: Address): string {
    return `${this.dexKey}_${bToken}`.toLowerCase();
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const resolved = await this.resolvePool(srcToken, destToken, side);
    return resolved ? [this.getPoolIdentifier(resolved.info.bToken)] : [];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<BaselineData>> {
    const resolved = await this.resolvePool(srcToken, destToken, side);
    if (!resolved) return null;
    const { info, src, dest } = resolved;

    const poolIdentifier = this.getPoolIdentifier(info.bToken);
    if (limitPools && !limitPools.includes(poolIdentifier)) return null;

    const pool = await this.getPool(info, blockNumber);
    if (!pool) return null;

    const state = pool.getPricingState(blockNumber);
    if (!state) return null;

    const { quote, gasCost } = this.quoteFor(info.bToken, src.address, side);
    const unitAmount = getBigIntPow(
      (side === SwapSide.SELL ? src : dest).decimals,
    );

    return [
      {
        prices: amounts.map(amount => this.priceOne(state, quote, amount)),
        unit: this.priceOne(state, quote, unitAmount),
        data: { exchange: this.relay, bToken: info.bToken },
        exchange: this.dexKey,
        poolIdentifiers: [poolIdentifier],
        poolAddresses: [info.bToken],
        gasCost,
      },
    ];
  }

  // An out-of-range amount reverts on-chain and prices to 0 here.
  private priceOne(
    state: DeepReadonly<QuoteState>,
    quote: QuoteFn,
    amount: bigint,
  ): bigint {
    if (amount === 0n) return 0n;
    try {
      return quote(state as QuoteState, amount).amount;
    } catch {
      return 0n;
    }
  }

  // The quote function and its execution-gas cost for (src, side); bToken is
  // always the pool token. BUY with src == bToken is declined in resolvePool.
  private quoteFor(
    bToken: Address,
    srcAddress: Address,
    side: SwapSide,
  ): { quote: QuoteFn; gasCost: number } {
    const srcIsBToken = srcAddress.toLowerCase() === bToken.toLowerCase();
    if (side === SwapSide.SELL) {
      return srcIsBToken
        ? { quote: quoteSellExactIn, gasCost: SELL_EXACT_IN_GAS_COST }
        : { quote: quoteBuyExactIn, gasCost: BUY_EXACT_IN_GAS_COST };
    }
    return { quote: quoteBuyExactOut, gasCost: BUY_EXACT_OUT_GAS_COST };
  }

  getCalldataGasCost(poolPrices: PoolPrices<BaselineData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // V5 adapter param; unused under Augustus V6 (encoding lives in getDexParam).
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: BaselineData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return { targetExchange: data.exchange, payload: '', networkFee: '0' };
  }

  // Augustus V6 encoding. The relay pulls the input via approval (spender
  // defaults to targetExchange) and returns output to the caller, so
  // dexFuncHasRecipient is false and the executor forwards to the recipient.
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _recipient: Address,
    data: BaselineData,
    side: SwapSide,
  ): DexExchangeParam {
    const isSell = side === SwapSide.SELL;
    const swapFunction = this.swapFunction(data.bToken, srcToken, side);

    // SELL: (bToken, exact amountIn, min amountOut).
    // BUY:  (bToken, exact amountOut, max amountIn).
    const [amount, limit] = isSell
      ? [srcAmount, destAmount]
      : [destAmount, srcAmount];

    const exchangeData = this.relaySwapIface.encodeFunctionData(swapFunction, [
      data.bToken,
      amount,
      limit,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange: data.exchange,
      returnAmountPos: isSell
        ? extractReturnAmountPosition(
            this.relaySwapIface,
            swapFunction,
            'amountOut_',
          )
        : undefined,
    };
  }

  // The relay swap call for this (src, side); bToken is always the address arg.
  private swapFunction(
    bToken: Address,
    srcTokenAddress: Address,
    side: SwapSide,
  ): string {
    const srcIsBToken = srcTokenAddress.toLowerCase() === bToken.toLowerCase();
    if (side === SwapSide.SELL) {
      return srcIsBToken ? 'sellTokensExactIn' : 'buyTokensExactIn';
    }
    // Buying the bToken for an exact amount uses the native buyTokensExactOut:
    // the exact side is the minted bToken, so there is no reserve dust and
    // nothing is pulled back from the caller. The mirror direction
    // (sellTokensExactOut) is declined in resolvePool.
    return 'buyTokensExactOut';
  }

  // The Baseline pools touching `tokenAddress` — whether it is a bToken or a
  // reserve — ranked by the USD value of their reserves.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (limit <= 0) return [];
    await this.ensureRegistry();

    const token = this.dexHelper.config.wrapETH(tokenAddress).toLowerCase();
    const matches = Object.values(this.registry).filter(
      info =>
        info.bToken.toLowerCase() === token ||
        info.reserve.toLowerCase() === token,
    );
    if (matches.length === 0) return [];

    try {
      const reserveCalls: MultiCallParams<bigint>[] = matches.map(info => ({
        target: this.relay,
        callData: this.relayIface.encodeFunctionData('totalReserves', [
          info.bToken,
        ]),
        decodeFunction: uint256ToBigInt,
      }));
      const totalReserves = await this.dexHelper.multiWrapper.aggregate<bigint>(
        reserveCalls,
      );

      const pools = await Promise.all(
        matches.map(async (info, i) => {
          const reserveToken: Token = {
            address: info.reserve,
            decimals: info.reserveDecimals,
          };
          const liquidityUSD = await this.dexHelper.getTokenUSDPrice(
            reserveToken,
            totalReserves[i],
          );
          // The token reachable from the queried side through this pool.
          const connector: Token =
            info.reserve.toLowerCase() === token
              ? { address: info.bToken, decimals: info.bTokenDecimals }
              : reserveToken;
          return {
            exchange: this.dexKey,
            address: info.bToken,
            poolIdentifier: this.getPoolIdentifier(info.bToken),
            connectorTokens: [{ ...connector, liquidityUSD }],
            liquidityUSD,
          };
        }),
      );

      return pools
        .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
        .slice(0, limit);
    } catch (e) {
      this.logger.error(`${this.dexKey}: getTopPoolsForToken ${token}`, e);
      return [];
    }
  }

  releaseResources(): AsyncOrSync<void> {}
}
