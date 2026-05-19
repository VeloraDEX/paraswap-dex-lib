/// Configures math variant differences between Uniswap V3 forks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MathVariant {
    /// Standard Uniswap V3: feeProtocol is 4-bit (% 16 / >> 4)
    UniswapV3,
    /// PancakeSwap V3: feeProtocol is 16-bit (% 65536 / >> 16), delta = feeAmount * fp / 10000
    PancakeSwapV3,
    /// Solidly V3: No oracle, no feeProtocol, fee from slot0.fee
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
    pub fn fee_protocol(
        &self,
        fee_protocol_raw: ethnum::U256,
        zero_for_one: bool,
    ) -> ethnum::U256 {
        match self {
            MathVariant::SolidlyV3 => ethnum::U256::ZERO, // no protocol fee
            MathVariant::UniswapV3 => {
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

    /// Calculate protocol fee delta from fee amount.
    /// V3:         delta = feeAmount / feeProtocol
    /// PancakeSwap: delta = (feeAmount * feeProtocol) / 10000
    pub fn protocol_fee_delta(
        &self,
        fee_amount: ethnum::U256,
        fee_protocol: ethnum::U256,
    ) -> ethnum::U256 {
        match self {
            MathVariant::SolidlyV3 => ethnum::U256::ZERO,
            MathVariant::UniswapV3 => fee_amount / fee_protocol,
            MathVariant::PancakeSwapV3 => {
                (fee_amount * fee_protocol) / ethnum::U256::from(10000u32)
            }
        }
    }

    /// Whether this variant uses oracle observations.
    pub fn has_oracle(&self) -> bool {
        !matches!(self, MathVariant::SolidlyV3)
    }

    /// PancakeSwap V3 and Solidly V3 zero out remaining amounts for BOTH sell and buy at end of cycles.
    /// V3 only zeros for BUY.
    pub fn zero_remaining_for_sell(&self) -> bool {
        matches!(self, MathVariant::SolidlyV3 | MathVariant::PancakeSwapV3)
    }
}
