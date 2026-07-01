import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { BaselineConfig } from './config';
import { BaselineEventPool } from './baseline-pool';
import {
  advanceSnapshot,
  applyQuoteState,
  computeActivePrice,
} from './baseline-curve';
import { QuoteState } from './types';

const network = Network.BASE;
const dexKey = 'Baseline';
const RELAY = BaselineConfig[dexKey][network].relay;
const REPPO = Tokens[network].REPPO;
const VIRTUAL = Tokens[network].VIRTUAL;

const SWAP_IFACE = new Interface([
  'event Swap(address bToken, address user, uint256 activePrice, uint256 blvPrice, int256 bTokenDelta, int256 reserveDelta, uint256 totalFee, uint256 liquidityFee)',
]);
const SWAP_TOPIC = SWAP_IFACE.getEventTopic('Swap');

function cloneState(state: QuoteState): QuoteState {
  return { ...state, snapshotCurveParams: { ...state.snapshotCurveParams } };
}

describe('BaselineEventPool', () => {
  const dexHelper = new DummyDexHelper(network);
  const pool = new BaselineEventPool(
    dexKey,
    RELAY,
    REPPO.address,
    VIRTUAL.address,
    dexHelper,
    dexHelper.getLogger(dexKey),
  );

  // The Swap deltas this pool executed in a single block, in log order.
  async function poolSwaps(
    block: number,
  ): Promise<{ deltaCirc: bigint; reserveDelta: bigint; fee: bigint }[]> {
    const logs = await dexHelper.web3Provider.eth.getPastLogs({
      address: RELAY,
      topics: [SWAP_TOPIC],
      fromBlock: block,
      toBlock: block,
    });
    return logs
      .map(
        log => SWAP_IFACE.parseLog({ data: log.data, topics: log.topics }).args,
      )
      .filter(a => a.bToken.toLowerCase() === REPPO.address.toLowerCase())
      .map(a => ({
        deltaCirc: BigInt(a.bTokenDelta.toString()),
        reserveDelta: BigInt(a.reserveDelta.toString()),
        fee: BigInt(a.totalFee.toString()),
      }));
  }

  // Cross a block boundary the way processBlockLogs does: roll the previous
  // block's flow into the snapshot, then apply this block's swaps locally.
  function advanceThroughBlock(
    state: QuoteState,
    swaps: { deltaCirc: bigint; reserveDelta: bigint; fee: bigint }[],
  ): QuoteState {
    const next = advanceSnapshot(cloneState(state));
    expect(next).not.toBeNull();
    for (const s of swaps)
      applyQuoteState(next!, s.deltaCirc, s.reserveDelta, s.fee);
    return next!;
  }

  it('fetches a coherent state whose active price matches the ported curve', async () => {
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const state = await pool.generateState(blockNumber);

    // A live, non-empty pool.
    expect(state.totalSupply > 0n).toBe(true);
    expect(state.totalBTokens > 0n).toBe(true);
    expect(state.totalReserves > 0n).toBe(true);
    expect(state.snapshotCurveParams.circ > 0n).toBe(true);

    // The relay reports its own active price; the ported curve must reproduce it.
    expect(computeActivePrice({ ...state.snapshotCurveParams })).toEqual(
      state.snapshotActivePrice,
    );
  });

  it('re-derives the next-block snapshot exactly across a boundary', async () => {
    // Block 48067448 accumulated REPPO flow; block 48067449 had none, so the relay
    // previews the re-frozen snapshot there. Advancing the traded block locally
    // must reproduce that preview to the wei.
    const TRADED_BLOCK = 48067448;
    const NEXT_BLOCK = 48067449;
    const before = await pool.generateState(TRADED_BLOCK);
    const after = await pool.generateState(NEXT_BLOCK);

    expect(
      before.quoteBlockSellDeltaCirc > 0n || before.quoteBlockBuyDeltaCirc > 0n,
    ).toBe(true);

    const advanced = advanceSnapshot({
      ...before,
      snapshotCurveParams: { ...before.snapshotCurveParams },
    } as QuoteState);

    expect(advanced).not.toBeNull();
    expect(advanced!.snapshotCurveParams).toEqual({
      ...after.snapshotCurveParams,
    });
  });

  it('carries totals, surplus, and settle flag across two boundaries', async () => {
    // Three blocks this pool traded, with idle gaps and no intervening trade.
    // Replaying them locally must reproduce the authoritative state at each,
    // exercising the pending-surplus commit at two successive boundaries.
    const FIRST = 48066500;
    const SECOND = 48066644;
    const THIRD = 48066647;

    const start = cloneState(await pool.generateState(FIRST));
    expect(
      start.quoteBlockBuyDeltaCirc > 0n || start.quoteBlockSellDeltaCirc > 0n,
    ).toBe(true);

    const atSecond = advanceThroughBlock(start, await poolSwaps(SECOND));
    expect(atSecond).toEqual(await pool.generateState(SECOND));

    const atThird = advanceThroughBlock(atSecond, await poolSwaps(THIRD));
    expect(atThird).toEqual(await pool.generateState(THIRD));
  });

  it('re-derives correctly across adjacent traded blocks', async () => {
    // Three consecutive blocks the pool traded in, with no idle gap between them.
    // The surplus commit fires at every boundary; replaying each block locally
    // must still reproduce the authoritative state to the wei.
    const BLOCKS = [48066261, 48066262, 48066263];

    let state = cloneState(await pool.generateState(BLOCKS[0]));
    for (const block of BLOCKS.slice(1)) {
      state = advanceThroughBlock(state, await poolSwaps(block));
      expect(state).toEqual(await pool.generateState(block));
    }
  });

  it('rolls the snapshot forward when quoting past the last traded block', async () => {
    // The pool last traded at TRADED; a quote arrives at the following idle
    // block, where the relay has already re-derived its snapshot.
    const TRADED = 48067448;
    const IDLE = 48067449;
    const traded = await pool.generateState(TRADED);
    pool.setState(cloneState(traded), TRADED);
    pool.isTracking = () => true;

    // At the trading block itself, the state is served unchanged.
    expect(pool.getPricingState(TRADED)).toEqual(traded);

    // One block on, the served snapshot must match the relay's own view — the
    // fields that drive pricing, re-derived without any event.
    const onChain = await pool.generateState(IDLE);
    const served = pool.getPricingState(IDLE)!;
    expect(served.snapshotCurveParams).toEqual({
      ...onChain.snapshotCurveParams,
    });
    expect(served.snapshotActivePrice).toEqual(onChain.snapshotActivePrice);
    expect(served.maxSellDelta).toEqual(onChain.maxSellDelta);
    expect(served.quoteBlockBuyDeltaCirc).toEqual(0n);
    expect(served.quoteBlockSellDeltaCirc).toEqual(0n);
  });

  it('declines to price past a boundary it cannot roll forward, then recovers', async () => {
    // ZRP-style safety regime (totalBTokens >= 95% of supply): the boundary
    // re-derivation needs data not held locally, so a stale-snapshot quote
    // could over-promise. The pool must decline and refetch instead.
    const TRADED = 48067448;
    const IDLE = 48067449;
    const traded = cloneState(await pool.generateState(TRADED));
    traded.totalBTokens = (traded.totalSupply * 96n) / 100n;
    expect(traded.quoteBlockSellDeltaCirc).toBeGreaterThan(0n); // has flow

    const fresh = await pool.generateState(IDLE);
    let refetches = 0;
    const generate = pool.generateState.bind(pool);
    pool.generateState = async (blockNumber: number) => {
      refetches += 1;
      return fresh;
    };
    try {
      pool.setState(cloneState(traded), TRADED);
      pool.isTracking = () => true;

      // At the traded block itself the state is still served.
      expect(pool.getPricingState(TRADED)).toEqual(traded);

      // Past the boundary: decline, and fire one authoritative refetch.
      expect(pool.getPricingState(IDLE)).toBeNull();
      await new Promise(resolve => setImmediate(resolve));
      expect(refetches).toEqual(1);

      // The refetched state now serves quotes again.
      expect(pool.getPricingState(IDLE)).toEqual(fresh);
    } finally {
      pool.generateState = generate;
    }
  });
});
