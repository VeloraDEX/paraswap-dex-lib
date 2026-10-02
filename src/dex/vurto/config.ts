import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network } from '../../constants';

/**
 * Vurto Swap is an aggregator, not a pool venue.
 *
 * There is exactly one integration target per chain: the VurtoSwapRouter. It is
 * what `tx.to` and `spender` always resolve to, on every route we can produce,
 * so a single allowlist entry per chain covers the whole integration and never
 * needs to change when we add a venue.
 *
 * Addresses read from https://swap.vurto.cc/gateway/v1/chains on 2026-09-22.
 */
export const VURTO_GATEWAY = 'https://swap.vurto.cc/gateway/v1';

/** Our quotes carry `validUntil`; this is the window we trust a cached one. */
export const VURTO_QUOTE_TTL_MS = 8_000;

/**
 * Ceiling for a single pricing round.
 *
 * 2.5s, and the number is not arbitrary: the pricing helper in this repository
 * aborts the whole round at 3s. A per-quote ceiling ABOVE that guarantees the
 * abort fires first and Vurto returns nothing, which is exactly what happened
 * with the 4s this constant used to hold. Ours has to end first, with room for
 * the round to assemble the answer.
 */
export const VURTO_PRICING_TIMEOUT_MS = 2_500;

/**
 * Router overhead on top of the venue call, in gas units.
 *
 * The router pulls the token, approves the venue for exactly what arrived,
 * calls it, revokes the approval and measures the output. That wrapper is what
 * this number covers; the venue's own cost comes from the quote.
 */
export const VURTO_ROUTER_GAS = 70_000;

export const VurtoConfig: DexConfigMap<DexParams> = {
  Vurto: {
    [Network.MAINNET]: {
      router: '0x0104c775ea4dc75175a0b6d3768d12b2f0a36990',
      gateway: VURTO_GATEWAY,
    },
    [Network.OPTIMISM]: {
      router: '0xa8a3ec11c51d1caa010c38404f04ccde377b6255',
      gateway: VURTO_GATEWAY,
    },
    [Network.BSC]: {
      router: '0xb789702e8d71999825334a998fca47fc79b4618a',
      gateway: VURTO_GATEWAY,
    },
    [Network.GNOSIS]: {
      router: '0xa34a196e342c8f48a29ff907e9eeafec66f84c20',
      gateway: VURTO_GATEWAY,
    },
    [Network.UNICHAIN]: {
      router: '0xd22e08dce358e134c08638852634edf395232085',
      gateway: VURTO_GATEWAY,
    },
    [Network.POLYGON]: {
      router: '0xe109f0a8ca9db014885e39ec025fee6cf14a7060',
      gateway: VURTO_GATEWAY,
    },
    [Network.BASE]: {
      router: '0x15cb65b1c6026334a079e48241d6c8fa79df7784',
      gateway: VURTO_GATEWAY,
    },
    [Network.ARBITRUM]: {
      router: '0xd5d4b7efbbcd1bc15411a59b998c9e6f6aa67044',
      gateway: VURTO_GATEWAY,
    },
    [Network.AVALANCHE]: {
      router: '0x75afa1b2058d9398eb9e6d65622747f43a1af38c',
      gateway: VURTO_GATEWAY,
    },
  },
};
