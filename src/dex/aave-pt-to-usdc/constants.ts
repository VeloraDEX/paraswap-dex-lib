import { BN_POWS } from '../../bignumber-constants';
import { Network } from '../../constants';

export const PENDLE_API_URL = 'https://api-v2.pendle.finance';
export const AAVE_PT_TO_USDC_GAS_COST = 200000;
export const DEFAULT_SLIPPAGE_FOR_QUOTTING = 0.005; // 0.5%

export const STABLE_COINS: { [network: number]: string[] } = {
  [Network.MAINNET]: [
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  ],
};
