import { AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  ConnectorToken,
  Logger,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network, ETHER_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { NumberAsString } from '@paraswap/core';
import { Interface } from '@ethersproject/abi';
import { extractReturnAmountPosition } from '../../executor/utils';
import { DexParams, PoolState, RangePoolData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { RangePoolConfig } from './config';
import { RangePoolEventPool } from './range-pool-pool';
import { getAllPools, getPoolStates, isPoolLive } from './getOnChainState';
import { computeAmountIn, computeAmountOut } from './lib/vaultSwap';
import RangeRouterABI from '../../abi/range-pool/RangeRouter.json';

// Single-hop swap through the Range Router (swapSingleTokenExactIn/Out). Covers the Vault
// swap + Permit2 transfer; refined once settlement is wired in Stage 5.
const RANGE_POOL_GAS_COST = 200_000;

const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

// getTopPoolsForToken (Stage 6): minimum pool TVL (USD) to request from the ranges-stats
// API, and the HTTP timeout. minTvl=0 keeps every pool (the API COALESCEs missing TVL to 0
// and sorts those to the bottom), so the desc-sorted + limit cap does the ranking.
const TOP_POOLS_MIN_TVL_USD = 0;
const TOP_POOLS_API_TIMEOUT_MS = 5_000;

// Subset of the ranges-stats `poolSummarySchema` we consume for USD ranking
// (GET /pools). decimals/weight/tvlUsd are nullable in the contract.
type ApiTokenRef = {
  address: string;
  symbol?: string;
  decimals: number | null;
  weight?: string | null;
};
type ApiPoolSummary = {
  address: string;
  tokens: ApiTokenRef[];
  tvlUsd: string | null;
};

// decimalScalingFactor = 10^(18 - decimals) ⇒ decimals = 18 - log10(sf). Used by the
// on-chain fallback, which only has scaling factors (no token decimals) cached.
function decimalsFromScalingFactor(sf: bigint): number {
  let d = 0;
  let x = sf;
  while (x > 1n) {
    x /= 10n;
    d++;
  }
  return 18 - d;
}

export class RangePool extends SimpleExchange implements IDex<RangePoolData> {
  // Per-pool event subscribers are wired in Stage 4.
  protected eventPools: Record<string, RangePoolEventPool> = {};

  readonly hasConstantPriceLargeAmounts = false;
  // TODO: set true here if protocols works only with wrapped asset
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(RangePoolConfig);

  logger: Logger;

  // Reused across getDexParam calls (CLAUDE.md: never instantiate Interfaces per call).
  readonly routerIface: Interface;

  readonly params: DexParams;

  // Cached pool states keyed by lowercased pool address, refreshed by
  // initializePricing / updatePoolState (event-based caching arrives in Stage 4).
  protected poolStates: Record<string, PoolState> = {};

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.routerIface = new Interface(RangeRouterABI);
    this.params = RangePoolConfig[dexKey][network];
  }

  // Normalize native ETH to WETH so identifiers/pricing match the pool tokens
  // (needWrapNative => the framework wraps/unwraps around settlement).
  private toWrapped(token: Address): Address {
    const weth =
      this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase();
    const t = token.toLowerCase();
    return t === ETHER_ADDRESS.toLowerCase() ? weth : t;
  }

  // Pools (lowercased addresses) holding BOTH tokens. Distinct token↔token only.
  private poolsForPair(srcToken: Address, destToken: Address): string[] {
    const src = this.toWrapped(srcToken);
    const dest = this.toWrapped(destToken);
    if (src === dest) return [];
    return Object.entries(this.poolStates)
      .filter(
        ([, s]) =>
          isPoolLive(s) && s.tokens.includes(src) && s.tokens.includes(dest),
      )
      .map(([pool]) => pool);
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.refreshPools(blockNumber);

    // Eager-load each pool's event subscriber, seeding it with the snapshot we just
    // fetched (no extra RPC). From here the subscriber keeps virtual + fact balances
    // current from logs; the framework's blockManager polls + regenerates on any gap,
    // which doubles as the periodic safety refresh.
    await Promise.all(
      Object.entries(this.poolStates).map(async ([pool, state]) => {
        if (this.eventPools[pool]) return;
        const eventPool = new RangePoolEventPool(
          this.dexKey,
          this.network,
          this.dexHelper,
          this.logger,
          pool,
          this.params.vaultAddress,
          this.params.hookAddress,
        );
        await eventPool.initialize(blockNumber, { state });
        this.eventPools[pool] = eventPool;
      }),
    );
  }

  // Enumerate all pools from the factory and (re)load their on-chain state.
  private async refreshPools(blockNumber: number): Promise<void> {
    const pools = await getAllPools(
      this.dexHelper,
      this.params.factoryAddress,
      blockNumber,
    );
    this.poolStates = await getPoolStates(
      this.dexHelper,
      this.params.vaultAddress,
      pools,
      blockNumber,
    );
  }

  // Live state for a pool: prefer the event subscriber (kept current from logs),
  // falling back to the last discovery snapshot if the subscriber is stale/absent.
  private getLiveState(pool: string, blockNumber: number): PoolState | null {
    const eventPool = this.eventPools[pool];
    if (eventPool) {
      const state = eventPool.getState(blockNumber);
      if (state) return state as PoolState;
    }
    return this.poolStates[pool] ?? null;
  }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (Object.keys(this.poolStates).length === 0) {
      await this.refreshPools(blockNumber);
    }
    return this.poolsForPair(srcToken.address, destToken.address).map(
      pool => `${this.dexKey}_${pool}`,
    );
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<RangePoolData>> {
    try {
      const src = this.toWrapped(srcToken.address);
      const dest = this.toWrapped(destToken.address);
      if (src === dest) return null;

      if (Object.keys(this.poolStates).length === 0) {
        await this.refreshPools(blockNumber);
      }

      let pools = this.poolsForPair(srcToken.address, destToken.address);
      if (limitPools && limitPools.length) {
        const allowed = new Set(limitPools);
        pools = pools.filter(p => allowed.has(`${this.dexKey}_${p}`));
      }
      if (!pools.length) return null;

      // SELL: amountIn is in srcToken; BUY: amountOut is in destToken.
      const unitVolume = getBigIntPow(
        (side === SwapSide.SELL ? srcToken : destToken).decimals,
      );

      const result: ExchangePrices<RangePoolData> = [];
      for (const pool of pools) {
        const state = this.getLiveState(pool, blockNumber);
        if (!state || !isPoolLive(state)) continue;
        const indexIn = state.tokens.indexOf(src);
        const indexOut = state.tokens.indexOf(dest);
        if (indexIn < 0 || indexOut < 0) continue;

        // Emulate the full Vault swap flow per amount; 0 means "no price at this point"
        // (a EXACT_OUT amount the pool can't serve, or a dust input).
        const quote = (amount: bigint): bigint => {
          if (amount === 0n) return 0n;
          if (side === SwapSide.SELL) {
            return computeAmountOut(state, indexIn, indexOut, amount);
          }
          return computeAmountIn(state, indexIn, indexOut, amount) ?? 0n;
        };

        result.push({
          prices: amounts.map(quote),
          unit: quote(unitVolume),
          data: { exchange: pool },
          exchange: this.dexKey,
          gasCost: RANGE_POOL_GAS_COST,
          poolAddresses: [pool],
          poolIdentifiers: [`${this.dexKey}_${pool}`],
        });
      }

      return result.length ? result : null;
    } catch (e) {
      this.logger.error(`getPricesVolume failed`, e);
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<RangePoolData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      // pool
      CALLDATA_GAS_COST.ADDRESS +
      // tokenIn
      CALLDATA_GAS_COST.ADDRESS +
      // tokenOut
      CALLDATA_GAS_COST.ADDRESS +
      // exactAmount (in for SELL / out for BUY)
      CALLDATA_GAS_COST.AMOUNT +
      // limit (minAmountOut for SELL / maxAmountIn for BUY)
      CALLDATA_GAS_COST.AMOUNT +
      // deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // wethIsEth
      CALLDATA_GAS_COST.BOOL +
      // userData
      CALLDATA_GAS_COST.FULL_WORD
    );
  }

  // V6 settlement: build a single-hop swap through the Range Router
  // (swapSingleTokenExactIn for SELL, swapSingleTokenExactOut for BUY).
  //
  // Router targeted: 0x8726…18df ("Router"). The Single-token Router (0x79C1…86F8)
  // does NOT expose swapSingleTokenExactIn/Out — verified by decoding both ABIs from
  // balancer-v3-monorepo (RangeSingleTokenRouter only has liquidity fns + an internal
  // swapSingleTokenHook) and by confirming the selectors 0x750283bc / 0x94e86ef8 are
  // present in the on-chain bytecode of 0x8726… and absent from 0x79C1….
  //
  // needWrapNative is true on this class, so the executor wraps/unwraps native ETH around
  // the call and the Router always operates on WETH ⇒ wethIsEth = false. Tokens are pulled
  // via Permit2 (permit2Approval ⇒ executor approves the Router through Permit2; spender
  // defaults to targetExchange). The minAmountOut / maxAmountIn limits are enforced by the
  // surrounding Paraswap executor, so they're left fully open in the encoded call.
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: RangePoolData,
    side: SwapSide,
  ): DexExchangeParam {
    const tokenIn = this.toWrapped(srcToken);
    const tokenOut = this.toWrapped(destToken);

    const exchangeData =
      side === SwapSide.SELL
        ? this.routerIface.encodeFunctionData('swapSingleTokenExactIn', [
            data.exchange,
            tokenIn,
            tokenOut,
            srcAmount, // exactAmountIn
            '0', // minAmountOut — slippage enforced by the executor
            MAX_UINT256, // deadline
            false, // wethIsEth — executor handles native wrapping (needWrapNative)
            '0x', // userData
          ])
        : this.routerIface.encodeFunctionData('swapSingleTokenExactOut', [
            data.exchange,
            tokenIn,
            tokenOut,
            destAmount, // exactAmountOut
            MAX_UINT256, // maxAmountIn — slippage enforced by the executor
            MAX_UINT256, // deadline
            false, // wethIsEth
            '0x', // userData
          ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      permit2Approval: true,
      exchangeData,
      targetExchange: this.params.routerAddress,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.routerIface,
              'swapSingleTokenExactIn',
            )
          : undefined,
    };
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: RangePoolData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // TODO: complete me!
    const { exchange } = data;

    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    // blockManager isn't available here — use a direct RPC block read.
    const blockNumber = await this.dexHelper.provider.getBlockNumber();
    await this.refreshPools(blockNumber);
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  //
  // Primary source: ranges-stats GET /pools?sort=tvl&order=desc (USD-ranked). We filter to
  // pools holding the queried token and map each to ParaSwap's USD-liquidity shape. If the
  // API is unreachable / errors / returns non-OK, degrade gracefully to ranking the cached
  // on-chain pool states by a raw-balance proxy (never throw — return [] worst case).
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = this.toWrapped(tokenAddress);
    try {
      return await this.topPoolsFromApi(token, limit);
    } catch (e) {
      this.logger.warn(
        `getTopPoolsForToken: ranges-stats API unavailable, falling back to on-chain ranking`,
        e,
      );
      return this.topPoolsFromCache(token, limit);
    }
  }

  // USD-ranked pools from the ranges-stats API. Throws on any HTTP/transport failure so the
  // caller can fall back to on-chain ranking.
  private async topPoolsFromApi(
    token: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const url =
      `${this.params.apiBaseUrl}/pools` +
      `?sort=tvl&order=desc&minTvl=${TOP_POOLS_MIN_TVL_USD}`;
    const res = await this.dexHelper.httpRequest.get<ApiPoolSummary[]>(
      url,
      TOP_POOLS_API_TIMEOUT_MS,
    );
    if (!Array.isArray(res)) throw new Error('unexpected /pools response');

    const pools: PoolLiquidity[] = [];
    for (const pool of res) {
      const tokens = pool.tokens ?? [];
      if (!tokens.some(t => t.address.toLowerCase() === token)) continue;

      const connectorTokens: ConnectorToken[] = tokens
        .filter(t => t.address.toLowerCase() !== token)
        .map(t => ({
          address: t.address.toLowerCase(),
          decimals: t.decimals ?? 18,
          symbol: t.symbol,
        }));

      pools.push({
        exchange: this.dexKey,
        address: pool.address.toLowerCase(),
        liquidityUSD: pool.tvlUsd != null ? parseFloat(pool.tvlUsd) : 0,
        connectorTokens,
      });
    }

    // API already orders by tvl desc, but the token filter is ours — re-sort + cap.
    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  // On-chain fallback: rank the cached pool states (Stage 2/4 path) by a raw-balance proxy
  // for the token — the token's fact balance, descaled to a plain number. This is NOT a USD
  // value, but it's monotonic per token so the ranking is sound when the API is down.
  private async topPoolsFromCache(
    token: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (Object.keys(this.poolStates).length === 0) {
      // blockManager isn't available here — use a direct RPC block read.
      const blockNumber = await this.dexHelper.provider.getBlockNumber();
      await this.refreshPools(blockNumber);
    }

    const pools: PoolLiquidity[] = [];
    for (const [address, state] of Object.entries(this.poolStates)) {
      if (!isPoolLive(state)) continue;
      const idx = state.tokens.indexOf(token);
      if (idx < 0) continue;

      const connectorTokens: ConnectorToken[] = state.tokens
        .map((addr, i) => ({ addr, i }))
        .filter(({ addr }) => addr !== token)
        .map(({ addr, i }) => ({
          address: addr,
          decimals: decimalsFromScalingFactor(state.scalingFactors[i]),
        }));

      pools.push({
        exchange: this.dexKey,
        address,
        liquidityUSD: Number(state.balancesLiveScaled18[idx]) / 1e18,
        connectorTokens,
      });
    }

    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {
    // TODO: complete me!
  }
}
