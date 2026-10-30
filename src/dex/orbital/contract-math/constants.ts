// Vendored from @orbitaldefi/sdk 0.2.2 (src/math, MIT License, Copyright (c) 2026 Apsis): https://github.com/clement-ux/Orbital/tree/main/sdk
// Constants of src/libraries/OrbitalMath.sol, OrbitalState.sol, OrbitalTick.sol and OrbitalSwapEngine.sol.

/** Standard 18-decimal fixed-point scale. */
export const WAD = 10n ** 18n;
/** 36-decimal scale of projected coordinates and fee growth. */
export const X36 = 10n ** 36n;
/** 54-decimal scale of plane thresholds. */
export const X54 = 10n ** 54n;
/** 72-decimal scale of squared high-precision quantities. */
export const X72 = 10n ** 72n;
/** floor(sqrt(3) * 1e36), the only sqrt(3) constant of the contracts. */
export const SQRT3_X36 = 1_732_050_807_568_877_293_527_446_341_505_872_366n;

/** Smallest normalized gross swap input accepted before fees. */
export const MIN_SWAP_INPUT = 10n ** 12n;
/** Largest permitted total radius. */
export const MAX_TOTAL_RADIUS = 10n ** 36n;
/** Largest real reserve of one asset, reserve minus the virtual floor, that the pool stores: 2^96 - 1. */
export const MAX_REAL_RESERVE = 2n ** 96n - 1n;

/** Solve steps that may take a Newton proposal; later steps bisect. */
export const NEWTON_STEPS = 16;
/** Bisections that always close a solve bracket shorter than 2^120. */
export const BISECTION_STEPS = 120;
/** A partition walk moves one initialized tick per step; the bitmap holds at most 199 of them. */
export const MAX_WALK = 199;

/** Lowest usable tick index (p = 0.99999). */
export const MIN_TICK = 40;
/** Highest usable tick index (p = 0.10); the permanent seed lives here and is never a boundary tick. */
export const MAX_TICK = 238;
/** Tick of the permanent seed owned by 0x…dEaD. */
export const SEED_TICK = 238;

/** Number of assets of every Orbital pool. */
export const ASSET_COUNT = 3;
