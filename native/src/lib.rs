pub mod config;
pub mod math;
pub mod pool_state;
pub mod query_outputs;
pub mod v4_query_outputs;

use ethnum::{I256, U256};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use std::collections::HashMap;

/// Set the number of threads rayon uses for parallel queries.
/// Call once at startup. Defaults to all available cores if not called.
#[napi]
pub fn set_thread_count(n: u32) {
    rayon::ThreadPoolBuilder::new()
        .num_threads(n as usize)
        .build_global()
        .ok();
}

use config::MathVariant;
use math::oracle::OracleObservation;
use math::tick::TickInfo;
use pool_state::PoolState;

// ---- NAPI type definitions for JS interop ----

#[napi(object)]
pub struct JsTickEntry {
    pub key: i32,
    pub liquidity_gross: BigInt,
    pub liquidity_net: BigInt,
}

#[napi(object)]
pub struct JsBitmapEntry {
    pub key: i32,
    pub value: BigInt,
}

#[napi(object)]
pub struct JsObservationEntry {
    pub key: i32,
    pub block_timestamp: BigInt,
    pub tick_cumulative: BigInt,
    pub seconds_per_liquidity_cumulative_x128: BigInt,
    pub initialized: bool,
}

#[napi(object)]
pub struct JsPoolStateInit {
    pub variant: String,
    pub bitmap_range: i32,
    pub block_timestamp: BigInt,
    pub tick_spacing: BigInt,
    pub fee: BigInt,
    pub sqrt_price_x96: BigInt,
    pub tick: BigInt,
    pub observation_index: i32,
    pub observation_cardinality: i32,
    pub observation_cardinality_next: i32,
    pub fee_protocol: BigInt,
    pub liquidity: BigInt,
    pub max_liquidity_per_tick: BigInt,
    pub start_tick_bitmap: BigInt,
    pub lowest_known_tick: BigInt,
    pub highest_known_tick: BigInt,
    pub tick_bitmap: Vec<JsBitmapEntry>,
    pub ticks: Vec<JsTickEntry>,
    pub observations: Vec<JsObservationEntry>,
}

#[napi(object)]
pub struct JsOutputResult {
    pub outputs: Vec<BigInt>,
    pub tick_counts: Vec<i32>,
}

// ---- Conversion helpers ----
// napi::bindgen_prelude::BigInt stores { sign_bit: bool, words: Vec<u64> }
// words are little-endian u64 limbs.

fn bigint_to_u256(bi: &BigInt) -> U256 {
    let words = &bi.words;
    let low = words.first().copied().unwrap_or(0) as u128
        | (words.get(1).copied().unwrap_or(0) as u128) << 64;
    let high = words.get(2).copied().unwrap_or(0) as u128
        | (words.get(3).copied().unwrap_or(0) as u128) << 64;
    U256::from_words(high, low)
}

fn bigint_to_i256(bi: &BigInt) -> I256 {
    let u = bigint_to_u256(bi);
    let val = u.as_i256();
    if bi.sign_bit {
        -val
    } else {
        val
    }
}

fn u256_to_bigint(val: U256) -> BigInt {
    let (high, low) = val.into_words();
    let mut words = vec![
        low as u64,
        (low >> 64) as u64,
        high as u64,
        (high >> 64) as u64,
    ];
    // Trim trailing zeros for cleaner representation
    while words.len() > 1 && *words.last().unwrap() == 0 {
        words.pop();
    }
    BigInt {
        sign_bit: false,
        words,
    }
}

// ---- The main NAPI class ----

#[napi]
pub struct RustPoolHandle {
    state: PoolState,
}

#[napi]
impl RustPoolHandle {
    /// Create a new Rust-owned pool state from JS data.
    #[napi(factory)]
    pub fn create(init: JsPoolStateInit) -> Result<Self> {
        let variant = MathVariant::from_str(&init.variant);

        let mut tick_bitmap = HashMap::with_capacity(init.tick_bitmap.len());
        for entry in &init.tick_bitmap {
            tick_bitmap.insert(entry.key as i16, bigint_to_u256(&entry.value));
        }

        let mut ticks = HashMap::with_capacity(init.ticks.len());
        for entry in &init.ticks {
            ticks.insert(
                entry.key,
                TickInfo {
                    liquidity_gross: bigint_to_u256(&entry.liquidity_gross),
                    liquidity_net: bigint_to_i256(&entry.liquidity_net),
                    initialized: true,
                },
            );
        }

        let mut observations = HashMap::with_capacity(init.observations.len());
        for entry in &init.observations {
            observations.insert(
                entry.key as u16,
                OracleObservation {
                    block_timestamp: bigint_to_u256(&entry.block_timestamp),
                    tick_cumulative: bigint_to_i256(&entry.tick_cumulative),
                    seconds_per_liquidity_cumulative_x128: bigint_to_u256(
                        &entry.seconds_per_liquidity_cumulative_x128,
                    ),
                    initialized: entry.initialized,
                },
            );
        }

        let start_tick_bitmap = bigint_to_i256(&init.start_tick_bitmap);

        // bitmap_range is the total half-width (TICK_BITMAP_BUFFER + TICK_BITMAP_TO_USE)
        // passed from TS since it varies per DEX and per network.
        let start_i16 = start_tick_bitmap.as_i32() as i16;
        let range = init.bitmap_range as i16;
        let bitmap_range_lower = start_i16 - range;
        let bitmap_range_upper = start_i16 + range;

        Ok(Self {
            state: PoolState {
                block_timestamp: bigint_to_u256(&init.block_timestamp),
                tick_spacing: bigint_to_i256(&init.tick_spacing),
                fee: bigint_to_u256(&init.fee),
                sqrt_price_x96: bigint_to_u256(&init.sqrt_price_x96),
                tick: bigint_to_i256(&init.tick),
                observation_index: init.observation_index as u16,
                observation_cardinality: init.observation_cardinality as u16,
                observation_cardinality_next: init.observation_cardinality_next as u16,
                fee_protocol: bigint_to_u256(&init.fee_protocol),
                liquidity: bigint_to_u256(&init.liquidity),
                max_liquidity_per_tick: bigint_to_u256(&init.max_liquidity_per_tick),
                tick_bitmap,
                ticks,
                observations,
                start_tick_bitmap,
                lowest_known_tick: bigint_to_i256(&init.lowest_known_tick),
                highest_known_tick: bigint_to_i256(&init.highest_known_tick),
                bitmap_range_lower,
                bitmap_range_upper,
                variant,
            },
        })
    }

    /// HOT PATH: Price N amounts in one call (BigInt version).
    /// side: 0 = SELL, 1 = BUY
    #[napi]
    pub fn query_outputs(
        &self,
        amounts: Vec<BigInt>,
        zero_for_one: bool,
        side: u8,
    ) -> Result<JsOutputResult> {
        let amounts_u256: Vec<U256> = amounts.iter().map(|a| bigint_to_u256(a)).collect();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            query_outputs::query_outputs(&self.state, &amounts_u256, zero_for_one, side)
        }));

        match result {
            Ok(output) => {
                let outputs: Vec<BigInt> =
                    output.outputs.iter().map(|v| u256_to_bigint(*v)).collect();

                Ok(JsOutputResult {
                    outputs,
                    tick_counts: output.tick_counts,
                })
            }
            Err(panic_info) => {
                let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "Unknown panic in query_outputs".to_string()
                };
                Err(Error::new(Status::GenericFailure, msg))
            }
        }
    }

}

// ---- Pool Registry: batch parallel queries ----

fn build_pool_state(init: &JsPoolStateInit) -> Result<PoolState> {
    let variant = MathVariant::from_str(&init.variant);

    let mut tick_bitmap = HashMap::with_capacity(init.tick_bitmap.len());
    for entry in &init.tick_bitmap {
        tick_bitmap.insert(entry.key as i16, bigint_to_u256(&entry.value));
    }

    let mut ticks = HashMap::with_capacity(init.ticks.len());
    for entry in &init.ticks {
        ticks.insert(
            entry.key,
            TickInfo {
                liquidity_gross: bigint_to_u256(&entry.liquidity_gross),
                liquidity_net: bigint_to_i256(&entry.liquidity_net),
                initialized: true,
            },
        );
    }

    let mut observations = HashMap::with_capacity(init.observations.len());
    for entry in &init.observations {
        observations.insert(
            entry.key as u16,
            OracleObservation {
                block_timestamp: bigint_to_u256(&entry.block_timestamp),
                tick_cumulative: bigint_to_i256(&entry.tick_cumulative),
                seconds_per_liquidity_cumulative_x128: bigint_to_u256(
                    &entry.seconds_per_liquidity_cumulative_x128,
                ),
                initialized: entry.initialized,
            },
        );
    }

    let start_tick_bitmap = bigint_to_i256(&init.start_tick_bitmap);
    let start_i16 = start_tick_bitmap.as_i32() as i16;
    let range = init.bitmap_range as i16;

    Ok(PoolState {
        block_timestamp: bigint_to_u256(&init.block_timestamp),
        tick_spacing: bigint_to_i256(&init.tick_spacing),
        fee: bigint_to_u256(&init.fee),
        sqrt_price_x96: bigint_to_u256(&init.sqrt_price_x96),
        tick: bigint_to_i256(&init.tick),
        observation_index: init.observation_index as u16,
        observation_cardinality: init.observation_cardinality as u16,
        observation_cardinality_next: init.observation_cardinality_next as u16,
        fee_protocol: bigint_to_u256(&init.fee_protocol),
        liquidity: bigint_to_u256(&init.liquidity),
        max_liquidity_per_tick: bigint_to_u256(&init.max_liquidity_per_tick),
        tick_bitmap,
        ticks,
        observations,
        start_tick_bitmap,
        lowest_known_tick: bigint_to_i256(&init.lowest_known_tick),
        highest_known_tick: bigint_to_i256(&init.highest_known_tick),
        bitmap_range_lower: start_i16 - range,
        bitmap_range_upper: start_i16 + range,
        variant,
    })
}

#[napi(object)]
pub struct JsPoolQueryResult {
    pub key: String,
    pub outputs: Vec<BigInt>,
    pub tick_counts: Vec<i32>,
}

#[napi]
pub struct RustPoolRegistry {
    pools: HashMap<String, PoolState>,
}

#[napi]
impl RustPoolRegistry {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            pools: HashMap::new(),
        }
    }

    /// Register or update a pool.
    #[napi]
    pub fn set_pool(&mut self, key: String, init: JsPoolStateInit) -> Result<()> {
        let state = build_pool_state(&init)?;
        self.pools.insert(key, state);
        Ok(())
    }

    /// Remove a pool.
    #[napi]
    pub fn remove_pool(&mut self, key: String) {
        self.pools.remove(&key);
    }

    /// Query multiple pools in parallel. Returns results for all registered pools
    /// whose keys are in the provided list.
    /// Each pool is queried with the SAME amounts and direction.
    #[napi]
    pub fn query_many(
        &self,
        keys: Vec<String>,
        amounts: Vec<BigInt>,
        zero_for_one: bool,
        side: u8,
    ) -> Result<Vec<JsPoolQueryResult>> {
        let amounts_u256: Vec<U256> = amounts.iter().map(|a| bigint_to_u256(a)).collect();

        // Collect references to pools that exist
        let pool_refs: Vec<(&str, &PoolState)> = keys
            .iter()
            .filter_map(|k| self.pools.get(k).map(|p| (k.as_str(), p)))
            .collect();

        // Run all pool queries in parallel using rayon
        let results: Vec<Result<JsPoolQueryResult>> = pool_refs
            .par_iter()
            .map(|(key, pool)| {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    query_outputs::query_outputs(pool, &amounts_u256, zero_for_one, side)
                }));

                match result {
                    Ok(output) => {
                        let outputs: Vec<BigInt> =
                            output.outputs.iter().map(|v| u256_to_bigint(*v)).collect();
                        Ok(JsPoolQueryResult {
                            key: key.to_string(),
                            outputs,
                            tick_counts: output.tick_counts,
                        })
                    }
                    Err(_) => Ok(JsPoolQueryResult {
                        key: key.to_string(),
                        outputs: vec![],
                        tick_counts: vec![],
                    }),
                }
            })
            .collect();

        results.into_iter().collect()
    }

    #[napi]
    pub fn pool_count(&self) -> u32 {
        self.pools.len() as u32
    }
}

// ---- V4 Pool Registry ----

#[napi(object)]
pub struct JsV4PoolStateInit {
    pub sqrt_price_x96: BigInt,
    pub tick: BigInt,
    pub protocol_fee: BigInt,
    pub lp_fee: BigInt,
    pub liquidity: BigInt,
    pub tick_spacing: BigInt,
    pub fee_growth_global0_x128: BigInt,
    pub fee_growth_global1_x128: BigInt,
    pub bitmap_range: i32,
    pub start_tick_bitmap: BigInt,
    pub tick_bitmap: Vec<JsBitmapEntry>,
    pub ticks: Vec<JsTickEntry>,
}

#[napi(object)]
pub struct JsV4QueryResult {
    pub key: String,
    pub outputs: Vec<BigInt>,
}

fn build_v4_pool_state(init: &JsV4PoolStateInit) -> v4_query_outputs::V4PoolState {
    let mut tick_bitmap = HashMap::with_capacity(init.tick_bitmap.len());
    for entry in &init.tick_bitmap {
        tick_bitmap.insert(entry.key as i16, bigint_to_u256(&entry.value));
    }

    let mut ticks = HashMap::with_capacity(init.ticks.len());
    for entry in &init.ticks {
        ticks.insert(
            entry.key,
            TickInfo {
                liquidity_gross: bigint_to_u256(&entry.liquidity_gross),
                liquidity_net: bigint_to_i256(&entry.liquidity_net),
                initialized: true,
            },
        );
    }

    v4_query_outputs::V4PoolState {
        sqrt_price_x96: bigint_to_u256(&init.sqrt_price_x96),
        tick: bigint_to_i256(&init.tick),
        protocol_fee: bigint_to_u256(&init.protocol_fee),
        lp_fee: bigint_to_u256(&init.lp_fee),
        liquidity: bigint_to_u256(&init.liquidity),
        tick_spacing: bigint_to_i256(&init.tick_spacing),
        fee_growth_global0_x128: bigint_to_u256(&init.fee_growth_global0_x128),
        fee_growth_global1_x128: bigint_to_u256(&init.fee_growth_global1_x128),
        tick_bitmap,
        ticks,
    }
}

#[napi]
pub struct RustV4PoolRegistry {
    pools: HashMap<String, (v4_query_outputs::V4PoolState, I256)>, // state + tickSpacing
}

#[napi]
impl RustV4PoolRegistry {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            pools: HashMap::new(),
        }
    }

    #[napi]
    pub fn set_pool(&mut self, key: String, init: JsV4PoolStateInit) {
        let tick_spacing = bigint_to_i256(&init.tick_spacing);
        let state = build_v4_pool_state(&init);
        self.pools.insert(key, (state, tick_spacing));
    }

    #[napi]
    pub fn remove_pool(&mut self, key: String) {
        self.pools.remove(&key);
    }

    #[napi]
    pub fn query_many(
        &self,
        keys: Vec<String>,
        amounts: Vec<BigInt>,
        zero_for_one: bool,
        side: u8,
    ) -> Vec<JsV4QueryResult> {
        let amounts_u256: Vec<U256> = amounts.iter().map(|a| bigint_to_u256(a)).collect();

        let pool_refs: Vec<(&str, &v4_query_outputs::V4PoolState, I256)> = keys
            .iter()
            .filter_map(|k| {
                self.pools
                    .get(k)
                    .map(|(p, ts)| (k.as_str(), p, *ts))
            })
            .collect();

        pool_refs
            .par_iter()
            .map(|(key, pool, tick_spacing)| {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    v4_query_outputs::query_outputs(pool, *tick_spacing, &amounts_u256, zero_for_one, side)
                }));

                match result {
                    Ok(outputs) => {
                        let bigint_outputs: Vec<BigInt> =
                            outputs.iter().map(|v| u256_to_bigint(*v)).collect();
                        JsV4QueryResult {
                            key: key.to_string(),
                            outputs: bigint_outputs,
                        }
                    }
                    Err(_) => JsV4QueryResult {
                        key: key.to_string(),
                        outputs: vec![],
                    },
                }
            })
            .collect()
    }

    #[napi]
    pub fn pool_count(&self) -> u32 {
        self.pools.len() as u32
    }
}
