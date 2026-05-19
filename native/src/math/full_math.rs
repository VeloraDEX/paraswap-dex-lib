use ethnum::U256;

/// Calculates floor(a * b / denominator).
///
/// The TS version uses BigInt which has arbitrary precision, so `a * b` never
/// overflows. We replicate this by widening to 512-bit via two U256 halves.
///
/// Panics if the result exceeds U256::MAX or denominator is zero.
pub fn mul_div(a: U256, b: U256, denominator: U256) -> U256 {
    assert!(denominator > U256::ZERO, "denominator must be > 0");
    let (lo, hi) = widening_mul(a, b);
    let (quot, _) = div_512_by_256(lo, hi, denominator);
    quot
}

/// Calculates ceil(a * b / denominator).
///
/// Panics if the result exceeds U256::MAX or denominator is zero.
pub fn mul_div_rounding_up(a: U256, b: U256, denominator: U256) -> U256 {
    assert!(denominator > U256::ZERO, "denominator must be > 0");
    // result = (a * b + denominator - 1) / denominator
    let (lo, hi) = widening_mul(a, b);
    // add (denominator - 1) to the 512-bit product
    let addend = denominator - U256::ONE;
    let (lo2, carry) = lo.overflowing_add(addend);
    let hi2 = if carry { hi + U256::ONE } else { hi };
    let (quot, _) = div_512_by_256(lo2, hi2, denominator);
    quot
}

/// Returns (lo, hi) such that a * b = hi * 2^256 + lo.
fn widening_mul(a: U256, b: U256) -> (U256, U256) {
    let mask128 = (U256::ONE << 128) - U256::ONE;

    let a_lo = a & mask128;
    let a_hi = a >> 128;
    let b_lo = b & mask128;
    let b_hi = b >> 128;

    let p0: U256 = a_lo * b_lo;
    let p1: U256 = a_lo * b_hi;
    let p2: U256 = a_hi * b_lo;
    let p3: U256 = a_hi * b_hi;

    let lo: U256 = p0;
    let hi: U256 = p3;

    // Add p1 << 128
    let p1_lo = p1 << 128;
    let p1_hi = p1 >> 128;
    let (lo, c1) = lo.overflowing_add(p1_lo);
    let hi = hi + p1_hi + if c1 { U256::ONE } else { U256::ZERO };

    // Add p2 << 128
    let p2_lo = p2 << 128;
    let p2_hi = p2 >> 128;
    let (lo, c2) = lo.overflowing_add(p2_lo);
    let hi = hi + p2_hi + if c2 { U256::ONE } else { U256::ZERO };

    (lo, hi)
}

/// Divides a 512-bit number (lo + hi * 2^256) by a 256-bit denominator.
/// Returns (quotient, remainder). Panics if quotient overflows U256.
fn div_512_by_256(lo: U256, hi: U256, d: U256) -> (U256, U256) {
    assert!(d > U256::ZERO, "division by zero");

    if hi == U256::ZERO {
        return (lo / d, lo % d);
    }

    assert!(hi < d, "mul_div result overflows U256");

    // Split lo into two 128-bit halves and do two rounds of division.
    let mask128 = (U256::ONE << 128) - U256::ONE;
    let lo_hi = (lo >> 128) & mask128;
    let lo_lo = lo & mask128;

    // First round: divide (hi * 2^128 + lo_hi) by d
    let (q_hi, r1) = div_384_by_256(lo_hi, hi, d);

    // Second round: divide (r1 * 2^128 + lo_lo) by d
    let (q_lo, rem) = div_384_by_256(lo_lo, r1, d);

    let quotient = (q_hi << 128) + q_lo;
    (quotient, rem)
}

/// Divides (hi * 2^128 + lo_128) by d, where hi < d and lo_128 < 2^128.
/// Returns (quotient, remainder).
fn div_384_by_256(lo_128: U256, hi: U256, d: U256) -> (U256, U256) {
    let mask128 = (U256::ONE << 128) - U256::ONE;
    let hi_upper = hi >> 128;

    if hi_upper == U256::ZERO {
        // hi fits in 128 bits, so hi * 2^128 + lo_128 fits in 256 bits
        let numerator = (hi << 128) | lo_128;
        return (numerator / d, numerator % d);
    }

    // hi doesn't fit in 128 bits. Use bit-by-bit long division.
    // The quotient fits in at most ~129 bits (since hi < d).
    let _ = mask128;
    let mut remainder = hi;
    let mut quotient = U256::ZERO;

    for i in (0..128).rev() {
        let bit = (lo_128 >> i) & U256::ONE;

        // Check if shifting left would overflow
        let overflow = remainder >> 255 != U256::ZERO;
        remainder = (remainder << 1) | bit;

        if overflow || remainder >= d {
            remainder = remainder.wrapping_sub(d);
            quotient = quotient | (U256::ONE << i);
        }
    }

    (quotient, remainder)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mul_div_simple() {
        assert_eq!(
            mul_div(U256::from(6u64), U256::from(7u64), U256::from(3u64)),
            U256::from(14u64)
        );
    }

    #[test]
    fn test_mul_div_large() {
        assert_eq!(
            mul_div(U256::MAX, U256::ONE, U256::ONE),
            U256::MAX
        );
    }

    #[test]
    fn test_mul_div_rounding_up_exact() {
        assert_eq!(
            mul_div_rounding_up(U256::from(6u64), U256::from(7u64), U256::from(3u64)),
            U256::from(14u64)
        );
    }

    #[test]
    fn test_mul_div_rounding_up_rounds() {
        // 5 * 7 / 3 = 35/3 = 11.666... -> ceil = 12
        assert_eq!(
            mul_div_rounding_up(U256::from(5u64), U256::from(7u64), U256::from(3u64)),
            U256::from(12u64)
        );
    }

    #[test]
    fn test_mul_div_floor() {
        // 5 * 7 / 3 = 35/3 = 11.666... -> floor = 11
        assert_eq!(
            mul_div(U256::from(5u64), U256::from(7u64), U256::from(3u64)),
            U256::from(11u64)
        );
    }

    #[test]
    fn test_mul_div_large_product() {
        let a = U256::ONE << 200;
        let b = U256::ONE << 200;
        let d = U256::ONE << 200;
        assert_eq!(mul_div(a, b, d), U256::ONE << 200);
    }

    #[test]
    fn test_mul_div_max_times_max() {
        assert_eq!(mul_div(U256::MAX, U256::MAX, U256::MAX), U256::MAX);
    }

    #[test]
    #[should_panic]
    fn test_mul_div_overflow() {
        mul_div(U256::MAX, U256::MAX, U256::ONE);
    }

    #[test]
    fn test_mul_div_rounding_up_large() {
        let a = U256::ONE << 128;
        let b = U256::ONE << 128;
        let d = (U256::ONE << 128) + U256::ONE;
        let result = mul_div_rounding_up(a, b, d);
        assert!(result > U256::ZERO);
    }

    #[test]
    fn test_widening_mul_simple() {
        let (lo, hi) = widening_mul(U256::from(3u64), U256::from(7u64));
        assert_eq!(lo, U256::from(21u64));
        assert_eq!(hi, U256::ZERO);
    }

    #[test]
    fn test_widening_mul_large() {
        let (lo, hi) = widening_mul(U256::MAX, U256::from(2u64));
        assert_eq!(hi, U256::ONE);
        assert_eq!(lo, U256::MAX - U256::ONE);
    }

    #[test]
    fn test_mul_div_uniswap_style() {
        // Test case from Uniswap V3: mulDiv(Q128, Q128, Q128) = Q128
        let q128 = U256::ONE << 128;
        assert_eq!(mul_div(q128, q128, q128), q128);
    }
}
