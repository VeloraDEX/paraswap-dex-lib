use ethnum::{I256, U256};
use super::full_math;
use super::unsafe_math;

const RESOLUTION: u32 = 96;
const Q96: U256 = U256::from_words(0, 1u128 << 96);
// 2^160 - 1: hi_128 = 0xFFFFFFFF, lo_128 = u128::MAX
const MAX_UINT160: U256 = U256::from_words(0xFFFFFFFF, u128::MAX);

/// Truncate to uint160 range.
fn as_uint160(val: U256) -> U256 {
    val & MAX_UINT160
}

pub fn get_next_sqrt_price_from_amount0_rounding_up(
    sqrt_p_x96: U256,
    liquidity: U256,
    amount: U256,
    add: bool,
) -> U256 {
    if amount == U256::ZERO {
        return sqrt_p_x96;
    }
    let numerator1 = liquidity << RESOLUTION;

    let product = amount * sqrt_p_x96;
    if add {
        if product / amount == sqrt_p_x96 {
            let denominator = numerator1 + product;
            if denominator >= numerator1 {
                return as_uint160(full_math::mul_div_rounding_up(
                    numerator1,
                    sqrt_p_x96,
                    denominator,
                ));
            }
        }
        as_uint160(unsafe_math::div_rounding_up(
            numerator1,
            numerator1 / sqrt_p_x96 + amount,
        ))
    } else {
        assert!(
            product / amount == sqrt_p_x96 && numerator1 > product,
            "product / amount == sqrt_p_x96 && numerator1 > product"
        );
        let denominator = numerator1 - product;
        as_uint160(full_math::mul_div_rounding_up(
            numerator1,
            sqrt_p_x96,
            denominator,
        ))
    }
}

pub fn get_next_sqrt_price_from_amount1_rounding_down(
    sqrt_p_x96: U256,
    liquidity: U256,
    amount: U256,
    add: bool,
) -> U256 {
    if add {
        let quotient = if amount <= MAX_UINT160 {
            (amount << RESOLUTION) / liquidity
        } else {
            full_math::mul_div(amount, Q96, liquidity)
        };
        as_uint160(sqrt_p_x96 + quotient)
    } else {
        let quotient = if amount <= MAX_UINT160 {
            unsafe_math::div_rounding_up(amount << RESOLUTION, liquidity)
        } else {
            full_math::mul_div_rounding_up(amount, Q96, liquidity)
        };
        assert!(sqrt_p_x96 > quotient, "sqrt_p_x96 > quotient");
        as_uint160(sqrt_p_x96 - quotient)
    }
}

pub fn get_next_sqrt_price_from_input(
    sqrt_p_x96: U256,
    liquidity: U256,
    amount_in: U256,
    zero_for_one: bool,
) -> U256 {
    assert!(sqrt_p_x96 > U256::ZERO, "sqrt_p_x96 > 0");
    assert!(liquidity > U256::ZERO, "liquidity > 0");

    if zero_for_one {
        get_next_sqrt_price_from_amount0_rounding_up(sqrt_p_x96, liquidity, amount_in, true)
    } else {
        get_next_sqrt_price_from_amount1_rounding_down(sqrt_p_x96, liquidity, amount_in, true)
    }
}

pub fn get_next_sqrt_price_from_output(
    sqrt_p_x96: U256,
    liquidity: U256,
    amount_out: U256,
    zero_for_one: bool,
) -> U256 {
    assert!(sqrt_p_x96 > U256::ZERO, "sqrt_p_x96 > 0");
    assert!(liquidity > U256::ZERO, "liquidity > 0");

    if zero_for_one {
        get_next_sqrt_price_from_amount1_rounding_down(sqrt_p_x96, liquidity, amount_out, false)
    } else {
        get_next_sqrt_price_from_amount0_rounding_up(sqrt_p_x96, liquidity, amount_out, false)
    }
}

pub fn get_amount0_delta(
    sqrt_ratio_a_x96: U256,
    sqrt_ratio_b_x96: U256,
    liquidity: U256,
    round_up: bool,
) -> U256 {
    let (sqrt_ratio_a_x96, sqrt_ratio_b_x96) = if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
        (sqrt_ratio_b_x96, sqrt_ratio_a_x96)
    } else {
        (sqrt_ratio_a_x96, sqrt_ratio_b_x96)
    };

    let numerator1 = liquidity << RESOLUTION;
    let numerator2 = sqrt_ratio_b_x96 - sqrt_ratio_a_x96;

    assert!(sqrt_ratio_a_x96 > U256::ZERO, "sqrt_ratio_a_x96 > 0");

    if round_up {
        unsafe_math::div_rounding_up(
            full_math::mul_div_rounding_up(numerator1, numerator2, sqrt_ratio_b_x96),
            sqrt_ratio_a_x96,
        )
    } else {
        full_math::mul_div(numerator1, numerator2, sqrt_ratio_b_x96) / sqrt_ratio_a_x96
    }
}

pub fn get_amount1_delta(
    sqrt_ratio_a_x96: U256,
    sqrt_ratio_b_x96: U256,
    liquidity: U256,
    round_up: bool,
) -> U256 {
    let (sqrt_ratio_a_x96, sqrt_ratio_b_x96) = if sqrt_ratio_a_x96 > sqrt_ratio_b_x96 {
        (sqrt_ratio_b_x96, sqrt_ratio_a_x96)
    } else {
        (sqrt_ratio_a_x96, sqrt_ratio_b_x96)
    };

    if round_up {
        full_math::mul_div_rounding_up(
            liquidity,
            sqrt_ratio_b_x96 - sqrt_ratio_a_x96,
            Q96,
        )
    } else {
        full_math::mul_div(liquidity, sqrt_ratio_b_x96 - sqrt_ratio_a_x96, Q96)
    }
}

/// Signed version: _getAmount0DeltaO with signed liquidity.
/// Equivalent to TS SqrtPriceMath._getAmount0DeltaO.
pub fn get_amount0_delta_signed(
    sqrt_ratio_a_x96: U256,
    sqrt_ratio_b_x96: U256,
    liquidity: I256,
) -> I256 {
    let mask_128 = (U256::ONE << 128) - U256::ONE;
    if liquidity < I256::ZERO {
        // BigInt.asUintN(128, -liquidity)
        let abs_liq = (-liquidity).as_u256() & mask_128;
        let delta = get_amount0_delta(sqrt_ratio_a_x96, sqrt_ratio_b_x96, abs_liq, false);
        // -BigInt.asIntN(256, delta)
        -(delta.as_i256())
    } else {
        // BigInt.asUintN(128, liquidity)
        let liq_u = liquidity.as_u256() & mask_128;
        let delta = get_amount0_delta(sqrt_ratio_a_x96, sqrt_ratio_b_x96, liq_u, true);
        // BigInt.asIntN(256, delta)
        delta.as_i256()
    }
}

/// Signed version: _getAmount1DeltaO with signed liquidity.
/// Equivalent to TS SqrtPriceMath._getAmount1DeltaO.
pub fn get_amount1_delta_signed(
    sqrt_ratio_a_x96: U256,
    sqrt_ratio_b_x96: U256,
    liquidity: I256,
) -> I256 {
    let mask_128 = (U256::ONE << 128) - U256::ONE;
    if liquidity < I256::ZERO {
        let abs_liq = (-liquidity).as_u256() & mask_128;
        let delta = get_amount1_delta(sqrt_ratio_a_x96, sqrt_ratio_b_x96, abs_liq, false);
        -(delta.as_i256())
    } else {
        let liq_u = liquidity.as_u256() & mask_128;
        let delta = get_amount1_delta(sqrt_ratio_a_x96, sqrt_ratio_b_x96, liq_u, true);
        delta.as_i256()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_amount0_delta_basic() {
        let sqrt_a = U256::from(79228162514264337593543950336u128); // Q96 * 1
        let sqrt_b = U256::from(158456325028528675187087900672u128); // Q96 * 2
        let liquidity = U256::from(1_000_000u64);
        let result = get_amount0_delta(sqrt_a, sqrt_b, liquidity, true);
        assert!(result > U256::ZERO);
    }

    #[test]
    fn test_get_amount1_delta_basic() {
        let sqrt_a = U256::from(79228162514264337593543950336u128); // Q96 * 1
        let sqrt_b = U256::from(158456325028528675187087900672u128); // Q96 * 2
        let liquidity = U256::from(1_000_000u64);
        let result = get_amount1_delta(sqrt_a, sqrt_b, liquidity, true);
        assert!(result > U256::ZERO);
    }

    #[test]
    fn test_get_next_sqrt_price_from_input_zero_for_one() {
        let sqrt_p = U256::from(79228162514264337593543950336u128);
        let liquidity = U256::from(1_000_000_000_000u64);
        let amount = U256::from(1_000_000u64);
        let result = get_next_sqrt_price_from_input(sqrt_p, liquidity, amount, true);
        assert!(result > U256::ZERO);
        assert!(result <= sqrt_p);
    }

    #[test]
    fn test_get_next_sqrt_price_from_input_one_for_zero() {
        let sqrt_p = U256::from(79228162514264337593543950336u128);
        let liquidity = U256::from(1_000_000_000_000u64);
        let amount = U256::from(1_000_000u64);
        let result = get_next_sqrt_price_from_input(sqrt_p, liquidity, amount, false);
        assert!(result >= sqrt_p);
    }

    #[test]
    fn test_get_amount0_delta_symmetric() {
        let sqrt_a = U256::from(79228162514264337593543950336u128);
        let sqrt_b = U256::from(158456325028528675187087900672u128);
        let liquidity = U256::from(1_000_000u64);
        let r1 = get_amount0_delta(sqrt_a, sqrt_b, liquidity, true);
        let r2 = get_amount0_delta(sqrt_b, sqrt_a, liquidity, true);
        assert_eq!(r1, r2);
    }

    #[test]
    fn test_get_amount0_delta_signed_positive() {
        let sqrt_a = U256::from(79228162514264337593543950336u128);
        let sqrt_b = U256::from(158456325028528675187087900672u128);
        let liquidity = I256::from(1_000_000i64);
        let result = get_amount0_delta_signed(sqrt_a, sqrt_b, liquidity);
        assert!(result > I256::ZERO);
    }

    #[test]
    fn test_get_amount0_delta_signed_negative() {
        let sqrt_a = U256::from(79228162514264337593543950336u128);
        let sqrt_b = U256::from(158456325028528675187087900672u128);
        let liquidity = I256::from(-1_000_000i64);
        let result = get_amount0_delta_signed(sqrt_a, sqrt_b, liquidity);
        assert!(result < I256::ZERO);
    }
}
