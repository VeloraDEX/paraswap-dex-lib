use ethnum::{I256, U256};
use std::collections::HashMap;

// 2^160 - 1: hi_128 = 0xFFFFFFFF, lo_128 = u128::MAX
const MASK_160: U256 = U256::from_words(0xFFFF_FFFF, u128::MAX);

/// An oracle observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OracleObservation {
    pub block_timestamp: U256,
    pub tick_cumulative: I256,
    pub seconds_per_liquidity_cumulative_x128: U256,
    pub initialized: bool,
}

impl Default for OracleObservation {
    fn default() -> Self {
        OracleObservation {
            block_timestamp: U256::ZERO,
            tick_cumulative: I256::ZERO,
            seconds_per_liquidity_cumulative_x128: U256::ZERO,
            initialized: false,
        }
    }
}

/// Observation candidate pair used in binary search.
pub struct OracleObservationCandidates {
    pub before_or_at: OracleObservation,
    pub at_or_after: OracleObservation,
}

/// Transforms a previous observation into a new one, given the time elapsed and the
/// current tick and liquidity values.
///
/// The `block_timestamp` parameter corresponds to `state.blockTimestamp` in the TS version.
/// In the original TS, `transform` receives `state` and uses `state.blockTimestamp` for the
/// output's blockTimestamp. Here we pass it explicitly as `block_timestamp_state`.
pub fn transform(
    last: &OracleObservation,
    block_timestamp: U256,
    block_timestamp_state: U256,
    tick: I256,
    liquidity: U256,
) -> OracleObservation {
    let delta = block_timestamp - last.block_timestamp;

    // tickCumulative: last.tickCumulative + BigInt.asIntN(56, tick) * delta
    let tick_i56 = sign_extend_i56(tick);
    let delta_signed = delta.as_i256();
    let tick_cumulative = last.tick_cumulative + tick_i56 * delta_signed;

    // secondsPerLiquidityCumulativeX128:
    //   last.spl + (BigInt.asUintN(160, delta) << 128) / (liquidity > 0 ? liquidity : 1)
    let delta_u160 = delta & MASK_160;
    let numerator = delta_u160 << 128;
    let denominator = if liquidity > U256::ZERO {
        liquidity
    } else {
        U256::ONE
    };
    let seconds_per_liquidity_cumulative_x128 =
        last.seconds_per_liquidity_cumulative_x128 + numerator / denominator;

    OracleObservation {
        block_timestamp: block_timestamp_state,
        tick_cumulative,
        seconds_per_liquidity_cumulative_x128,
        initialized: true,
    }
}

/// Writes an oracle observation to the array, returning the updated index and cardinality.
///
/// `block_timestamp_state` is the state's block timestamp (used for comparison and as the
/// new observation's timestamp).
///
/// Returns `(updated_index, updated_cardinality)`.
pub fn write(
    observations: &mut HashMap<u16, OracleObservation>,
    index: u16,
    block_timestamp: U256,
    block_timestamp_state: U256,
    tick: I256,
    liquidity: U256,
    cardinality: u16,
    cardinality_next: u16,
) -> (u16, u16) {
    let last = observations
        .get(&index)
        .copied()
        .expect("last observation must exist");

    // If the block timestamp hasn't changed, no update needed
    if last.block_timestamp == block_timestamp_state {
        return (index, cardinality);
    }

    let cardinality_updated = if cardinality_next > cardinality && index == cardinality - 1 {
        cardinality_next
    } else {
        cardinality
    };

    let index_updated = ((index as u32 + 1) % cardinality_updated as u32) as u16;

    let new_observation = transform(&last, block_timestamp, block_timestamp_state, tick, liquidity);
    observations.insert(index_updated, new_observation);

    // In the TS code, if indexUpdated !== index, the old index is deleted
    if index_updated != index {
        observations.remove(&index);
    }

    (index_updated, cardinality_updated)
}

/// Compares two timestamps with overflow-aware less-than-or-equal.
///
/// This handles the uint32 overflow case: if both timestamps are <= time, compare normally.
/// Otherwise, adjust the one that hasn't overflowed by adding 2^32.
pub fn lte(time: U256, a: U256, b: U256) -> bool {
    if a <= time && b <= time {
        return a <= b;
    }

    let two_pow_32 = U256::ONE << 32;
    let a_adjusted = if a > time { a } else { a + two_pow_32 };
    let b_adjusted = if b > time { b } else { b + two_pow_32 };
    a_adjusted <= b_adjusted
}

/// Binary search for the observations surrounding a target timestamp.
pub fn binary_search(
    observations: &HashMap<u16, OracleObservation>,
    time: U256,
    target: U256,
    index: u16,
    cardinality: u16,
) -> OracleObservationCandidates {
    let mut l = ((index as u32 + 1) % cardinality as u32) as u32;
    let mut r = l + cardinality as u32 - 1;

    loop {
        let i = (l + r) / 2;
        let idx = (i % cardinality as u32) as u16;
        let before_or_at = observations
            .get(&idx)
            .copied()
            .unwrap_or_default();

        if !before_or_at.initialized {
            l = i + 1;
            continue;
        }

        let after_idx = ((i + 1) % cardinality as u32) as u16;
        let at_or_after = observations
            .get(&after_idx)
            .copied()
            .unwrap_or_default();

        let target_at_or_after = lte(time, before_or_at.block_timestamp, target);

        if target_at_or_after && lte(time, target, at_or_after.block_timestamp) {
            return OracleObservationCandidates {
                before_or_at,
                at_or_after,
            };
        }

        if !target_at_or_after {
            r = i - 1;
        } else {
            l = i + 1;
        }
    }
}

/// Returns the observations surrounding a target timestamp.
///
/// `block_timestamp_state` is the state's block timestamp used for transform.
pub fn get_surrounding_observations(
    observations: &HashMap<u16, OracleObservation>,
    time: U256,
    target: U256,
    block_timestamp_state: U256,
    tick: I256,
    index: u16,
    liquidity: U256,
    cardinality: u16,
) -> OracleObservationCandidates {
    let before_or_at = observations
        .get(&index)
        .copied()
        .unwrap_or_default();

    if lte(time, before_or_at.block_timestamp, target) {
        if before_or_at.block_timestamp == target {
            return OracleObservationCandidates {
                before_or_at,
                at_or_after: before_or_at,
            };
        } else {
            let at_or_after = transform(
                &before_or_at,
                target,
                block_timestamp_state,
                tick,
                liquidity,
            );
            return OracleObservationCandidates {
                before_or_at,
                at_or_after,
            };
        }
    }

    let oldest_idx = ((index as u32 + 1) % cardinality as u32) as u16;
    let mut before_or_at = observations
        .get(&oldest_idx)
        .copied()
        .unwrap_or_default();

    if !before_or_at.initialized {
        before_or_at = observations.get(&0u16).copied().unwrap_or_default();
    }

    assert!(
        lte(time, before_or_at.block_timestamp, target),
        "OLD"
    );

    binary_search(observations, time, target, index, cardinality)
}

/// Returns the accumulator values as of `secondsAgo` seconds ago from the given time.
///
/// `block_timestamp_state` is the state's block timestamp.
///
/// Returns `(tick_cumulative, seconds_per_liquidity_cumulative_x128)`.
pub fn observe_single(
    observations: &HashMap<u16, OracleObservation>,
    time: U256,
    seconds_ago: U256,
    block_timestamp_state: U256,
    tick: I256,
    index: u16,
    liquidity: U256,
    cardinality: u16,
) -> (I256, U256) {
    if seconds_ago == U256::ZERO {
        let mut last = observations
            .get(&index)
            .copied()
            .unwrap_or_default();
        if last.block_timestamp != time {
            last = transform(&last, time, block_timestamp_state, tick, liquidity);
        }
        return (
            last.tick_cumulative,
            last.seconds_per_liquidity_cumulative_x128,
        );
    }

    let target = time - seconds_ago;

    let OracleObservationCandidates {
        before_or_at,
        at_or_after,
    } = get_surrounding_observations(
        observations,
        time,
        target,
        block_timestamp_state,
        tick,
        index,
        liquidity,
        cardinality,
    );

    if target == before_or_at.block_timestamp {
        return (
            before_or_at.tick_cumulative,
            before_or_at.seconds_per_liquidity_cumulative_x128,
        );
    } else if target == at_or_after.block_timestamp {
        return (
            at_or_after.tick_cumulative,
            at_or_after.seconds_per_liquidity_cumulative_x128,
        );
    } else {
        let observation_time_delta =
            at_or_after.block_timestamp - before_or_at.block_timestamp;
        let target_delta = target - before_or_at.block_timestamp;
        let observation_time_delta_signed = observation_time_delta.as_i256();
        let target_delta_signed = target_delta.as_i256();

        let tick_cumulative = before_or_at.tick_cumulative
            + ((at_or_after.tick_cumulative - before_or_at.tick_cumulative)
                / observation_time_delta_signed)
                * target_delta_signed;

        // secondsPerLiquidityCumulativeX128 interpolation:
        // beforeOrAt.spl + BigInt.asUintN(160,
        //   (BigInt.asUintN(256, atOrAfter.spl - beforeOrAt.spl) * targetDelta) / observationTimeDelta
        // )
        let spl_diff = at_or_after.seconds_per_liquidity_cumulative_x128
            .wrapping_sub(before_or_at.seconds_per_liquidity_cumulative_x128);
        let spl_interpolated = (spl_diff * target_delta) / observation_time_delta;
        let spl_masked = spl_interpolated & MASK_160;
        let seconds_per_liquidity_cumulative_x128 =
            before_or_at.seconds_per_liquidity_cumulative_x128 + spl_masked;

        return (tick_cumulative, seconds_per_liquidity_cumulative_x128);
    }
}

/// Sign-extend a value to signed 56-bit (equivalent to BigInt.asIntN(56, x)).
fn sign_extend_i56(val: I256) -> I256 {
    let mask: I256 = (I256::ONE << 56) - I256::ONE;
    let masked = val & mask;
    if masked & (I256::ONE << 55) != I256::ZERO {
        masked | !mask
    } else {
        masked
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_obs(
        block_timestamp: u64,
        tick_cumulative: i64,
        spl: u64,
        initialized: bool,
    ) -> OracleObservation {
        OracleObservation {
            block_timestamp: U256::from(block_timestamp),
            tick_cumulative: I256::from(tick_cumulative),
            seconds_per_liquidity_cumulative_x128: U256::from(spl),
            initialized,
        }
    }

    #[test]
    fn test_lte_both_below_time() {
        assert!(lte(U256::from(100u64), U256::from(50u64), U256::from(60u64)));
        assert!(!lte(U256::from(100u64), U256::from(60u64), U256::from(50u64)));
    }

    #[test]
    fn test_lte_equal() {
        assert!(lte(U256::from(100u64), U256::from(50u64), U256::from(50u64)));
    }

    #[test]
    fn test_lte_overflow_case() {
        // a is past overflow, b is before overflow
        // time = 10, a = 5 (not overflowed), b = 15 (overflowed past time)
        // a <= time? yes. b <= time? no.
        // a_adjusted = 5 + 2^32, b_adjusted = 15
        // 5 + 2^32 > 15, so a is NOT <= b
        assert!(!lte(U256::from(10u64), U256::from(5u64), U256::from(15u64)));
    }

    #[test]
    fn test_transform_basic() {
        let last = make_obs(100, 5000, 10000, true);
        let result = transform(
            &last,
            U256::from(110u64), // blockTimestamp
            U256::from(110u64), // state.blockTimestamp
            I256::from(50i64),  // tick
            U256::from(1000u64), // liquidity
        );
        assert_eq!(result.block_timestamp, U256::from(110u64));
        // tickCumulative = 5000 + 50 * 10 = 5500
        assert_eq!(result.tick_cumulative, I256::from(5500i64));
        assert!(result.initialized);
    }

    #[test]
    fn test_transform_zero_liquidity() {
        let last = make_obs(100, 0, 0, true);
        let result = transform(
            &last,
            U256::from(110u64),
            U256::from(110u64),
            I256::from(10i64),
            U256::ZERO, // zero liquidity => denominator becomes 1
        );
        // tickCumulative = 0 + 10 * 10 = 100
        assert_eq!(result.tick_cumulative, I256::from(100i64));
        // secondsPerLiquidity = 0 + (10 << 128) / 1 = 10 << 128
        let expected_spl = U256::from(10u64) << 128;
        assert_eq!(result.seconds_per_liquidity_cumulative_x128, expected_spl);
    }

    #[test]
    fn test_write_same_timestamp_noop() {
        let mut observations = HashMap::new();
        observations.insert(0u16, make_obs(100, 0, 0, true));

        let (idx, card) = write(
            &mut observations,
            0,                    // index
            U256::from(100u64),   // blockTimestamp
            U256::from(100u64),   // state.blockTimestamp (same)
            I256::from(10i64),
            U256::from(1000u64),
            1,   // cardinality
            1,   // cardinalityNext
        );
        assert_eq!(idx, 0);
        assert_eq!(card, 1);
    }

    #[test]
    fn test_write_new_observation() {
        let mut observations = HashMap::new();
        observations.insert(0u16, make_obs(100, 0, 0, true));

        let (idx, card) = write(
            &mut observations,
            0,
            U256::from(110u64),
            U256::from(110u64),
            I256::from(10i64),
            U256::from(1000u64),
            1,
            2,
        );
        // cardinality should increase because cardinalityNext > cardinality and index == cardinality - 1
        assert_eq!(card, 2);
        assert_eq!(idx, 1);
        assert!(observations.get(&1u16).unwrap().initialized);
    }

    #[test]
    fn test_observe_single_zero_seconds_ago() {
        let mut observations = HashMap::new();
        observations.insert(0u16, make_obs(100, 5000, 10000, true));

        let (tick_cum, spl) = observe_single(
            &observations,
            U256::from(100u64),
            U256::ZERO,
            U256::from(100u64),
            I256::from(50i64),
            0,
            U256::from(1000u64),
            1,
        );
        // secondsAgo == 0 and last.blockTimestamp == time, so return last values directly
        assert_eq!(tick_cum, I256::from(5000i64));
        assert_eq!(spl, U256::from(10000u64));
    }

    #[test]
    fn test_observe_single_transforms_when_timestamp_differs() {
        let mut observations = HashMap::new();
        observations.insert(0u16, make_obs(100, 5000, 10000, true));

        let (tick_cum, _spl) = observe_single(
            &observations,
            U256::from(110u64), // current time
            U256::ZERO,         // secondsAgo = 0
            U256::from(110u64),
            I256::from(50i64),  // current tick
            0,
            U256::from(1000u64),
            1,
        );
        // Should transform: tickCumulative = 5000 + 50 * 10 = 5500
        assert_eq!(tick_cum, I256::from(5500i64));
    }

    #[test]
    fn test_sign_extend_i56_positive() {
        let val = I256::from(42i64);
        assert_eq!(sign_extend_i56(val), I256::from(42i64));
    }

    #[test]
    fn test_sign_extend_i56_negative() {
        let val = I256::from(-1i64);
        let result = sign_extend_i56(val);
        assert_eq!(result, I256::from(-1i64));
    }
}
