import { AsyncOrSync } from 'ts-essentials';
import { hexlify } from '@ethersproject/bytes';
import {
  Address,
  AdapterExchangeParam,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  Token,
} from '../../types';
import { Network, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { SimpleExchange } from '../simple-exchange';
import { extractReturnAmountPosition } from '../../executor/utils';
import { MhocDeskConfig, MHOC_DESK_GAS_COST } from './config';
import { MhocDeskData, DexParams, PoolConfig } from './types';
import { MhocDeskPollingPool } from './mhoc-desk-pool';
import {
  erc20BalanceIface,
  POOL_IMMUTABLES,
  propAMMIface,
  registryIface,
} from './mhoc-desk-state';
import { StatePollingManager } from '../../lib/stateful-rpc-poller/state-polling-manager';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { extractSuccessAndValue } from '../../lib/decoders';
import {
  constantsFor,
  PoolConstants,
  quote,
  windowTime,
} from './mhoc-desk-math';

// mhoc_desk, a prop AMM: one maker-owned pool per pair, repriced on chain several times a second. Pricing
// replicates PropAMM._compute exactly (mhoc-desk-math.ts), from state polled every block (mhoc-desk-pool.ts).
export class MhocDesk extends SimpleExchange implements IDex<MhocDeskData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;
  readonly isStatePollingDex = true;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(MhocDeskConfig);

  logger: Logger;

  protected pools: {
    cfg: PoolConfig;
    consts: PoolConstants;
    poller?: MhocDeskPollingPool;
  }[] = [];

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    readonly config: DexParams = MhocDeskConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(`${dexKey}-${network}`);
    this.config.pools.forEach(p => this.addPool(p));
  }

  private addPool(p: PoolConfig) {
    const cfg: PoolConfig = {
      ...p,
      address: p.address.toLowerCase(),
      base: { ...p.base, address: p.base.address.toLowerCase() },
      quote: { ...p.quote, address: p.quote.address.toLowerCase() },
    };
    if (this.pools.some(x => x.cfg.address === cfg.address)) return;
    this.pools.push({
      cfg,
      consts: constantsFor(
        cfg.base.decimals,
        cfg.quote.decimals,
        cfg.priceScale,
        cfg.kScale,
      ),
    });
  }

  // With a registry configured: the pools it lists that this instance does not know yet are added, with their
  // immutables and token decimals read on chain (one multicall for the list, two more only when there is a new
  // pool). A failed read leaves the known pools as they are; the next call tries again.
  private async discoverPools(): Promise<void> {
    const registry = this.config.registry;
    if (!registry) return;
    const call = <T>(
      target: Address,
      callData: string,
      decode: (data: string) => T,
    ): MultiCallParams<T> => ({
      target,
      callData,
      decodeFunction: result => {
        const [ok, data] = extractSuccessAndValue(result);
        if (!ok) throw new Error(`${this.dexKey}: read of ${target} failed`);
        return decode(hexlify(data));
      },
    });
    try {
      const [listed] = await this.dexHelper.multiWrapper.aggregate<string[]>([
        call(registry, registryIface.encodeFunctionData('pools', []), data =>
          registryIface
            .decodeFunctionResult('pools', data)[0]
            .map((a: string) => a.toLowerCase()),
        ),
      ]);
      const fresh = listed.filter(
        a => !this.pools.some(p => p.cfg.address === a),
      );
      if (!fresh.length) return;
      const immutables = await this.dexHelper.multiWrapper.aggregate<string>(
        fresh.flatMap(pool =>
          POOL_IMMUTABLES.map(m =>
            call(pool, propAMMIface.encodeFunctionData(m, []), data =>
              propAMMIface.decodeFunctionResult(m, data)[0].toString(),
            ),
          ),
        ),
      );
      const n = POOL_IMMUTABLES.length;
      const tokens = fresh.flatMap((_, i) => [
        immutables[n * i].toLowerCase(),
        immutables[n * i + 1].toLowerCase(),
      ]);
      const decimals = await this.dexHelper.multiWrapper.aggregate<number>(
        tokens.map(t =>
          call(t, erc20BalanceIface.encodeFunctionData('decimals', []), data =>
            Number(erc20BalanceIface.decodeFunctionResult('decimals', data)[0]),
          ),
        ),
      );
      fresh.forEach((address, i) =>
        this.addPool({
          address,
          base: { address: tokens[2 * i], decimals: decimals[2 * i] },
          quote: { address: tokens[2 * i + 1], decimals: decimals[2 * i + 1] },
          priceScale: BigInt(immutables[n * i + 2]),
          kScale: BigInt(immutables[n * i + 3]),
        }),
      );
    } catch (e) {
      this.logger.error(`${this.dexKey}: registry ${registry} not read`, e);
    }
  }

  // Pollers are created on the instances that price or track pools (as WooFiV2 does), then handed to the
  // StatePollingManager, which refreshes them every block.
  private ensurePollers() {
    let created = false;
    for (const p of this.pools) {
      if (p.poller) continue;
      p.poller = new MhocDeskPollingPool(
        this.dexKey,
        this.poolIdentifier(p.cfg.address),
        this.dexHelper,
        p.cfg,
      );
      created = true;
    }
    if (created)
      StatePollingManager.getInstance(
        this.dexHelper,
      ).initializeAllPendingPools();
  }

  async initializePricing(_blockNumber: number) {
    await this.discoverPools();
    this.ensurePollers();
  }

  async updatePoolState(): Promise<void> {
    await this.discoverPools();
    this.ensurePollers();
  }

  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  poolIdentifier(pool: Address): string {
    return `${this.dexKey}_${pool.toLowerCase()}`.toLowerCase();
  }

  private match(src: Token, dest: Token) {
    const s = this.dexHelper.config.wrapETH(src).address.toLowerCase();
    const d = this.dexHelper.config.wrapETH(dest).address.toLowerCase();
    return this.pools.filter(
      p =>
        (p.cfg.base.address === s && p.cfg.quote.address === d) ||
        (p.cfg.quote.address === s && p.cfg.base.address === d),
    );
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return []; // the pool is exact-in only
    return this.match(srcToken, destToken).map(p =>
      this.poolIdentifier(p.cfg.address),
    );
  }

  // Each amount is priced independently on the polled state, as a swap in the next block (the per-block counter of
  // the polled block no longer counts, the per-card one does while the card is the same, and a card whose
  // validUntilBlock is the polled block itself no longer trades) at the wall clock, never earlier than the state's
  // own block. The per-minute budget is counted at windowTime() (the earliest block.timestamp the swap can have),
  // so a wall clock past the minute boundary never frees it early. Unfillable amounts (expired or halted card, caps, floors) price at 0.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<MhocDeskData>> {
    if (side === SwapSide.BUY) return null;
    const src = this.dexHelper.config.wrapETH(srcToken);
    const result: ExchangePrices<MhocDeskData> = [];
    for (const p of this.match(srcToken, destToken)) {
      const id = this.poolIdentifier(p.cfg.address);
      if (limitPools && !limitPools.includes(id)) continue;
      if (!p.poller) continue;
      const state = await p.poller.getState(blockNumber);
      if (!state) continue;
      const snap = state.value;
      const next = BigInt(state.blockNumber + 1);
      const now = BigInt(
        Math.max(Math.floor(Date.now() / 1000), Number(snap.readTimestamp)),
      );
      const wnow = windowTime(snap, now);
      const tokenIn =
        src.address.toLowerCase() === p.cfg.base.address ? 'base' : 'quote';
      const price = (a: bigint) => {
        const r = quote(p.consts, snap, tokenIn, a, next, now, wnow);
        return r.ok ? r.amountOut : 0n;
      };
      const unit = price(getBigIntPow(src.decimals));
      const prices = amounts.map(a => (a === 0n ? 0n : price(a)));
      if (prices.every(x => x === 0n)) continue;
      result.push({
        unit,
        prices,
        data: { pool: p.cfg.address },
        poolIdentifiers: [id],
        exchange: this.dexKey,
        gasCost: MHOC_DESK_GAS_COST,
        poolAddresses: [p.cfg.address],
      });
    }
    return result.length ? result : null;
  }

  getCalldataGasCost(_poolPrices: PoolPrices<MhocDeskData>): number | number[] {
    // swap(address,uint256,uint256,address): selector + 4 words
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.ADDRESS * 2 +
      CALLDATA_GAS_COST.AMOUNT * 2
    );
  }

  getAdapterParam(): AdapterExchangeParam {
    throw new Error(`${this.dexKey}: V5 not supported`);
  }

  // swap(tokenIn, amountIn, minAmountOut = 1, recipient): the pool pulls tokenIn from the executor with
  // transferFrom (the executor approves the pool), pays `recipient` directly, and returns amountOut.
  getDexParam(
    srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    recipient: Address,
    data: MhocDeskData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY)
      throw new Error(`${this.dexKey}: BUY not supported`);
    const exchangeData = propAMMIface.encodeFunctionData('swap', [
      srcToken,
      srcAmount,
      1,
      recipient,
    ]);
    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.pool,
      spender: data.pool,
      returnAmountPos: extractReturnAmountPosition(
        propAMMIface,
        'swap',
        'amountOut',
      ),
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // native ETH is priced as WETH (match()), so its liquidity is reported on the pool too
    const t = this.dexHelper.config.wrapETH(tokenAddress).toLowerCase();
    const out: PoolLiquidity[] = [];
    for (const p of this.pools) {
      if (p.cfg.base.address !== t && p.cfg.quote.address !== t) continue;
      if (!p.poller) continue;
      const state = await p.poller.getState();
      if (!state) continue;
      const s = state.value;
      // free inventory above the floors, in USD
      const [baseUsd, quoteUsd] = await Promise.all([
        this.dexHelper.getTokenUSDPrice(
          p.cfg.base,
          s.balanceBase > s.floorBase ? s.balanceBase - s.floorBase : 0n,
        ),
        this.dexHelper.getTokenUSDPrice(
          p.cfg.quote,
          s.balanceQuote > s.floorQuote ? s.balanceQuote - s.floorQuote : 0n,
        ),
      ]);
      const other = p.cfg.base.address === t ? p.cfg.quote : p.cfg.base;
      out.push({
        exchange: this.dexKey,
        address: p.cfg.address,
        poolIdentifier: this.poolIdentifier(p.cfg.address),
        connectorTokens: [
          {
            ...other,
            liquidityUSD: p.cfg.base.address === t ? baseUsd : quoteUsd,
          },
        ],
        liquidityUSD: p.cfg.base.address === t ? quoteUsd : baseUsd,
      });
    }
    return out.sort((a, b) => b.liquidityUSD - a.liquidityUSD).slice(0, limit);
  }

  releaseResources(): AsyncOrSync<void> {}
}
