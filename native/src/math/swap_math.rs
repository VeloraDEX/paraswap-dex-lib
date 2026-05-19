use ethnum::{I256, U256};
use super::full_math;
use super::sqrt_price_math;

/// Result of a single swap step computation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapStepResult {
    pub sqrt_ratio_next_x96: U256,
    pub amount_in: U256,
    pub amount_out: U256,
    pub fee_amount: U256,
}

/// BI_POWS[6] = 1_000_000
const ONE_MILLION: U256 = U256::new(1_000_000u128);

/// Computes the result of swapping some amount in, or amount out, given the parameters of the swap.
///
/// The fee, `fee_pips`, is in hundredths of a bip (i.e. 1e-6).
///
/// `amount_remaining` is treated as an I256: positive means exact-input, negative means exact-output.
pub fn compute_swap_step(
    sqrt_ratio_current_x96: U256,
    sqrt_ratio_target_x96: U256,
    liquidity: U256,
    amount_remaining: I256,
    fee_pips: U256,
) -> SwapStepResult {
    let zero_for_one = sqrt_ratio_current_x96 >= sqrt_ratio_target_x96;
    let exact_in = amount_remaining >= I256::ZERO;

    let sqrt_ratio_next_x96;
    let mut amount_in;
    let mut amount_out;
    let fee_amount;

    if exact_in {
        // BigInt.asUintN(256, amountRemaining) -- amountRemaining is non-negative here so it's identity
        let amount_remaining_u = amount_remaining.as_u256();
        let amount_remaining_less_fee =
            full_math::mul_div(amount_remaining_u, ONE_MILLION - fee_pips, ONE_MILLION);

        amount_in = if zero_for_one {
            sqrt_price_math::get_amount0_delta(
                sqrt_ratio_target_x96,
                sqrt_ratio_current_x96,
                liquidity,
                true,
            )
        } else {
            sqrt_price_math::get_amount1_delta(
                sqrt_ratio_current_x96,
                sqrt_ratio_target_x96,
                liquidity,
                true,
            )
        };

        if amount_remaining_less_fee >= amount_in {
            sqrt_ratio_next_x96 = sqrt_ratio_target_x96;
        } else {
            sqrt_ratio_next_x96 = sqrt_price_math::get_next_sqrt_price_from_input(
                sqrt_ratio_current_x96,
                liquidity,
                amount_remaining_less_fee,
                zero_for_one,
            );
        }
    } else {
        // BigInt.asUintN(256, -amountRemaining) -- negate signed, interpret as unsigned
        let neg_amount = (-amount_remaining).as_u256();

        amount_out = if zero_for_one {
            sqrt_price_math::get_amount1_delta(
                sqrt_ratio_target_x96,
                sqrt_ratio_current_x96,
                liquidity,
                false,
            )
        } else {
            sqrt_price_math::get_amount0_delta(
                sqrt_ratio_current_x96,
                sqrt_ratio_target_x96,
                liquidity,
                false,
            )
        };

        if neg_amount >= amount_out {
            sqrt_ratio_next_x96 = sqrt_ratio_target_x96;
        } else {
            sqrt_ratio_next_x96 = sqrt_price_math::get_next_sqrt_price_from_output(
                sqrt_ratio_current_x96,
                liquidity,
                neg_amount,
                zero_for_one,
            );
        }

        // Initialize amount_in to 0; it will be set below
        amount_in = U256::ZERO;
    }

    // Re-initialize for the second half of the function
    // We need to track amount_out properly for the !exact_in case
    // The TS code re-computes both amount_in and amount_out based on `max` flag
    let max = sqrt_ratio_target_x96 == sqrt_ratio_next_x96;

    if exact_in {
        // amount_out was not set in exact_in path above, initialize to 0
        amount_out = U256::ZERO;
    } else {
        amount_out = if zero_for_one {
            sqrt_price_math::get_amount1_delta(
                sqrt_ratio_target_x96,
                sqrt_ratio_current_x96,
                liquidity,
                false,
            )
        } else {
            sqrt_price_math::get_amount0_delta(
                sqrt_ratio_current_x96,
                sqrt_ratio_target_x96,
                liquidity,
                false,
            )
        };
    }

    if zero_for_one {
        if !(max && exact_in) {
            amount_in = sqrt_price_math::get_amount0_delta(
                sqrt_ratio_next_x96,
                sqrt_ratio_current_x96,
                liquidity,
                true,
            );
        }
        if !(max && !exact_in) {
            amount_out = sqrt_price_math::get_amount1_delta(
                sqrt_ratio_next_x96,
                sqrt_ratio_current_x96,
                liquidity,
                false,
            );
        }
    } else {
        if !(max && exact_in) {
            amount_in = sqrt_price_math::get_amount1_delta(
                sqrt_ratio_current_x96,
                sqrt_ratio_next_x96,
                liquidity,
                true,
            );
        }
        if !(max && !exact_in) {
            amount_out = sqrt_price_math::get_amount0_delta(
                sqrt_ratio_current_x96,
                sqrt_ratio_next_x96,
                liquidity,
                false,
            );
        }
    }

    // Cap the output amount to not exceed the remaining output amount
    if !exact_in {
        let neg_amount = (-amount_remaining).as_u256();
        if amount_out > neg_amount {
            amount_out = neg_amount;
        }
    }

    if exact_in && sqrt_ratio_next_x96 != sqrt_ratio_target_x96 {
        // We didn't reach the target, so take the remainder of the maximum input as fee
        fee_amount = amount_remaining.as_u256() - amount_in;
    } else {
        fee_amount =
            full_math::mul_div_rounding_up(amount_in, fee_pips, ONE_MILLION - fee_pips);
    }

    SwapStepResult {
        sqrt_ratio_next_x96,
        amount_in,
        amount_out,
        fee_amount,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Q96 = 2^96
    const Q96: U256 = U256::from_words(0, 1u128 << 96);

    #[test]
    fn test_exact_in_zero_for_one() {
        // price moves from 2.0 toward 1.0
        let sqrt_current = Q96 * U256::from(2u64); // sqrt(4) * Q96
        let sqrt_target = Q96; // sqrt(1) * Q96
        let liquidity = U256::from(1_000_000_000_000u128);
        let amount_remaining = I256::from(1_000_000i64);
        let fee_pips = U256::from(3000u64); // 0.3%

        let result = compute_swap_step(
            sqrt_current,
            sqrt_target,
            liquidity,
            amount_remaining,
            fee_pips,
        );

        assert!(result.sqrt_ratio_next_x96 > U256::ZERO);
        assert!(result.sqrt_ratio_next_x96 <= sqrt_current);
        assert!(result.amount_in > U256::ZERO);
        assert!(result.amount_out > U256::ZERO);
        // amount_in + fee_amount should not exceed amount_remaining
        assert!(result.amount_in + result.fee_amount <= amount_remaining.as_u256());
    }

    #[test]
    fn test_exact_out_zero_for_one() {
        let sqrt_current = Q96 * U256::from(2u64);
        let sqrt_target = Q96;
        let liquidity = U256::from(1_000_000_000_000u128);
        let amount_remaining = I256::from(-500_000i64); // exact output
        let fee_pips = U256::from(3000u64);

        let result = compute_swap_step(
            sqrt_current,
            sqrt_target,
            liquidity,
            amount_remaining,
            fee_pips,
        );

        assert!(result.sqrt_ratio_next_x96 > U256::ZERO);
        assert!(result.amount_in > U256::ZERO);
        assert!(result.amount_out > U256::ZERO);
        // amount_out should not exceed requested
        assert!(result.amount_out <= U256::from(500_000u64));
    }

    #[test]
    fn test_exact_in_one_for_zero() {
        let sqrt_current = Q96;
        let sqrt_target = Q96 * U256::from(2u64);
        let liquidity = U256::from(1_000_000_000_000u128);
        let amount_remaining = I256::from(1_000_000i64);
        let fee_pips = U256::from(3000u64);

        let result = compute_swap_step(
            sqrt_current,
            sqrt_target,
            liquidity,
            amount_remaining,
            fee_pips,
        );

        assert!(result.sqrt_ratio_next_x96 >= sqrt_current);
        assert!(result.amount_in > U256::ZERO);
        assert!(result.amount_out > U256::ZERO);
    }

    #[test]
    fn test_fee_amount_when_target_not_reached() {
        // Very small liquidity so we definitely reach the target
        let sqrt_current = Q96 * U256::from(2u64);
        let sqrt_target = Q96;
        let liquidity = U256::from(100u64); // very small liquidity
        let amount_remaining = I256::from(1_000_000_000i64); // large amount
        let fee_pips = U256::from(3000u64);

        let result = compute_swap_step(
            sqrt_current,
            sqrt_target,
            liquidity,
            amount_remaining,
            fee_pips,
        );

        // Should reach the target price
        assert_eq!(result.sqrt_ratio_next_x96, sqrt_target);
    }

    #[test]
    fn test_zero_fee() {
        let sqrt_current = Q96 * U256::from(2u64);
        let sqrt_target = Q96;
        let liquidity = U256::from(1_000_000_000_000u128);
        let amount_remaining = I256::from(1_000_000i64);
        let fee_pips = U256::ZERO;

        let result = compute_swap_step(
            sqrt_current,
            sqrt_target,
            liquidity,
            amount_remaining,
            fee_pips,
        );

        // With zero fee, fee_amount should be 0
        assert_eq!(result.fee_amount, U256::ZERO);
    }
}
