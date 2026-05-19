use ethnum::{I256, U256};
use std::collections::HashMap;
use super::liquidity_math;

/// Information stored for each initialized individual tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TickInfo {
    pub liquidity_gross: U256,
    pub liquidity_net: I256,
    pub initialized: bool,
}

impl Default for TickInfo {
    fn default() -> Self {
        TickInfo {
            liquidity_gross: U256::ZERO,
            liquidity_net: I256::ZERO,
            initialized: false,
        }
    }
}

/// Truncate an I256 to signed 128-bit range, matching `BigInt.asIntN(128, x)`.
fn as_int128(val: I256) -> I256 {
    // Mask to 128 bits, then sign-extend from bit 127
    let mask: I256 = (I256::ONE << 128) - I256::ONE;
    let masked = val & mask;
    if masked & (I256::ONE << 127) != I256::ZERO {
        masked | !mask
    } else {
        masked
    }
}

/// Updates a tick and returns whether the tick was flipped from initialized to uninitialized,
/// or vice versa.
///
/// Parameters:
/// - `ticks`: mutable reference to tick storage
/// - `tick`: the tick to update
/// - `tick_current`: the current tick
/// - `liquidity_delta`: signed liquidity change
/// - `upper`: true if this is the upper tick of a position being modified
/// - `max_liquidity`: maximum liquidity per tick
///
/// Returns `true` if the tick was flipped (transitioned between zero and non-zero gross liquidity).
pub fn update(
    ticks: &mut HashMap<i32, TickInfo>,
    tick: i32,
    _tick_current: I256,
    liquidity_delta: I256,
    upper: bool,
    max_liquidity: U256,
) -> bool {
    let info = ticks.entry(tick).or_insert_with(TickInfo::default);

    let liquidity_gross_before = info.liquidity_gross;
    let liquidity_gross_after = liquidity_math::add_delta(liquidity_gross_before, liquidity_delta);

    assert!(
        liquidity_gross_after <= max_liquidity,
        "LO"
    );

    let flipped = (liquidity_gross_after == U256::ZERO) != (liquidity_gross_before == U256::ZERO);

    if liquidity_gross_before == U256::ZERO {
        info.initialized = true;
    }

    info.liquidity_gross = liquidity_gross_after;

    // info.liquidityNet = upper
    //   ? BigInt.asIntN(128, BigInt.asIntN(256, info.liquidityNet) - liquidityDelta)
    //   : BigInt.asIntN(128, BigInt.asIntN(256, info.liquidityNet) + liquidityDelta)
    let net_i256 = info.liquidity_net; // already I256 (256-bit signed)
    info.liquidity_net = if upper {
        as_int128(net_i256 - liquidity_delta)
    } else {
        as_int128(net_i256 + liquidity_delta)
    };

    flipped
}

/// Clears tick data. Equivalent to `delete state.ticks[tick]`.
pub fn clear(ticks: &mut HashMap<i32, TickInfo>, tick: i32) {
    ticks.remove(&tick);
}

/// Transitions to the next tick as needed by crossing an initialized tick.
/// Returns the `liquidity_net` of the crossed tick.
pub fn cross(ticks: &HashMap<i32, TickInfo>, tick: i32) -> I256 {
    let info = ticks.get(&tick).expect("tick not found in cross");
    info.liquidity_net
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_new_tick() {
        let mut ticks = HashMap::new();
        let flipped = update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(1000i64),
            false,
            U256::from(1_000_000u64),
        );
        assert!(flipped);
        let info = ticks.get(&100).unwrap();
        assert_eq!(info.liquidity_gross, U256::from(1000u64));
        assert_eq!(info.liquidity_net, I256::from(1000i64));
        assert!(info.initialized);
    }

    #[test]
    fn test_update_existing_tick() {
        let mut ticks = HashMap::new();
        update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(1000i64),
            false,
            U256::from(1_000_000u64),
        );
        let flipped = update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(500i64),
            false,
            U256::from(1_000_000u64),
        );
        assert!(!flipped); // Not flipped because it was already initialized
        let info = ticks.get(&100).unwrap();
        assert_eq!(info.liquidity_gross, U256::from(1500u64));
        assert_eq!(info.liquidity_net, I256::from(1500i64));
    }

    #[test]
    fn test_update_upper_tick() {
        let mut ticks = HashMap::new();
        let flipped = update(
            &mut ticks,
            200,
            I256::from(50i64),
            I256::from(1000i64),
            true,
            U256::from(1_000_000u64),
        );
        assert!(flipped);
        let info = ticks.get(&200).unwrap();
        assert_eq!(info.liquidity_gross, U256::from(1000u64));
        // Upper tick: liquidityNet = -liquidityDelta
        assert_eq!(info.liquidity_net, I256::from(-1000i64));
    }

    #[test]
    fn test_update_removes_liquidity_flips() {
        let mut ticks = HashMap::new();
        update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(1000i64),
            false,
            U256::from(1_000_000u64),
        );
        let flipped = update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(-1000i64),
            false,
            U256::from(1_000_000u64),
        );
        assert!(flipped);
        let info = ticks.get(&100).unwrap();
        assert_eq!(info.liquidity_gross, U256::ZERO);
        assert_eq!(info.liquidity_net, I256::ZERO);
    }

    #[test]
    #[should_panic(expected = "LO")]
    fn test_update_exceeds_max_liquidity() {
        let mut ticks = HashMap::new();
        update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(2000i64),
            false,
            U256::from(1000u64), // max is 1000
        );
    }

    #[test]
    fn test_clear() {
        let mut ticks = HashMap::new();
        update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(1000i64),
            false,
            U256::from(1_000_000u64),
        );
        assert!(ticks.contains_key(&100));
        clear(&mut ticks, 100);
        assert!(!ticks.contains_key(&100));
    }

    #[test]
    fn test_cross() {
        let mut ticks = HashMap::new();
        update(
            &mut ticks,
            100,
            I256::from(50i64),
            I256::from(1000i64),
            false,
            U256::from(1_000_000u64),
        );
        let net = cross(&ticks, 100);
        assert_eq!(net, I256::from(1000i64));
    }

    #[test]
    #[should_panic]
    fn test_cross_nonexistent_tick() {
        let ticks = HashMap::new();
        cross(&ticks, 100);
    }
}
