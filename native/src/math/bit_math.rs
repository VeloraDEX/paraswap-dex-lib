use ethnum::U256;

/// Returns the index of the most significant bit of the number,
/// where the least significant bit is at index 0 and the most significant bit is at index 255.
///
/// Panics if x is zero.
pub fn most_significant_bit(x: U256) -> u8 {
    assert!(x > U256::ZERO, "x must be > 0");
    let mut x = x;
    let mut r: u8 = 0;

    if x >= U256::from_words(1, 0) {
        x >>= 128;
        r += 128;
    }
    if x >= U256::from(0x10000000000000000u128) {
        x >>= 64;
        r += 64;
    }
    if x >= U256::from(0x100000000u128) {
        x >>= 32;
        r += 32;
    }
    if x >= U256::from(0x10000u64) {
        x >>= 16;
        r += 16;
    }
    if x >= U256::from(0x100u64) {
        x >>= 8;
        r += 8;
    }
    if x >= U256::from(0x10u64) {
        x >>= 4;
        r += 4;
    }
    if x >= U256::from(0x4u64) {
        x >>= 2;
        r += 2;
    }
    if x >= U256::from(0x2u64) {
        r += 1;
    }

    r
}

/// Returns the index of the least significant bit of the number,
/// where the least significant bit is at index 0 and the most significant bit is at index 255.
///
/// Panics if x is zero.
pub fn least_significant_bit(x: U256) -> u8 {
    assert!(x > U256::ZERO, "x must be > 0");
    let mut x = x;
    let mut r: u8 = 255;

    let max_uint128: U256 = U256::new(u128::MAX);
    let max_uint64: U256 = U256::from(u64::MAX);
    let max_uint32: U256 = U256::from(u32::MAX as u64);
    let max_uint16: U256 = U256::from(u16::MAX as u64);
    let max_uint8: U256 = U256::from(u8::MAX as u64);

    if (x & max_uint128) > U256::ZERO {
        r -= 128;
    } else {
        x >>= 128;
    }
    if (x & max_uint64) > U256::ZERO {
        r -= 64;
    } else {
        x >>= 64;
    }
    if (x & max_uint32) > U256::ZERO {
        r -= 32;
    } else {
        x >>= 32;
    }
    if (x & max_uint16) > U256::ZERO {
        r -= 16;
    } else {
        x >>= 16;
    }
    if (x & max_uint8) > U256::ZERO {
        r -= 8;
    } else {
        x >>= 8;
    }
    if (x & U256::from(0xFu64)) > U256::ZERO {
        r -= 4;
    } else {
        x >>= 4;
    }
    if (x & U256::from(0x3u64)) > U256::ZERO {
        r -= 2;
    } else {
        x >>= 2;
    }
    if (x & U256::ONE) > U256::ZERO {
        r -= 1;
    }

    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_msb_one() {
        assert_eq!(most_significant_bit(U256::ONE), 0);
    }

    #[test]
    fn test_msb_two() {
        assert_eq!(most_significant_bit(U256::from(2u64)), 1);
    }

    #[test]
    fn test_msb_powers_of_two() {
        for i in 0..=255u8 {
            let x = U256::ONE << i;
            assert_eq!(most_significant_bit(x), i);
        }
    }

    #[test]
    fn test_msb_max() {
        assert_eq!(most_significant_bit(U256::MAX), 255);
    }

    #[test]
    #[should_panic]
    fn test_msb_zero_panics() {
        most_significant_bit(U256::ZERO);
    }

    #[test]
    fn test_lsb_one() {
        assert_eq!(least_significant_bit(U256::ONE), 0);
    }

    #[test]
    fn test_lsb_two() {
        assert_eq!(least_significant_bit(U256::from(2u64)), 1);
    }

    #[test]
    fn test_lsb_powers_of_two() {
        for i in 0..=255u8 {
            let x = U256::ONE << i;
            assert_eq!(least_significant_bit(x), i);
        }
    }

    #[test]
    fn test_lsb_max() {
        assert_eq!(least_significant_bit(U256::MAX), 0);
    }

    #[test]
    #[should_panic]
    fn test_lsb_zero_panics() {
        least_significant_bit(U256::ZERO);
    }

    #[test]
    fn test_msb_mixed() {
        assert_eq!(most_significant_bit(U256::from(10u64)), 3);
        assert_eq!(most_significant_bit(U256::from(24u64)), 4);
    }

    #[test]
    fn test_lsb_mixed() {
        assert_eq!(least_significant_bit(U256::from(10u64)), 1);
        assert_eq!(least_significant_bit(U256::from(24u64)), 3);
    }
}
