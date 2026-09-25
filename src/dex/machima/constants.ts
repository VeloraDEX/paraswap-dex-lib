// Machima protocol constants. Mirrors the KyberSwap dex-lib integration
// (pkg/liquidity-source/machima/constant.go) so off-chain pricing stays
// consistent across aggregators.

// Single fee tier: every Machima pool is a 1% (10000) Uniswap V3 pool.
export const MACHIMA_POOL_FEE = 10000n;
export const MACHIMA_TICK_SPACING = 200n;

// Anti-sniper grace period after pool deployment during which the
// MachimaSwapAdapter rejects non-allowlisted callers. While active, the
// aggregator route would revert, so we skip quoting. Conservative fixed
// window matching the Kyber integration.
export const MACHIMA_ANTI_SNIPER_WINDOW_S = 600;

// Gas estimates for a swap routed through MachimaAggregatorRouter ->
// MachimaSwapAdapter -> Uniswap V3 pool. BASE+CROSS_TICK (~450k) mirrors the
// KyberSwap integration and is used as the standalone estimate for the
// aggregator-quoter path.
// TODO: profile against a real on-chain swap; these are conservative.
export const MACHIMA_BASE_GAS = 350_000;
export const MACHIMA_CROSS_TICK_GAS = 100_000;

// Extra overhead of the aggregator router + swap adapter + tax handlers on top
// of the bare Uniswap V3 pool-swap gas that the base class already estimates
// (two transferFroms, forceApprove, tax-handler transfers, anti-sniper reads).
// Added to the inherited gas in the event-pricing path to avoid double-counting
// the base pool-swap cost.
export const MACHIMA_WRAPPER_GAS_OVERHEAD = 250_000;

export const BPS_DENOMINATOR = 10_000n;

// In-memory TTL (ms) for cached per-token tax config + deployment time.
export const MACHIMA_TOKEN_INFO_TTL_MS = 60_000;
