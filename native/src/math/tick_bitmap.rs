use ethnum::{I256, U256};
use std::collections::HashMap;
use super::bit_math;

/// Computes the word position and bit position within that word for a given tick.
///
/// Equivalent to: `[BigInt.asIntN(16, tick >> 8), BigInt.asUintN(8, tick % 256)]`
///
/// Returns `(word_pos, bit_pos)` where `word_pos` is an i16 and `bit_pos` is a u8.
pub fn position(tick: I256) -> (i16, u8) {
    // word_pos = asIntN(16, tick >> 8)
    let shifted = tick >> 8u32;
    // Take the low 16 bits and sign-extend from bit 15
    let word_pos = shifted.0[0] as i16;

    // bit_pos = asUintN(8, tick % 256)
    // BigInt.asUintN(8, x) takes the low 8 bits of the two's complement representation.
    let bit_pos = tick.0[0] as u8;

    (word_pos, bit_pos)
}

/// Flips the tick's initialized state in the bitmap.
///
/// `tick` must be divisible by `tick_spacing`.
pub fn flip_tick(bitmap: &mut HashMap<i16, U256>, tick: I256, tick_spacing: I256) {
    assert!(
        tick % tick_spacing == I256::ZERO,
        "tick % tick_spacing == 0"
    );
    let (word_pos, bit_pos) = position(tick / tick_spacing);
    let mask = U256::ONE << bit_pos;

    let entry = bitmap.entry(word_pos).or_insert(U256::ZERO);
    *entry ^= mask;
}

/// Returns the next initialized tick within one word of the current tick.
///
/// `lte` indicates whether we're searching to the left (less-than-or-equal) or right.
/// `is_price_query` controls whether we create default entries for missing bitmap words.
///
/// Returns `(next_tick, initialized)`.
pub fn next_initialized_tick_within_one_word(
    bitmap: &HashMap<i16, U256>,
    tick: I256,
    tick_spacing: I256,
    lte: bool,
    _is_price_query: bool,
) -> (I256, bool) {
    let mut compressed = tick / tick_spacing;
    if tick < I256::ZERO && tick % tick_spacing != I256::ZERO {
        compressed = compressed - I256::ONE;
    }

    if lte {
        let (word_pos, bit_pos) = position(compressed);
        // mask = (1 << bitPos) - 1 + (1 << bitPos)  =  (2 << bitPos) - 1
        // This creates a mask of all bits from 0 to bit_pos inclusive
        let mask = (U256::ONE << bit_pos) - U256::ONE + (U256::ONE << bit_pos);

        // Read bitmap value, defaulting to 0 for missing entries
        let tick_bitmap_value = bitmap.get(&word_pos).copied().unwrap_or(U256::ZERO);

        let masked = tick_bitmap_value & mask;

        let initialized = masked != U256::ZERO;
        let next = if initialized {
            let msb = bit_math::most_significant_bit(masked);
            // compressed - asIntN(24, bitPos - msb)
            let diff = I256::from(bit_pos as i32) - I256::from(msb as i32);
            let diff_i24 = sign_extend_i24(diff);
            (compressed - diff_i24) * tick_spacing
        } else {
            // compressed - asIntN(24, bitPos)
            let bp = I256::from(bit_pos as i32);
            let bp_i24 = sign_extend_i24(bp);
            (compressed - bp_i24) * tick_spacing
        };

        (next, initialized)
    } else {
        // Start from the word of the next tick
        let (word_pos, bit_pos) = position(compressed + I256::ONE);
        // mask = ~((1 << bitPos) - 1)
        // In 256-bit context: invert all bits of ((1 << bitPos) - 1)
        let mask = !((U256::ONE << bit_pos) - U256::ONE);

        let tick_bitmap_value = bitmap.get(&word_pos).copied().unwrap_or(U256::ZERO);

        let masked = tick_bitmap_value & mask;

        let initialized = masked != U256::ZERO;
        let next = if initialized {
            let lsb = bit_math::least_significant_bit(masked);
            // compressed + 1 + asIntN(24, lsb - bitPos)
            let diff = I256::from(lsb as i32) - I256::from(bit_pos as i32);
            let diff_i24 = sign_extend_i24(diff);
            (compressed + I256::ONE + diff_i24) * tick_spacing
        } else {
            // compressed + 1 + asIntN(24, 255 - bitPos)
            let diff = I256::from(255i32) - I256::from(bit_pos as i32);
            let diff_i24 = sign_extend_i24(diff);
            (compressed + I256::ONE + diff_i24) * tick_spacing
        };

        (next, initialized)
    }
}

/// Sign-extend a value to 24-bit signed (equivalent to BigInt.asIntN(24, x)).
fn sign_extend_i24(val: I256) -> I256 {
    let mask = I256::new(0x00FFFFFF);
    let masked = val & mask;
    if masked & I256::new(0x00800000) != I256::ZERO {
        masked | !mask
    } else {
        masked
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_position_zero() {
        let (word, bit) = position(I256::ZERO);
        assert_eq!(word, 0);
        assert_eq!(bit, 0);
    }

    #[test]
    fn test_position_positive() {
        // tick = 256 => word_pos = 256 >> 8 = 1, bit_pos = 256 % 256 = 0
        let (word, bit) = position(I256::from(256i64));
        assert_eq!(word, 1);
        assert_eq!(bit, 0);

        // tick = 257 => word_pos = 257 >> 8 = 1, bit_pos = 257 % 256 = 1
        let (word, bit) = position(I256::from(257i64));
        assert_eq!(word, 1);
        assert_eq!(bit, 1);
    }

    #[test]
    fn test_position_negative() {
        // tick = -1 => in two's complement, tick >> 8 = -1 => word_pos = -1
        // bit_pos = low 8 bits of -1 = 0xFF = 255
        let (word, bit) = position(I256::from(-1i64));
        assert_eq!(word, -1);
        assert_eq!(bit, 255);

        // tick = -256 => tick >> 8 = -1, bit_pos = low 8 bits of -256 = 0
        let (word, bit) = position(I256::from(-256i64));
        assert_eq!(word, -1);
        assert_eq!(bit, 0);
    }

    #[test]
    fn test_flip_tick() {
        let mut bitmap = HashMap::new();
        let tick_spacing = I256::ONE;

        // Flip tick 0
        flip_tick(&mut bitmap, I256::ZERO, tick_spacing);
        let (word, bit) = position(I256::ZERO);
        assert_eq!(*bitmap.get(&word).unwrap() & (U256::ONE << bit), U256::ONE);

        // Flip tick 0 again (should toggle back to 0)
        flip_tick(&mut bitmap, I256::ZERO, tick_spacing);
        assert_eq!(
            *bitmap.get(&word).unwrap() & (U256::ONE << bit),
            U256::ZERO
        );
    }

    #[test]
    fn test_flip_tick_with_spacing() {
        let mut bitmap = HashMap::new();
        let tick_spacing = I256::from(60i64);

        flip_tick(&mut bitmap, I256::from(120i64), tick_spacing);
        // 120 / 60 = 2, position(2) = (0, 2)
        let val = *bitmap.get(&0i16).unwrap_or(&U256::ZERO);
        assert_eq!(val & (U256::ONE << 2), U256::from(4u64));
    }

    #[test]
    #[should_panic]
    fn test_flip_tick_not_aligned() {
        let mut bitmap = HashMap::new();
        flip_tick(&mut bitmap, I256::from(1i64), I256::from(60i64));
    }

    #[test]
    fn test_next_initialized_tick_lte() {
        let mut bitmap = HashMap::new();
        let tick_spacing = I256::ONE;

        // Set tick 10 as initialized
        flip_tick(&mut bitmap, I256::from(10i64), tick_spacing);

        // Search from tick 15, going left (lte=true)
        let (next, initialized) = next_initialized_tick_within_one_word(
            &bitmap,
            I256::from(15i64),
            tick_spacing,
            true,
            false,
        );
        assert!(initialized);
        assert_eq!(next, I256::from(10i64));
    }

    #[test]
    fn test_next_initialized_tick_gt() {
        let mut bitmap = HashMap::new();
        let tick_spacing = I256::ONE;

        // Set tick 20 as initialized
        flip_tick(&mut bitmap, I256::from(20i64), tick_spacing);

        // Search from tick 10, going right (lte=false)
        let (next, initialized) = next_initialized_tick_within_one_word(
            &bitmap,
            I256::from(10i64),
            tick_spacing,
            false,
            false,
        );
        assert!(initialized);
        assert_eq!(next, I256::from(20i64));
    }

    #[test]
    fn test_next_initialized_tick_not_found_lte() {
        let bitmap = HashMap::new();
        let tick_spacing = I256::ONE;

        // No ticks initialized; searching left from tick 100
        let (next, initialized) = next_initialized_tick_within_one_word(
            &bitmap,
            I256::from(100i64),
            tick_spacing,
            true,
            false,
        );
        assert!(!initialized);
        // Should return the leftmost tick in this word
        // compressed = 100, position(100) = (0, 100), next = (100 - 100) * 1 = 0
        assert_eq!(next, I256::ZERO);
    }

    #[test]
    fn test_next_initialized_tick_not_found_gt() {
        let bitmap = HashMap::new();
        let tick_spacing = I256::ONE;

        // No ticks initialized; searching right from tick 0
        let (next, initialized) = next_initialized_tick_within_one_word(
            &bitmap,
            I256::ZERO,
            tick_spacing,
            false,
            false,
        );
        assert!(!initialized);
        // compressed = 0, position(1) = (0, 1), next = (0 + 1 + (255 - 1)) * 1 = 255
        assert_eq!(next, I256::from(255i64));
    }

    #[test]
    fn test_next_initialized_tick_negative_range() {
        let mut bitmap = HashMap::new();
        let tick_spacing = I256::ONE;

        // Set tick -10 as initialized
        flip_tick(&mut bitmap, I256::from(-10i64), tick_spacing);

        // Search from tick -5, going left
        let (next, initialized) = next_initialized_tick_within_one_word(
            &bitmap,
            I256::from(-5i64),
            tick_spacing,
            true,
            false,
        );
        assert!(initialized);
        assert_eq!(next, I256::from(-10i64));
    }
}
