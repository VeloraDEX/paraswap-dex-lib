import { Interface } from '@ethersproject/abi';
import _ from 'lodash';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import { getPoolStates } from './getOnChainState';
import { complement, mulDown, mulUp } from './lib/fixedPoint';
import { calcOutGivenIn } from './lib/rangeMath';
import { toScaled18RoundDown } from './lib/vaultSwap';

// Events that drive cached state. Decoded together by topic0, regardless of which of
// the three subscribed addresses (Vault / pool / hook) emitted the log:
//   Vault  -> Swap, LiquidityAdded, LiquidityRemoved   (fact deltas; pool in arg)
//   Vault  -> SwapFeePercentageChanged,                (fee/pause config; pool in arg)
//            AggregateSwapFeePercentageChanged,
//            PoolPausedStateChanged
//   Vault  -> VaultPausedStateChanged                  (GLOBAL pause; NO pool arg)
//   pool   -> VirtualBalancesUpdated                   (virtual overwrite; emitter = pool)
//   hook   -> VirtualBalancesResynced                  (virtual overwrite; pool in arg)
//   hook   -> Stopped / Resumed                        (global liveness gate)
// Signatures verified against the custom Vault source
// (balancer-v3-monorepo/pkg/interfaces/contracts/vault/IVaultEvents.sol) — they are the
// shared Balancer V3 Vault events, decoded here so the subscriber tracks fee/pause changes
// (mirrors balancer-v3-pool). RangeVault.json carries the same ABI as a reference copy.
const SUBSCRIBER_EVENTS_ABI = [
  'event Swap(address indexed pool, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 swapFeePercentage, uint256 swapFeeAmount)',
  'event LiquidityAdded(address indexed pool, address indexed liquidityProvider, uint8 indexed kind, uint256 totalSupply, uint256[] amountsAddedRaw, uint256[] swapFeeAmountsRaw)',
  'event LiquidityRemoved(address indexed pool, address indexed liquidityProvider, uint8 indexed kind, uint256 totalSupply, uint256[] amountsRemovedRaw, uint256[] swapFeeAmountsRaw)',
  'event SwapFeePercentageChanged(address indexed pool, uint256 swapFeePercentage)',
  'event AggregateSwapFeePercentageChanged(address indexed pool, uint256 aggregateSwapFeePercentage)',
  'event PoolPausedStateChanged(address indexed pool, bool paused)',
  'event VaultPausedStateChanged(bool paused)',
  'event VirtualBalancesUpdated(uint256[] newVirtualBalances)',
  'event VirtualBalancesResynced(address indexed pool, uint256[] newVirtualBalances)',
  'event Stopped(address indexed caller)',
  'event Resumed(address indexed caller)',
];

const subscriberIface = new Interface(SUBSCRIBER_EVENTS_ABI);

// The Vault truncates a swap-fee percentage to FEE_SCALING_FACTOR (5-decimal, i.e. 1e-7)
// precision before storing it (PoolConfigLib.setStaticSwapFeePercentage). generateState
// reads back that truncated value, so the SwapFeePercentageChanged handler must apply the
// same truncation to keep the cached fee bit-identical to a fresh on-chain read.
const FEE_SCALING_FACTOR = 10n ** 11n;

/**
 * Per-pool event subscriber: keeps the cached fact (`balancesLiveScaled18`) and virtual
 * balances correct without a per-quote RPC.
 *
 * Subscribes to three addresses (the Vault, this pool, and the hook) and filters every
 * log to this pool. Idempotency note: the indexer keys inserts on `${txHash}-${logIndex}`;
 * here the StatefulEventSubscriber framework applies each block's logs exactly once, in
 * `logIndex` order, and rebuilds from a base snapshot on rollback — so we get the same
 * once-only guarantee WITHOUT storing a processed-log set (which would corrupt the
 * state-equality used by the events test).
 *
 * Fact balances follow the Vault's swap/liquidity accounting (mirrors `balancer-v3-pool`).
 * Virtual balances are AUTHORITATIVE on `VirtualBalancesUpdated`/`Resynced` (overwrite),
 * but swaps emit NO such event (PROGRESS gotcha #5), so per swap we reconstruct the exact
 * virtual deltas from `RangePool.onSwap` + the hook's `onAfterSwap` LP-fee top-up.
 */
export class RangePoolEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    readonly poolAddress: string,
    readonly vaultAddress: string,
    readonly hookAddress: string,
  ) {
    super(parentName, poolAddress.toLowerCase(), dexHelper, logger);

    this.poolAddress = poolAddress.toLowerCase();
    this.vaultAddress = vaultAddress.toLowerCase();
    this.hookAddress = hookAddress.toLowerCase();

    this.logDecoder = (log: Log) => subscriberIface.parseLog(log);
    this.addressesSubscribed = [
      this.poolAddress,
      this.vaultAddress,
      this.hookAddress,
    ];

    this.handlers['Swap'] = this.handleSwap.bind(this);
    this.handlers['LiquidityAdded'] = this.handleLiquidityAdded.bind(this);
    this.handlers['LiquidityRemoved'] = this.handleLiquidityRemoved.bind(this);
    this.handlers['SwapFeePercentageChanged'] =
      this.handleSwapFeePercentageChanged.bind(this);
    this.handlers['AggregateSwapFeePercentageChanged'] =
      this.handleAggregateSwapFeePercentageChanged.bind(this);
    this.handlers['PoolPausedStateChanged'] =
      this.handlePoolPausedStateChanged.bind(this);
    this.handlers['VaultPausedStateChanged'] =
      this.handleVaultPausedStateChanged.bind(this);
    this.handlers['VirtualBalancesUpdated'] =
      this.handleVirtualBalancesUpdated.bind(this);
    this.handlers['VirtualBalancesResynced'] =
      this.handleVirtualBalancesResynced.bind(this);
    this.handlers['Stopped'] = this.handleStopped.bind(this);
    this.handlers['Resumed'] = this.handleResumed.bind(this);
  }

  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }
    return null;
  }

  /** Authoritative on-chain snapshot of this pool at `blockNumber`. */
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const states = await getPoolStates(
      this.dexHelper,
      this.vaultAddress,
      [this.poolAddress],
      blockNumber,
    );
    const state = states[this.poolAddress];
    if (!state) {
      throw new Error(
        `RangePool: cannot generate state for ${this.poolAddress} at block ${blockNumber}`,
      );
    }
    return state;
  }

  /**
   * Live state at `blockNumber`, regenerating on a subscriber miss instead of returning a
   * stale snapshot. Mirrors the canonical getStateOrGenerate pattern (e.g. fluid-dex-pool):
   * if the cached state is fresh enough it's returned as-is; otherwise the state is rebuilt
   * from chain at `blockNumber` and (unless `readonly`) written back. Throws only if the
   * on-chain regeneration itself fails — the caller treats that as "skip this pool".
   */
  async getStateOrGenerate(
    blockNumber: number,
    readonly = false,
  ): Promise<DeepReadonly<PoolState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
  }

  // True if a Vault/hook log carrying a `pool` arg refers to this pool.
  private isThisPool(event: any): boolean {
    return event.args.pool.toLowerCase() === this.poolAddress;
  }

  // ---------------------------------------------------------------------------
  // Swap: fact deltas + reconstructed virtual deltas (no VirtualBalancesUpdated).
  // ---------------------------------------------------------------------------
  handleSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;

    const indexIn = state.tokens.indexOf(event.args.tokenIn.toLowerCase());
    const indexOut = state.tokens.indexOf(event.args.tokenOut.toLowerCase());
    if (indexIn < 0 || indexOut < 0) {
      this.logger.error(`RangePool handleSwap: token not found in pool state`);
      return null;
    }

    const amountInRaw = BigInt(event.args.amountIn);
    const amountOutRaw = BigInt(event.args.amountOut);
    const swapFeeRaw = BigInt(event.args.swapFeeAmount);
    const swapFee = BigInt(event.args.swapFeePercentage);
    const aggFee = state.aggregateSwapFee;

    const sfIn = state.scalingFactors[indexIn];
    const sfOut = state.scalingFactors[indexOut];
    const rateIn = state.tokenRates[indexIn];
    const rateOut = state.tokenRates[indexOut];
    const wIn = state.weights[indexIn];
    const wOut = state.weights[indexOut];

    const vIn = state.virtualBalances[indexIn];
    const vOut = state.virtualBalances[indexOut];
    // Pre-swap fact balance of the out token == params.balancesScaled18 seen by onSwap.
    const factOut18 = state.balancesLiveScaled18[indexOut];

    // --- reconstruct the virtual deltas the contract applied -----------------
    // The Vault Swap event carries neither the swap kind nor the scaled18 amounts onSwap
    // saw — and the kind is genuinely UNRECOVERABLE from the event: for essentially every
    // swap BOTH kinds reproduce the raw amounts AND the raw fee (algebraically,
    // mulUp(total,f) == mulDivUp(in,f,1-f), so the fee can't disambiguate either). We
    // therefore assume EXACT_IN, which is the dominant aggregator path and is bit-exact
    // when true: in is given (post static fee), onSwap computes the output via our
    // RangeMath, and the hook tops the input virtual up by the LP share of the fee
    // (computed on the PRE-fee input for EXACT_IN). The only swaps this mis-tags are the
    // single-token-router corrective swaps (EXACT_OUT, always bundled with a liquidity
    // event); their virtual error is bounded by one scaling factor (< 1 raw unit) and is
    // overwritten authoritatively at the next liquidity/resync VirtualBalancesUpdated.
    // Fact balances and totalSupply are kind-INDEPENDENT (raw amounts only) and stay exact.
    const in18 = toScaled18RoundDown(amountInRaw, sfIn, rateIn);
    const totalFee18 = mulUp(in18, swapFee);
    const postFee18 = in18 - totalFee18;
    const out18 = calcOutGivenIn(vIn, wIn, vOut, wOut, postFee18, factOut18);
    const lpFee = mulUp(totalFee18, complement(aggFee));
    const newVIn = vIn + postFee18 + lpFee;
    const newVOut = vOut - out18;

    // --- fact deltas (Vault accounting: aggregate fee leaves the live balance) --
    const aggFeeRaw = mulDown(swapFeeRaw, aggFee);
    const newState = _.cloneDeep(state) as PoolState;
    newState.virtualBalances[indexIn] = newVIn;
    newState.virtualBalances[indexOut] = newVOut;
    newState.balancesLiveScaled18[indexIn] += toScaled18RoundDown(
      amountInRaw - aggFeeRaw,
      sfIn,
      rateIn,
    );
    newState.balancesLiveScaled18[indexOut] -= toScaled18RoundDown(
      amountOutRaw,
      sfOut,
      rateOut,
    );
    return newState;
  }

  // ---------------------------------------------------------------------------
  // Liquidity: fact deltas + totalSupply. Virtual is handled by the pool's
  // VirtualBalancesUpdated (emitted by scaleVirtualBalances) — not here.
  // ---------------------------------------------------------------------------
  handleLiquidityAdded(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;
    const newState = _.cloneDeep(state) as PoolState;
    for (let i = 0; i < newState.balancesLiveScaled18.length; i++) {
      const aggFeeRaw = mulDown(
        BigInt(event.args.swapFeeAmountsRaw[i]),
        state.aggregateSwapFee,
      );
      newState.balancesLiveScaled18[i] += toScaled18RoundDown(
        BigInt(event.args.amountsAddedRaw[i]) - aggFeeRaw,
        state.scalingFactors[i],
        state.tokenRates[i],
      );
    }
    newState.totalSupply = BigInt(event.args.totalSupply);
    return newState;
  }

  handleLiquidityRemoved(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;
    const newState = _.cloneDeep(state) as PoolState;
    for (let i = 0; i < newState.balancesLiveScaled18.length; i++) {
      const aggFeeRaw = mulDown(
        BigInt(event.args.swapFeeAmountsRaw[i]),
        state.aggregateSwapFee,
      );
      newState.balancesLiveScaled18[i] -= toScaled18RoundDown(
        BigInt(event.args.amountsRemovedRaw[i]) + aggFeeRaw,
        state.scalingFactors[i],
        state.tokenRates[i],
      );
    }
    newState.totalSupply = BigInt(event.args.totalSupply);
    return newState;
  }

  // ---------------------------------------------------------------------------
  // Fee / pause config (Vault events). A stale swapFee/aggregateSwapFee would corrupt
  // BOTH the quote and the per-swap virtual-delta reconstruction (fee feeds it), and a
  // missed pause would keep the pool quotable — so track all three (mirrors balancer-v3).
  // ---------------------------------------------------------------------------
  handleSwapFeePercentageChanged(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;
    const newState = _.cloneDeep(state) as PoolState;
    // Truncate to the Vault's stored precision so the cached fee matches a fresh read.
    const value = BigInt(event.args.swapFeePercentage);
    newState.swapFeePercentage =
      (value / FEE_SCALING_FACTOR) * FEE_SCALING_FACTOR;
    return newState;
  }

  handleAggregateSwapFeePercentageChanged(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;
    const newState = _.cloneDeep(state) as PoolState;
    // The ProtocolFeeController already truncates this before the Vault stores/emits it.
    newState.aggregateSwapFee = BigInt(event.args.aggregateSwapFeePercentage);
    return newState;
  }

  handlePoolPausedStateChanged(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;
    const paused = Boolean(event.args.paused);
    if (state.isPoolPaused === paused) return null;
    const newState = _.cloneDeep(state) as PoolState;
    newState.isPoolPaused = paused; // isPoolLive() gates a paused pool out of pricing
    return newState;
  }

  // Global Vault pause. Unlike PoolPausedStateChanged this event carries NO `pool` arg
  // (it applies to every pool), so there's no isThisPool filter — each pool subscriber
  // records it on its own state. Signature verified against the custom Vault source
  // (balancer-v3-monorepo IVaultEvents.sol: `event VaultPausedStateChanged(bool paused)`,
  // emitted at VaultAdmin.sol). isPoolLive() already gates isVaultPaused out of pricing —
  // same class as the pool-pause handler, one level up.
  handleVaultPausedStateChanged(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    const paused = Boolean(event.args.paused);
    if (state.isVaultPaused === paused) return null;
    const newState = _.cloneDeep(state) as PoolState;
    newState.isVaultPaused = paused;
    return newState;
  }

  // ---------------------------------------------------------------------------
  // Virtual overwrite (authoritative): init / liquidity scale / recovery resync.
  // ---------------------------------------------------------------------------
  handleVirtualBalancesUpdated(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    // Emitted by the pool about itself — guard on the emitter address.
    if (log.address.toLowerCase() !== this.poolAddress) return null;
    const newState = _.cloneDeep(state) as PoolState;
    newState.virtualBalances = event.args.newVirtualBalances.map((x: any) =>
      BigInt(x),
    );
    return newState;
  }

  handleVirtualBalancesResynced(
    event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!this.isThisPool(event)) return null;
    const newState = _.cloneDeep(state) as PoolState;
    newState.virtualBalances = event.args.newVirtualBalances.map((x: any) =>
      BigInt(x),
    );
    return newState;
  }

  // ---------------------------------------------------------------------------
  // Hook global stop/resume — gates liveness for every pool.
  // ---------------------------------------------------------------------------
  handleStopped(
    _event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (state.isHookStopped) return null;
    const newState = _.cloneDeep(state) as PoolState;
    newState.isHookStopped = true;
    return newState;
  }

  handleResumed(
    _event: any,
    state: DeepReadonly<PoolState>,
    _log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    if (!state.isHookStopped) return null;
    const newState = _.cloneDeep(state) as PoolState;
    newState.isHookStopped = false;
    return newState;
  }
}
