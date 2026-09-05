import { Contract } from '@ethersproject/contracts';
import { Interface } from '@ethersproject/abi';
import { Provider } from '@ethersproject/providers';
import { DeepReadonly } from 'ts-essentials';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/index';
import { Address, BlockHeader, Log, Logger } from '../../types';
import { bigIntify } from '../../utils';
import { QuoteState } from './types';
import { advanceSnapshot, applyQuoteState } from './baseline-curve';

const RELAY_IFACE = new Interface([
  'function getQuoteState(address bToken) view returns (tuple(tuple(uint256 BLV, uint256 circ, uint256 supply, uint256 swapFee, uint256 reserves, uint256 totalSupply, uint256 convexityExp, uint256 lastInvariant) snapshotCurveParams, uint256 quoteBlockBuyDeltaCirc, uint256 quoteBlockSellDeltaCirc, uint256 totalSupply, uint256 totalBTokens, uint256 totalReserves, uint8 reserveDecimals, uint256 liquidityFeePct, uint256 pendingSurplus, bool shouldSettlePendingSurplus, uint256 maxSellDelta, uint256 snapshotActivePrice))',
]);

const SWAP_IFACE = new Interface([
  'event Swap(address bToken, address user, uint256 activePrice, uint256 blvPrice, int256 bTokenDelta, int256 reserveDelta, uint256 totalFee, uint256 liquidityFee)',
]);
const SWAP_TOPIC = SWAP_IFACE.getEventTopic('Swap');

// Every pool reads the same relay: the Baseline class creates one Contract and
// shares it across its pools (tests build their own through this helper).
export function createRelayContract(
  relay: Address,
  provider: Provider,
): Contract {
  return new Contract(relay, RELAY_IFACE, provider);
}

function cloneState(state: DeepReadonly<QuoteState>): QuoteState {
  return {
    ...state,
    snapshotCurveParams: { ...state.snapshotCurveParams },
  };
}

// The curve functions throw to signal "the chain would revert this"; for a
// boundary roll-forward that means the fresh snapshot cannot be derived
// locally, which callers handle exactly like advanceSnapshot's own null.
function tryAdvanceSnapshot(state: QuoteState): QuoteState | null {
  try {
    return advanceSnapshot(state);
  } catch {
    return null;
  }
}

// Map the getQuoteState struct returned by the relay into a QuoteState.
function parseQuoteState(raw: any): QuoteState {
  const curve = raw.snapshotCurveParams;
  return {
    snapshotCurveParams: {
      blv: bigIntify(curve.BLV),
      circ: bigIntify(curve.circ),
      supply: bigIntify(curve.supply),
      swapFee: bigIntify(curve.swapFee),
      reserves: bigIntify(curve.reserves),
      totalSupply: bigIntify(curve.totalSupply),
      convexityExp: bigIntify(curve.convexityExp),
      lastInvariant: bigIntify(curve.lastInvariant),
    },
    quoteBlockBuyDeltaCirc: bigIntify(raw.quoteBlockBuyDeltaCirc),
    quoteBlockSellDeltaCirc: bigIntify(raw.quoteBlockSellDeltaCirc),
    totalSupply: bigIntify(raw.totalSupply),
    totalBTokens: bigIntify(raw.totalBTokens),
    totalReserves: bigIntify(raw.totalReserves),
    reserveDecimals: Number(raw.reserveDecimals),
    liquidityFeePct: bigIntify(raw.liquidityFeePct),
    pendingSurplus: bigIntify(raw.pendingSurplus),
    settlePendingSurplus: Boolean(raw.shouldSettlePendingSurplus),
    maxSellDelta: bigIntify(raw.maxSellDelta),
    snapshotActivePrice: bigIntify(raw.snapshotActivePrice),
  };
}

// One pool = one bToken. State is the full pricing snapshot from getQuoteState.
export class BaselineEventPool extends StatefulEventSubscriber<QuoteState> {
  // The bToken as it appears in a Swap log's first data word.
  private readonly bTokenWord: string;
  // Guards a single in-flight authoritative refetch.
  private refetching = false;
  // Bumped whenever the block manager breaks state continuity (restart or
  // rollback): a refetch started before the break must be discarded, or a
  // pre-break state would land with the gap's events already declared skipped.
  private stateGeneration = 0;

  constructor(
    parentName: string,
    private readonly relayContract: Contract,
    public readonly bToken: Address,
    dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, bToken, dexHelper, logger);
    this.addressesSubscribed = [relayContract.address];
    this.bTokenWord = bToken.toLowerCase().slice(2);
  }

  async generateState(blockNumber: number): Promise<DeepReadonly<QuoteState>> {
    const raw = await this.relayContract.getQuoteState(this.bToken, {
      blockTag: blockNumber,
    });
    return parseQuoteState(raw);
  }

  // The pricing state for `blockNumber`. The relay re-derives its snapshot at
  // each block boundary — an eventless change — so once the quote is for a block
  // past the last one this pool traded in, roll that block's flow forward locally
  // to reflect the current frozen snapshot rather than the previous one. In the
  // safety regime or while the convexity is relaxing the roll-forward needs data
  // not held locally; the stale snapshot can then over-quote (the boundary
  // fee-commit and BLV ratchet only raise the price), so decline to price and
  // refetch the authoritative state instead of serving a quote that may not be
  // executable. Similarly, with no usable state at all (deep reorg, restart, not
  // yet tracked), decline and refetch — recovery otherwise waits for the next
  // relay log, which on a quiet chain can leave a healthy pool unpriceable.
  getPricingState(blockNumber: number): DeepReadonly<QuoteState> | null {
    const state = this.getState(blockNumber);
    if (!state) {
      this.refetchState(blockNumber);
      return null;
    }
    if (blockNumber <= this.getStateBlockNumber()) return state;
    const advanced = tryAdvanceSnapshot(cloneState(state));
    if (!advanced) {
      this.refetchState(blockNumber);
      return null;
    }
    return advanced;
  }

  // Pricing recovers on the next request once the refetched state lands.
  private refetchState(blockNumber: number): void {
    if (this.refetching) return;
    this.refetching = true;
    const generation = this.stateGeneration;
    this.generateState(blockNumber)
      .then(state => {
        if (generation === this.stateGeneration)
          this.setState(state, blockNumber);
      })
      .catch(e =>
        this.logger.error(`${this.parentName}: refetch ${this.bToken}`, e),
      )
      .finally(() => {
        this.refetching = false;
      });
  }

  restart(blockNumber: number): void {
    this.stateGeneration += 1;
    super.restart(blockNumber);
  }

  rollback(blockNumber: number): void {
    this.stateGeneration += 1;
    super.rollback(blockNumber);
  }

  protected async processBlockLogs(
    state: DeepReadonly<QuoteState>,
    logs: Readonly<Log>[],
    _blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<QuoteState> | null> {
    // The relay's non-swap operations (claims, deposits, borrows) verifiably
    // leave getQuoteState untouched, but a parameter update or future module
    // might not; any non-Swap relay log referencing this bToken defensively
    // refetches the authoritative state rather than trusting that invariant.
    if (logs.some(log => this.isNonSwapPoolLog(log))) {
      return this.fetchBlockState(logs[0].blockNumber);
    }

    // The relay emits every pool's events; the bToken is the first data word,
    // so this pool's Swaps are selected without decoding the rest.
    const swaps = logs
      .filter(
        log =>
          log.topics[0] === SWAP_TOPIC &&
          log.data.slice(26, 66) === this.bTokenWord,
      )
      .map(log => SWAP_IFACE.parseLog(log).args);
    if (swaps.length === 0) return null;

    // Roll the previous block's flow into the snapshot, then apply this block's
    // swaps locally. If the boundary needs data we do not hold (safety regime or
    // a relaxing convexity), fall back to refetching the authoritative state.
    const advanced = tryAdvanceSnapshot(cloneState(state));
    if (!advanced) return this.fetchBlockState(logs[0].blockNumber);

    for (const swap of swaps) {
      applyQuoteState(
        advanced,
        bigIntify(swap.bTokenDelta),
        bigIntify(swap.reserveDelta),
        bigIntify(swap.totalFee),
      );
    }
    return advanced;
  }

  // Authoritative state for the block being processed. A failed fetch keeps the
  // prior state rather than rejecting the block manager's whole log batch;
  // pricing declines until a later refetch lands.
  private async fetchBlockState(
    blockNumber: number,
  ): Promise<DeepReadonly<QuoteState> | null> {
    try {
      return await this.generateState(blockNumber);
    } catch (e) {
      this.logger.error(`${this.parentName}: block refetch ${this.bToken}`, e);
      return null;
    }
  }

  // A non-Swap relay log that references this pool's bToken anywhere in its
  // payload; a false positive only costs one refetch.
  private isNonSwapPoolLog(log: Readonly<Log>): boolean {
    if (log.topics[0] === SWAP_TOPIC) return false;
    return (
      log.data.includes(this.bTokenWord) ||
      log.topics.some(topic => topic.endsWith(this.bTokenWord))
    );
  }

  // Unused: processBlockLogs handles logs at the block level. Null tells the
  // base class the log did not change the state.
  protected processLog(): DeepReadonly<QuoteState> | null {
    return null;
  }
}
