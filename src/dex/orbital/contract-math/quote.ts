// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Port of OrbitalPool._quoteExactInput and _quoteExactOutput: the pool-level quotes behind `quote` and both swaps.
import { max, mulDivUp, sub, u256 } from './arith';
import { MAX_REAL_RESERVE, MIN_SWAP_INPUT, WAD } from './constants';
import { solveExactInput, solveExactOutput, type EngineResult } from './engine';
import { check, OrbitalQuoteError } from './errors';
import { isValidAssetPair, type PoolState, type Triple } from './state';

export type Quote = {
  /** Raw output paid to the recipient: rounded down in favor of the pool for an exact input, the request for an exact output. */
  amountOut: bigint;
  /** Normalized input kept by the pool outside the reserves: the fee, and for an exact output the roundings. */
  feeAmount: bigint;
  /** Normalized input added to the geometry. */
  netInput: bigint;
  /** Ticks that changed status (interior <-> boundary): each one costs extra gas. */
  ticksCrossed: number;
  /** Pool state after the swap is committed, exactly as the contract stores it. */
  nextState: PoolState;
};

/**
 * Quotes an exact-input swap exactly as `OrbitalPool.quote(..., true)` does, to the wei.
 * @param amountIn Raw input in the input token's decimals, fee included.
 * @throws OrbitalQuoteError with the on-chain revert reason when the pool would refuse the swap.
 */
export function quoteExactInput(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  amountIn: bigint,
): Quote {
  const invalid = isValidAssetPair(assetIn, assetOut);
  if (invalid) throw new OrbitalQuoteError(invalid);
  // Normalize exactly once; oversized raw input reverts on checked overflow.
  const normalized = u256(u256(amountIn) * state.scales[assetIn]);
  check(normalized >= MIN_SWAP_INPUT, 'Input below minimum');
  // The fee rounds up in favor of the pool; the geometry only sees the net input.
  const feeAmount = mulDivUp(normalized, state.fee, WAD);
  const netInput = sub(normalized, feeAmount);
  const end = solveExactInput(state, assetIn, assetOut, netInput);
  const nextState = storableEndpoint(state, assetIn, assetOut, end);
  // Round the output down without reinjecting dust into the solved state.
  const amountOut = end.amountOut / state.scales[assetOut];
  check(amountOut !== 0n, 'Output too small');
  return {
    amountOut,
    feeAmount,
    netInput,
    ticksCrossed: end.ticksCrossed,
    nextState,
  };
}

/** Quote, or null when the pool would refuse the swap. */
export function tryQuoteExactInput(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  amountIn: bigint,
): Quote | null {
  try {
    return quoteExactInput(state, assetIn, assetOut, amountIn);
  } catch (error) {
    if (error instanceof OrbitalQuoteError) return null;
    throw error;
  }
}

/** Exact-output quote: the inverse endpoint, and the raw input that pays for it. */
export type ExactOutputQuote = Quote & {
  /** Raw input pulled from the caller, fee included, rounded up in favor of the pool. */
  amountIn: bigint;
};

/**
 * Quotes an exact-output swap exactly as `OrbitalPool.quote(..., false)` does, to the wei: the output reserve falls by
 * exactly `amountOut`, the input reserve rises to the smallest certified value, and the caller pays the net input that
 * adds, fee grossed up and rounded up to raw. `nextState` is that inverse endpoint, the state `swapExactOutput` commits.
 * @param amountOut Raw output in the output token's decimals.
 * @throws OrbitalQuoteError with the on-chain revert reason when the pool would refuse the swap.
 */
export function quoteExactOutput(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  amountOut: bigint,
): ExactOutputQuote {
  const invalid = isValidAssetPair(assetIn, assetOut);
  if (invalid) throw new OrbitalQuoteError(invalid);
  const target = u256(u256(amountOut) * state.scales[assetOut]);
  check(target !== 0n, 'Output too small');
  const end = solveExactOutput(state, assetIn, assetOut, target);
  const nextState = storableEndpoint(state, assetIn, assetOut, end);
  const netInput = end.reserveIn - state.reserves[assetIn];
  // Gross input and raw input round up in favor of the pool, never below the smallest input an exact input accepts.
  const gross = mulDivUp(netInput, WAD, WAD - state.fee);
  const scaleIn = state.scales[assetIn];
  const amountIn = max(
    mulDivUp(gross, 1n, scaleIn),
    mulDivUp(MIN_SWAP_INPUT, 1n, scaleIn),
  );
  return {
    amountIn,
    amountOut,
    feeAmount: amountIn * scaleIn - netInput,
    netInput,
    ticksCrossed: end.ticksCrossed,
    nextState,
  };
}

/** The endpoint as the pool stores it, after OrbitalState.requireStorable: every real reserve fits 96 bits. */
function storableEndpoint(
  state: PoolState,
  assetIn: number,
  assetOut: number,
  end: EngineResult,
): PoolState {
  const reserves = [...state.reserves] as [bigint, bigint, bigint];
  reserves[assetIn] = end.reserveIn;
  reserves[assetOut] = end.reserveOut;
  check(
    reserves.every(reserve => reserve - state.floor <= MAX_REAL_RESERVE),
    'Reserve exceeds maximum',
  );
  return {
    ...state,
    reserves: reserves as Triple,
    rInt: end.rInt,
    kBound: end.kBound,
    sBound: end.sBound,
    topBoundary: end.topBoundary,
    boundaryTickCount: end.boundaryTickCount,
  };
}
