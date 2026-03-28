use ethnum::{I256, U256};

pub const MIN_TICK: I256 = I256::new(-887272);
pub const MAX_TICK: I256 = I256::new(887272);
pub const MIN_SQRT_RATIO: U256 = U256::new(4295128739u128);
// 1461446703485210103287273052203988822378723970342
// = 0xFFFD8963EFD1FC6A506488495D951D5263988D26
// hi_128 = 0xFFFD8963, lo_128 = 0xEFD1FC6A506488495D951D5263988D26
pub const MAX_SQRT_RATIO: U256 =
    U256::from_words(0xFFFD8963, 0xEFD1FC6A506488495D951D5263988D26);

// 2^160 - 1 = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
// hi_128 = 0xFFFFFFFF, lo_128 = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
const MASK_160: U256 = U256::from_words(0xFFFFFFFF, u128::MAX);

/// Truncate to uint160 range.
fn as_uint160(val: U256) -> U256 {
    val & MASK_160
}

/// Calculates sqrt(1.0001^tick) * 2^96.
///
/// Panics if |tick| > MAX_TICK.
pub fn get_sqrt_ratio_at_tick(tick: I256) -> U256 {
    let abs_tick: U256 = if tick < I256::ZERO {
        (-tick).as_u256()
    } else {
        tick.as_u256()
    };

    assert!(abs_tick <= MAX_TICK.as_u256(), "T");

    let mut ratio: U256 = if (abs_tick & U256::from(0x1u64)) != U256::ZERO {
        U256::new(0xfffcb933bd6fad37aa2d162d1a594001u128)
    } else {
        // 2^128
        U256::from_words(1, 0)
    };

    macro_rules! apply_tick_bit {
        ($bit:expr, $factor:expr) => {
            if (abs_tick & U256::from($bit as u64)) != U256::ZERO {
                ratio = (ratio * U256::new($factor)) >> 128;
            }
        };
    }

    apply_tick_bit!(0x2, 0xfff97272373d413259a46990580e213au128);
    apply_tick_bit!(0x4, 0xfff2e50f5f656932ef12357cf3c7fdccu128);
    apply_tick_bit!(0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0u128);
    apply_tick_bit!(0x10, 0xffcb9843d60f6159c9db58835c926644u128);
    apply_tick_bit!(0x20, 0xff973b41fa98c081472e6896dfb254c0u128);
    apply_tick_bit!(0x40, 0xff2ea16466c96a3843ec78b326b52861u128);
    apply_tick_bit!(0x80, 0xfe5dee046a99a2a811c461f1969c3053u128);
    apply_tick_bit!(0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4u128);
    apply_tick_bit!(0x200, 0xf987a7253ac413176f2b074cf7815e54u128);
    apply_tick_bit!(0x400, 0xf3392b0822b70005940c7a398e4b70f3u128);
    apply_tick_bit!(0x800, 0xe7159475a2c29b7443b29c7fa6e889d9u128);
    apply_tick_bit!(0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825u128);
    apply_tick_bit!(0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5u128);
    apply_tick_bit!(0x4000, 0x70d869a156d2a1b890bb3df62baf32f7u128);
    apply_tick_bit!(0x8000, 0x31be135f97d08fd981231505542fcfa6u128);
    apply_tick_bit!(0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9u128);
    apply_tick_bit!(0x20000, 0x5d6af8dedb81196699c329225ee604u128);
    apply_tick_bit!(0x40000, 0x2216e584f5fa1ea926041bedfe98u128);
    apply_tick_bit!(0x80000, 0x48a170391f7dc42444e8fa2u128);

    if tick > I256::ZERO {
        ratio = U256::MAX / ratio;
    }

    let remainder = ratio % (U256::ONE << 32);
    let extra = if remainder == U256::ZERO {
        U256::ZERO
    } else {
        U256::ONE
    };
    as_uint160((ratio >> 32) + extra)
}

/// Calculates the greatest tick value such that getSqrtRatioAtTick(tick) <= ratio.
///
/// Panics if sqrtPriceX96 < MIN_SQRT_RATIO or sqrtPriceX96 >= MAX_SQRT_RATIO.
pub fn get_tick_at_sqrt_ratio(sqrt_price_x96: U256) -> I256 {
    assert!(
        sqrt_price_x96 >= MIN_SQRT_RATIO && sqrt_price_x96 < MAX_SQRT_RATIO,
        "R"
    );

    let ratio = sqrt_price_x96 << 32;

    let mut r = ratio;
    let mut msb = U256::ZERO;

    // _gt helper inline
    let gt = |a: U256, b: U256| -> U256 {
        if a > b { U256::ONE } else { U256::ZERO }
    };

    let mut f: U256 =
        gt(r, U256::new(0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFu128)) << 7;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::from(0xFFFFFFFFFFFFFFFFu128)) << 6;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::from(0xFFFFFFFFu64)) << 5;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::from(0xFFFFu64)) << 4;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::from(0xFFu64)) << 3;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::from(0xFu64)) << 2;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::from(0x3u64)) << 1;
    msb = msb | f;
    r = r >> f;

    f = gt(r, U256::ONE);
    msb = msb | f;

    if msb >= U256::from(128u64) {
        r = ratio >> (msb - U256::from(127u64));
    } else {
        r = ratio << (U256::from(127u64) - msb);
    }

    // log_2 is int256 in Solidity. (int256(msb) - 128) << 64
    let mut log_2: I256 = (msb.as_i256() - I256::from(128i32)) << 64u32;

    // 14 iterations of squaring
    macro_rules! log2_step {
        ($shift:expr) => {
            r = (r * r) >> 127;
            f = r >> 128;
            // f is 0 or 1 (unsigned), cast to signed for the OR into log_2
            log_2 = log_2 | ((f.as_i256()) << $shift as u32);
            r = r >> f;
        };
    }

    log2_step!(63);
    log2_step!(62);
    log2_step!(61);
    log2_step!(60);
    log2_step!(59);
    log2_step!(58);
    log2_step!(57);
    log2_step!(56);
    log2_step!(55);
    log2_step!(54);
    log2_step!(53);
    log2_step!(52);
    log2_step!(51);

    // Last iteration (no r >>= f after)
    r = (r * r) >> 127;
    f = r >> 128;
    log_2 = log_2 | ((f.as_i256()) << 50u32);

    // log_sqrt10001 = log_2 * 255738958999603826347141 (signed multiply)
    let log_sqrt10001: I256 = log_2 * I256::new(255738958999603826347141i128);

    // tickLow = int24((log_sqrt10001 - 3402992956809132418596140100660247210) >> 128)
    let tick_low_raw: I256 = (log_sqrt10001
        - I256::new(3402992956809132418596140100660247210i128))
        >> 128u32;

    // tickHi = int24((log_sqrt10001 + 291339464771989622907027621153398088495) >> 128)
    let tick_hi_raw: I256 = (log_sqrt10001
        + U256::new(291339464771989622907027621153398088495u128).as_i256())
        >> 128u32;

    let tick_low = as_int_n_24(tick_low_raw);
    let tick_hi = as_int_n_24(tick_hi_raw);

    if tick_low == tick_hi {
        tick_low
    } else if get_sqrt_ratio_at_tick(tick_hi) <= sqrt_price_x96 {
        tick_hi
    } else {
        tick_low
    }
}

/// Equivalent to BigInt.asIntN(24, x) -- truncate to 24 bits and sign-extend.
fn as_int_n_24(x: I256) -> I256 {
    let mask_24 = I256::new((1i128 << 24) - 1);
    let truncated = x & mask_24;
    let sign_bit = I256::ONE << 23u32;
    if (truncated & sign_bit) != I256::ZERO {
        truncated | !mask_24
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants() {
        assert_eq!(MIN_TICK, I256::new(-887272));
        assert_eq!(MAX_TICK, I256::new(887272));
        assert_eq!(MIN_SQRT_RATIO, U256::from(4295128739u64));
    }

    #[test]
    fn test_max_sqrt_ratio() {
        let expected =
            U256::from_words(0xFFFD8963, 0xEFD1FC6A506488495D951D5263988D26);
        assert_eq!(MAX_SQRT_RATIO, expected);
    }

    #[test]
    fn test_get_sqrt_ratio_at_tick_min() {
        let result = get_sqrt_ratio_at_tick(MIN_TICK);
        assert_eq!(result, MIN_SQRT_RATIO);
    }

    #[test]
    fn test_get_sqrt_ratio_at_tick_max() {
        let result = get_sqrt_ratio_at_tick(MAX_TICK);
        assert_eq!(result, MAX_SQRT_RATIO);
    }

    #[test]
    fn test_get_sqrt_ratio_at_tick_zero() {
        let result = get_sqrt_ratio_at_tick(I256::ZERO);
        let q96 = U256::ONE << 96;
        assert_eq!(result, q96);
    }

    #[test]
    fn test_get_tick_at_sqrt_ratio_min() {
        let result = get_tick_at_sqrt_ratio(MIN_SQRT_RATIO);
        assert_eq!(result, MIN_TICK);
    }

    #[test]
    fn test_get_tick_at_sqrt_ratio_q96() {
        let q96 = U256::ONE << 96;
        let result = get_tick_at_sqrt_ratio(q96);
        assert_eq!(result, I256::ZERO);
    }

    #[test]
    fn test_roundtrip_positive_tick() {
        let tick = I256::from(100i32);
        let sqrt_ratio = get_sqrt_ratio_at_tick(tick);
        let computed_tick = get_tick_at_sqrt_ratio(sqrt_ratio);
        assert_eq!(computed_tick, tick);
    }

    #[test]
    fn test_roundtrip_negative_tick() {
        let tick = I256::from(-100i32);
        let sqrt_ratio = get_sqrt_ratio_at_tick(tick);
        let computed_tick = get_tick_at_sqrt_ratio(sqrt_ratio);
        assert_eq!(computed_tick, tick);
    }

    #[test]
    fn test_roundtrip_large_positive_tick() {
        let tick = I256::new(887270);
        let sqrt_ratio = get_sqrt_ratio_at_tick(tick);
        let computed_tick = get_tick_at_sqrt_ratio(sqrt_ratio);
        assert_eq!(computed_tick, tick);
    }

    #[test]
    fn test_roundtrip_large_negative_tick() {
        let tick = I256::new(-887270);
        let sqrt_ratio = get_sqrt_ratio_at_tick(tick);
        let computed_tick = get_tick_at_sqrt_ratio(sqrt_ratio);
        assert_eq!(computed_tick, tick);
    }

    #[test]
    #[should_panic(expected = "T")]
    fn test_get_sqrt_ratio_at_tick_too_large() {
        get_sqrt_ratio_at_tick(MAX_TICK + I256::ONE);
    }

    #[test]
    #[should_panic(expected = "T")]
    fn test_get_sqrt_ratio_at_tick_too_small() {
        get_sqrt_ratio_at_tick(MIN_TICK - I256::ONE);
    }

    #[test]
    #[should_panic(expected = "R")]
    fn test_get_tick_at_sqrt_ratio_too_small() {
        get_tick_at_sqrt_ratio(MIN_SQRT_RATIO - U256::ONE);
    }

    #[test]
    #[should_panic(expected = "R")]
    fn test_get_tick_at_sqrt_ratio_too_large() {
        get_tick_at_sqrt_ratio(MAX_SQRT_RATIO);
    }

    #[test]
    fn test_as_int_n_24() {
        assert_eq!(as_int_n_24(I256::from(100i32)), I256::from(100i32));
        assert_eq!(as_int_n_24(I256::from(-100i32)), I256::from(-100i32));
        assert_eq!(as_int_n_24(I256::new(887272)), I256::new(887272));
        assert_eq!(as_int_n_24(I256::new(-887272)), I256::new(-887272));
    }
}
