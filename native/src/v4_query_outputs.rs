use ethnum::{I256, U256};
use std::collections::HashMap;

use crate::math::liquidity_math;
use crate::math::swap_math;
use crate::math::tick;
use crate::math::tick::TickInfo;
use crate::math::tick_bitmap;
use crate::math::tick_math;

const MAX_PRICING_COMPUTATION_STEPS_ALLOWED: i32 = 64;
const PIPS_DENOMINATOR: U256 = U256::new(1_000_000);

/// V4 pool state — simplified vs V3 (no oracle, different fee model).
#[derive(Debug, Clone)]
pub struct V4PoolState {
    pub sqrt_price_x96: U256,
    pub tick: I256,
    pub protocol_fee: U256,
    pub lp_fee: U256,
    pub liquidity: U256,
    pub tick_spacing: I256,
    pub fee_growth_global0_x128: U256,
    pub fee_growth_global1_x128: U256,
    pub tick_bitmap: HashMap<i16, U256>,
    pub ticks: HashMap<i32, TickInfo>,
}

// --- ProtocolFeeLibrary ---

fn get_zero_for_one_fee(protocol_fee: U256) -> U256 {
    protocol_fee % U256::new(4096) // lower 12 bits
}

fn get_one_for_zero_fee(protocol_fee: U256) -> U256 {
    protocol_fee >> 12
}

fn calculate_swap_fee(protocol_fee: U256, lp_fee: U256) -> U256 {
    // protocolFee + lpFee - (protocolFee * lpFee) / PIPS_DENOMINATOR
    protocol_fee + lp_fee - (protocol_fee * lp_fee) / PIPS_DENOMINATOR
}

// --- SwapMath helpers ---

fn get_sqrt_price_target(zero_for_one: bool, next_price: U256, limit_price: U256) -> U256 {
    let cond = if zero_for_one {
        next_price < limit_price
    } else {
        next_price > limit_price
    };
    if cond { limit_price } else { next_price }
}

/// V4 _swap — single amount, returns (amount0, amount1) as I256.
fn swap(
    pool: &V4PoolState,
    zero_for_one: bool,
    amount_specified: I256,
    sqrt_price_limit_x96: U256,
    tick_spacing: I256,
) -> (I256, I256) {
    let protocol_fee = if zero_for_one {
        get_zero_for_one_fee(pool.protocol_fee)
    } else {
        get_one_for_zero_fee(pool.protocol_fee)
    };

    let swap_fee = if protocol_fee == U256::ZERO {
        pool.lp_fee
    } else {
        calculate_swap_fee(protocol_fee, pool.lp_fee)
    };

    // MAX_SWAP_FEE check
    if swap_fee >= U256::new(1_000_000) {
        assert!(amount_specified < I256::ZERO, "Invalid fee for exact out");
    }

    if amount_specified == I256::ZERO {
        return (I256::ZERO, I256::ZERO);
    }

    // SPL checks
    if zero_for_one {
        assert!(sqrt_price_limit_x96 < pool.sqrt_price_x96, "Price limit already exceeded");
        assert!(sqrt_price_limit_x96 > tick_math::MIN_SQRT_RATIO, "Price limit out of bounds");
    } else {
        assert!(sqrt_price_limit_x96 > pool.sqrt_price_x96, "Price limit already exceeded");
        assert!(sqrt_price_limit_x96 < tick_math::MAX_SQRT_RATIO, "Price limit out of bounds");
    }

    let mut amount_remaining = amount_specified;
    let mut amount_calculated = I256::ZERO;
    let mut sqrt_price_x96 = pool.sqrt_price_x96;
    let mut current_tick = pool.tick;
    let mut liquidity = pool.liquidity;

    let mut counter = 0i32;
    while !(amount_remaining == I256::ZERO || sqrt_price_x96 == sqrt_price_limit_x96)
        && counter <= MAX_PRICING_COMPUTATION_STEPS_ALLOWED
    {
        // Find next tick
        // V4 has no bitmap range check — it reads through empty words naturally.
        let (tick_next_raw, initialized) = tick_bitmap::next_initialized_tick_within_one_word(
            &pool.tick_bitmap,
            current_tick,
            tick_spacing,
            zero_for_one,
            false, // not a bounded price query
            None,  // no bitmap range bounds for V4
        ).unwrap();

        let tick_next = if tick_next_raw <= tick_math::MIN_TICK {
            tick_math::MIN_TICK
        } else if tick_next_raw >= tick_math::MAX_TICK {
            tick_math::MAX_TICK
        } else {
            tick_next_raw
        };

        let sqrt_price_next_x96 = tick_math::get_sqrt_ratio_at_tick(tick_next);

        let step_start_price = sqrt_price_x96;
        let target = get_sqrt_price_target(zero_for_one, sqrt_price_next_x96, sqrt_price_limit_x96);

        // V4 uses opposite sign convention: negative = exactIn.
        // V3's compute_swap_step expects positive = exactIn.
        // Negate before calling, results (amountIn/amountOut) stay positive.
        let step = swap_math::compute_swap_step(
            sqrt_price_x96,
            target,
            liquidity,
            -amount_remaining,
            swap_fee,
        );

        sqrt_price_x96 = step.sqrt_ratio_next_x96;

        // V4 sign convention: amountSpecified > 0 = exactOut, < 0 = exactIn
        if amount_specified > I256::ZERO {
            // exactOut
            amount_remaining -= step.amount_out.as_i256();
            amount_calculated -= step.amount_in.as_i256() + step.fee_amount.as_i256();
        } else {
            // exactIn
            amount_remaining += step.amount_in.as_i256() + step.fee_amount.as_i256();
            amount_calculated += step.amount_out.as_i256();
        }

        if sqrt_price_x96 == sqrt_price_next_x96 {
            if initialized {
                let mut liquidity_net = tick::cross(&pool.ticks, tick_next.as_i32());
                if zero_for_one {
                    liquidity_net = -liquidity_net;
                }
                liquidity = liquidity_math::add_delta(liquidity, liquidity_net);
            }
            current_tick = if zero_for_one { tick_next - I256::ONE } else { tick_next };
        } else if sqrt_price_x96 != step_start_price {
            current_tick = tick_math::get_tick_at_sqrt_ratio(sqrt_price_x96);
        }

        counter += 1;
    }

    if counter >= MAX_PRICING_COMPUTATION_STEPS_ALLOWED {
        return (I256::ZERO, I256::ZERO);
    }

    if zero_for_one != (amount_specified < I256::ZERO) {
        (
            amount_calculated,
            amount_specified - amount_remaining,
        )
    } else {
        (
            amount_specified - amount_remaining,
            amount_calculated,
        )
    }
}

/// V4 queryOutputs — processes each amount independently.
/// Returns outputs as U256 (absolute values).
pub fn query_outputs(
    pool: &V4PoolState,
    tick_spacing: I256,
    amounts: &[U256],
    zero_for_one: bool,
    side: u8, // 0=SELL, 1=BUY
) -> Vec<U256> {
    let is_sell = side == 0;

    amounts
        .iter()
        .map(|&amount| {
            if amount == U256::ZERO {
                return U256::ZERO;
            }

            let sqrt_price_limit_x96 = if zero_for_one {
                tick_math::MIN_SQRT_RATIO + U256::ONE
            } else {
                tick_math::MAX_SQRT_RATIO - U256::ONE
            };

            if is_sell {
                let amount_specified = -(amount.as_i256()); // exactIn: negative
                let (amount0, amount1) = swap(
                    pool,
                    zero_for_one,
                    amount_specified,
                    sqrt_price_limit_x96,
                    tick_spacing,
                );

                let amount_specified_actual = if zero_for_one == (amount_specified < I256::ZERO) {
                    amount0
                } else {
                    amount1
                };

                if amount_specified_actual != amount_specified {
                    return U256::ZERO;
                }

                let output = if zero_for_one { amount1 } else { amount0 };
                output.as_u256()
            } else {
                let amount_specified = amount.as_i256(); // exactOut: positive
                let (amount0, amount1) = swap(
                    pool,
                    zero_for_one,
                    amount_specified,
                    sqrt_price_limit_x96,
                    tick_spacing,
                );

                let amount_specified_actual = if zero_for_one == (amount_specified < I256::ZERO) {
                    amount0
                } else {
                    amount1
                };

                if amount_specified_actual != amount_specified {
                    return U256::ZERO;
                }

                let output = if zero_for_one { -amount0 } else { -amount1 };
                output.as_u256()
            }
        })
        .collect()
}
