use ethnum::{I256, U256};
use std::collections::HashMap;

use crate::config::MathVariant;
use crate::math::oracle::OracleObservation;
use crate::math::tick::TickInfo;

/// Mirrors the TS PoolState type, containing all fields needed for pricing.
/// balance0/balance1 are NOT included — they stay in JS.
#[derive(Debug, Clone)]
pub struct PoolState {
    pub block_timestamp: U256,
    pub tick_spacing: I256,
    pub fee: U256,

    // slot0
    pub sqrt_price_x96: U256,
    pub tick: I256,
    pub observation_index: u16,
    pub observation_cardinality: u16,
    pub observation_cardinality_next: u16,
    pub fee_protocol: U256,

    pub liquidity: U256,
    pub max_liquidity_per_tick: U256,

    pub tick_bitmap: HashMap<i16, U256>,
    pub ticks: HashMap<i32, TickInfo>,
    pub observations: HashMap<u16, OracleObservation>,

    pub start_tick_bitmap: I256,
    pub lowest_known_tick: I256,
    pub highest_known_tick: I256,

    pub variant: MathVariant,
}
