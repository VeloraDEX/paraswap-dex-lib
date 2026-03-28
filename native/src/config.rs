/// Configures math variant differences between Uniswap V3 forks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathVariant {
    /// Standard Uniswap V3: feeProtocol is 4-bit (% 16 / >> 4)
    UniswapV3,
    /// PancakeSwap V3: feeProtocol is 16-bit (% 65536 / >> 16), protocol_fee = feeAmount * fp / 10000
    PancakeSwapV3,
    /// Solidly V3: No oracle, fee from slot0.fee directly
    SolidlyV3,
}

impl MathVariant {
    pub fn from_str(s: &str) -> Self {
        match s {
            "pancakeswap_v3" => MathVariant::PancakeSwapV3,
            "solidly_v3" => MathVariant::SolidlyV3,
            _ => MathVariant::UniswapV3,
        }
    }

    /// Extract the fee protocol value for the given swap direction.
    pub fn fee_protocol(&self, fee_protocol_raw: ethnum::U256, zero_for_one: bool) -> ethnum::U256 {
        match self {
            MathVariant::UniswapV3 | MathVariant::SolidlyV3 => {
                if zero_for_one {
                    fee_protocol_raw % ethnum::U256::from(16u32)
                } else {
                    fee_protocol_raw >> 4
                }
            }
            MathVariant::PancakeSwapV3 => {
                if zero_for_one {
                    fee_protocol_raw % ethnum::U256::from(65536u32)
                } else {
                    fee_protocol_raw >> 16
                }
            }
        }
    }
}
