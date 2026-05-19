use ethnum::{I256, U256};

/// Adds a signed liquidity delta to an unsigned liquidity value.
///
/// In Solidity, when y < 0:
///   z = x - uint128(-y); require(z < x)
/// When y >= 0:
///   z = x + uint128(y); require(z >= x)
///
/// Panics with "LS" if y < 0 and the subtraction underflows.
/// Panics with "LA" if y >= 0 and the addition overflows.
pub fn add_delta(x: U256, y: I256) -> U256 {
    let mask_128: U256 = (U256::ONE << 128) - U256::ONE;

    if y < I256::ZERO {
        // _y = BigInt.asUintN(128, -y)
        // (-y) is positive I256; reinterpret as U256 and mask to 128 bits
        let neg_y_u256 = (-y).as_u256();
        let _y = neg_y_u256 & mask_128;
        let z = x.checked_sub(_y).expect("LS");
        assert!(z < x, "LS");
        z
    } else {
        // _y = BigInt.asUintN(128, y)
        let _y = y.as_u256() & mask_128;
        let z = x.checked_add(_y).expect("LA");
        assert!(z >= x, "LA");
        z
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_positive_delta() {
        let x = U256::from(100u64);
        let y = I256::new(50);
        assert_eq!(add_delta(x, y), U256::from(150u64));
    }

    #[test]
    fn test_add_negative_delta() {
        let x = U256::from(100u64);
        let y = I256::new(-50);
        assert_eq!(add_delta(x, y), U256::from(50u64));
    }

    #[test]
    fn test_add_zero_delta() {
        let x = U256::from(100u64);
        let y = I256::ZERO;
        assert_eq!(add_delta(x, y), U256::from(100u64));
    }

    #[test]
    #[should_panic(expected = "LS")]
    fn test_subtract_too_much() {
        let x = U256::from(50u64);
        let y = I256::new(-100);
        add_delta(x, y);
    }

    #[test]
    #[should_panic(expected = "LA")]
    fn test_add_overflow() {
        let x = U256::MAX;
        let y = I256::new(1);
        add_delta(x, y);
    }
}
