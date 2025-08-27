import { BN_POWS } from '../../bignumber-constants';
import { Network } from '../../constants';

export const PENDLE_API_URL = 'https://api-v2.pendle.finance/core';
export const AAVE_PT_TO_UNDERLYING_GAS_COST = 200000;
export const DEFAULT_SLIPPAGE_FOR_QUOTTING = 0.005; // 0.5%

export const STABLE_COINS: { [network: number]: string[] } = {
  [Network.MAINNET]: [
    '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
  ],
};
