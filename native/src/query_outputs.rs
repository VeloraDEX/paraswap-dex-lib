use ethnum::{I256, U256};
use std::collections::HashMap;

use crate::math::liquidity_math;
use crate::math::oracle;
use crate::math::swap_math;
use crate::math::tick;
use crate::math::tick::TickInfo;
use crate::math::tick_bitmap;
use crate::math::tick_math;
use crate::pool_state::PoolState;

const MAX_PRICING_COMPUTATION_STEPS_ALLOWED: i32 = 128;

/// 0 = SELL, 1 = BUY (matches SwapSide enum in TS)
pub const SWAP_SIDE_SELL: u8 = 0;

pub struct OutputResult {
    pub outputs: Vec<U256>,
    pub tick_counts: Vec<i32>,
}

#[derive(Clone)]
struct PriceComputationState {
    amount_specified_remaining: I256,
    amount_calculated: I256,
    sqrt_price_x96: U256,
    tick: I256,
    protocol_fee: U256,
    liquidity: U256,
    is_first_cycle_state: bool,
}

#[derive(Clone)]
struct PriceComputationCache {
    liquidity_start: U256,
    block_timestamp: U256,
    fee_protocol: U256,
    seconds_per_liquidity_cumulative_x128: U256,
    tick_cumulative: I256,
    computed_latest_observation: bool,
    tick_count: i32,
}

struct Slot0Snapshot {
    sqrt_price_x96: U256,
    tick: I256,
    observation_index: u16,
    observation_cardinality: u16,
}

fn price_computation_cycles(
    pool: &PoolState,
    ticks_copy: &mut HashMap<i32, TickInfo>,
    slot0_start: &Slot0Snapshot,
    state: &mut PriceComputationState,
    cache: &mut PriceComputationCache,
    sqrt_price_limit_x96: U256,
    zero_for_one: bool,
    exact_input: bool,
    is_sell: bool,
) -> (PriceComputationState, PriceComputationCache) {
    let mut latest_full_cycle_state = state.clone();

    if cache.tick_count == 0 {
        cache.tick_count = 1;
    }
    let mut latest_full_cycle_cache = cache.clone();

    let mut last_ticks_copy: Option<(i32, TickInfo)> = None;

    let mut i: i32 = 0;
    while state.amount_specified_remaining != I256::ZERO
        && state.sqrt_price_x96 != sqrt_price_limit_x96
    {
        if latest_full_cycle_cache.tick_count + i > MAX_PRICING_COMPUTATION_STEPS_ALLOWED {
            state.amount_specified_remaining = I256::ZERO;
            state.amount_calculated = I256::ZERO;
            break;
        }

        let sqrt_price_start_x96 = state.sqrt_price_x96;

        // Find next initialized tick — may panic if out of range
        let bitmap_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            tick_bitmap::next_initialized_tick_within_one_word(
                &pool.tick_bitmap,
                state.tick,
                pool.tick_spacing,
                zero_for_one,
                true, // is_price_query
            )
        }));

        let (tick_next_raw, initialized) = match bitmap_result {
            Ok(result) => result,
            Err(_) => {
                // Out of range — zero out remaining
                state.amount_specified_remaining = I256::ZERO;
                state.amount_calculated = I256::ZERO;
                break;
            }
        };

        // Clamp to min/max tick
        let tick_next = if tick_next_raw < tick_math::MIN_TICK {
            tick_math::MIN_TICK
        } else if tick_next_raw > tick_math::MAX_TICK {
            tick_math::MAX_TICK
        } else {
            tick_next_raw
        };

        let sqrt_price_next_x96 = tick_math::get_sqrt_ratio_at_tick(tick_next);

        // Determine target price (clamped by limit)
        let sqrt_ratio_target = if zero_for_one {
            if sqrt_price_next_x96 < sqrt_price_limit_x96 {
                sqrt_price_limit_x96
            } else {
                sqrt_price_next_x96
            }
        } else {
            if sqrt_price_next_x96 > sqrt_price_limit_x96 {
                sqrt_price_limit_x96
            } else {
                sqrt_price_next_x96
            }
        };

        let step_result = swap_math::compute_swap_step(
            state.sqrt_price_x96,
            sqrt_ratio_target,
            state.liquidity,
            state.amount_specified_remaining,
            pool.fee,
        );

        state.sqrt_price_x96 = step_result.sqrt_ratio_next_x96;
        let amount_in = step_result.amount_in;
        let amount_out = step_result.amount_out;
        let mut fee_amount = step_result.fee_amount;

        if exact_input {
            state.amount_specified_remaining -=
                amount_in.as_i256() + fee_amount.as_i256();
            state.amount_calculated -= amount_out.as_i256();
        } else {
            state.amount_specified_remaining += amount_out.as_i256();
            state.amount_calculated +=
                amount_in.as_i256() + fee_amount.as_i256();
        }

        if cache.fee_protocol > U256::ZERO {
            let delta = fee_amount / cache.fee_protocol;
            fee_amount -= delta;
            state.protocol_fee += delta;
        }

        if state.sqrt_price_x96 == sqrt_price_next_x96 {
            if initialized {
                if !cache.computed_latest_observation {
                    let (tc, splc) = oracle::observe_single(
                        &pool.observations,
                        cache.block_timestamp,
                        U256::ZERO,
                        pool.block_timestamp,
                        slot0_start.tick,
                        slot0_start.observation_index,
                        cache.liquidity_start,
                        slot0_start.observation_cardinality,
                    );
                    cache.tick_cumulative = tc;
                    cache.seconds_per_liquidity_cumulative_x128 = splc;
                    cache.computed_latest_observation = true;
                }

                if state.amount_specified_remaining == I256::ZERO {
                    let tick_idx = tick_next.as_i32();
                    if let Some(existing) = ticks_copy.get(&tick_idx) {
                        last_ticks_copy = Some((tick_idx, existing.clone()));
                    }
                }

                let mut liquidity_net = tick::cross(ticks_copy, tick_next.as_i32());
                if zero_for_one {
                    liquidity_net = -liquidity_net;
                }

                state.liquidity = liquidity_math::add_delta(state.liquidity, liquidity_net);
            }

            state.tick = if zero_for_one {
                tick_next - I256::ONE
            } else {
                tick_next
            };
        } else if state.sqrt_price_x96 != sqrt_price_start_x96 {
            state.tick = tick_math::get_tick_at_sqrt_ratio(state.sqrt_price_x96);
        }

        if state.amount_specified_remaining != I256::ZERO {
            latest_full_cycle_state = state.clone();
            latest_full_cycle_cache = cache.clone();
        } else if let Some((idx, tick_info)) = last_ticks_copy.take() {
            ticks_copy.insert(idx, tick_info);
        }

        i += 1;
    }

    if i > 1 {
        latest_full_cycle_cache.tick_count += i - 1;
    }

    if state.amount_specified_remaining != I256::ZERO && !is_sell {
        // BUY side: zero out remaining
        state.amount_specified_remaining = I256::ZERO;
        state.amount_calculated = I256::ZERO;
    }

    (latest_full_cycle_state, latest_full_cycle_cache)
}

/// Main pricing entry point. Equivalent to UniswapV3Math.queryOutputs() in TS.
pub fn query_outputs(
    pool: &PoolState,
    amounts: &[U256],
    zero_for_one: bool,
    side: u8,
) -> OutputResult {
    let is_sell = side == SWAP_SIDE_SELL;

    let slot0_start = Slot0Snapshot {
        sqrt_price_x96: pool.sqrt_price_x96,
        tick: pool.tick,
        observation_index: pool.observation_index,
        observation_cardinality: pool.observation_cardinality,
    };

    let sqrt_price_limit_x96 = if zero_for_one {
        tick_math::MIN_SQRT_RATIO + U256::ONE
    } else {
        tick_math::MAX_SQRT_RATIO - U256::ONE
    };

    let fee_protocol = pool.variant.fee_protocol(pool.fee_protocol, zero_for_one);

    let mut cache = PriceComputationCache {
        liquidity_start: pool.liquidity,
        block_timestamp: pool.block_timestamp & U256::from(0xFFFFFFFFu32),
        fee_protocol,
        seconds_per_liquidity_cumulative_x128: U256::ZERO,
        tick_cumulative: I256::ZERO,
        computed_latest_observation: false,
        tick_count: 0,
    };

    let mut state = PriceComputationState {
        amount_specified_remaining: I256::ZERO,
        amount_calculated: I256::ZERO,
        sqrt_price_x96: slot0_start.sqrt_price_x96,
        tick: slot0_start.tick,
        protocol_fee: U256::ZERO,
        liquidity: cache.liquidity_start,
        is_first_cycle_state: true,
    };

    // Verify price limit
    if zero_for_one {
        assert!(
            sqrt_price_limit_x96 < slot0_start.sqrt_price_x96
                && sqrt_price_limit_x96 > tick_math::MIN_SQRT_RATIO,
            "SPL"
        );
    } else {
        assert!(
            sqrt_price_limit_x96 > slot0_start.sqrt_price_x96
                && sqrt_price_limit_x96 < tick_math::MAX_SQRT_RATIO,
            "SPL"
        );
    }

    let mut is_out_of_range = false;
    let mut previous_amount = I256::ZERO;

    let mut outputs = vec![U256::ZERO; amounts.len()];
    let mut tick_counts = vec![0i32; amounts.len()];

    // We use a mutable copy of ticks for cross() mutations during pricing
    let mut ticks_copy = pool.ticks.clone();

    for (i, &amount) in amounts.iter().enumerate() {
        if amount == U256::ZERO {
            outputs[i] = U256::ZERO;
            tick_counts[i] = 0;
            continue;
        }

        // BigInt.asIntN(256, amount) — reinterpret U256 bits as I256
        let amount_as_i256 = amount.as_i256();
        let amount_specified = if is_sell {
            amount_as_i256
        } else {
            -amount_as_i256
        };

        if state.is_first_cycle_state {
            state.amount_specified_remaining = amount_specified;
            state.is_first_cycle_state = false;
        } else {
            state.amount_specified_remaining =
                amount_specified - (previous_amount - state.amount_specified_remaining);
        }

        let exact_input = amount_specified > I256::ZERO;

        if !is_out_of_range {
            let (latest_full_cycle_state, latest_full_cycle_cache) = price_computation_cycles(
                pool,
                &mut ticks_copy,
                &slot0_start,
                &mut state,
                &mut cache,
                sqrt_price_limit_x96,
                zero_for_one,
                exact_input,
                is_sell,
            );

            if state.amount_specified_remaining == I256::ZERO
                && state.amount_calculated == I256::ZERO
            {
                is_out_of_range = true;
                outputs[i] = U256::ZERO;
                tick_counts[i] = 0;
                continue;
            }

            previous_amount = amount_specified;

            let (amount0, amount1) = if zero_for_one == exact_input {
                (
                    amount_specified - state.amount_specified_remaining,
                    state.amount_calculated,
                )
            } else {
                (
                    state.amount_calculated,
                    amount_specified - state.amount_specified_remaining,
                )
            };

            // Restore state to latest full cycle for next amount
            state = latest_full_cycle_state;
            cache = latest_full_cycle_cache;

            if is_sell {
                // output = BigInt.asUintN(256, -(zeroForOne ? amount1 : amount0))
                let neg = -(if zero_for_one { amount1 } else { amount0 });
                outputs[i] = neg.as_u256();
                tick_counts[i] = cache.tick_count;
            } else {
                // output = BigInt.asUintN(256, zeroForOne ? amount0 : amount1)
                let val = if zero_for_one { amount0 } else { amount1 };
                outputs[i] = val.as_u256();
                tick_counts[i] = cache.tick_count;
            }
        } else {
            outputs[i] = U256::ZERO;
            tick_counts[i] = 0;
        }
    }

    OutputResult {
        outputs,
        tick_counts,
    }
}
