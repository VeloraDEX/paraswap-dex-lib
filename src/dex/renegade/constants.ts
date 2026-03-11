// Constants for Renegade DEX integration
import { Network } from '../../constants';

export const RENEGADE_NAME = 'Renegade';

// Renegade API hosts.
export const RENEGADE_ARBITRUM_API_BASE_URL =
  'https://arbitrum-one.v2.auth-server.renegade.fi';
export const RENEGADE_BASE_API_BASE_URL =
  'https://base-mainnet.v2.auth-server.renegade.fi';

export const RENEGADE_MARKETS_DEPTH_ENDPOINT = '/v2/markets/depth';
export const RENEGADE_ASSEMBLE_ENDPOINT =
  '/v2/external-matches/assemble-match-bundle';

export function buildRenegadeApiUrl(network: Network): string {
  switch (network) {
    case Network.ARBITRUM:
      return RENEGADE_ARBITRUM_API_BASE_URL;
    case Network.BASE:
      return RENEGADE_BASE_API_BASE_URL;
    default:
      throw new Error(`Network ${network} is not supported by Renegade`);
  }
}

// Caching constants
export const RENEGADE_LEVELS_CACHE_TTL_SECONDS = 30;
export const RENEGADE_LEVELS_POLLING_INTERVAL = 15_000;
export const RENEGADE_LEVELS_CACHE_KEY = 'renegade_levels';

export const RENEGADE_TOKEN_METADATA_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const RENEGADE_TOKEN_METADATA_POLLING_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
export const RENEGADE_TOKEN_METADATA_CACHE_KEY = 'renegade_token_metadata';

// API timeout settings
export const RENEGADE_API_TIMEOUT_MS = 10_000;

// Authentication constants
export const RENEGADE_HEADER_PREFIX = 'x-renegade';
export const RENEGADE_API_KEY_HEADER = 'x-renegade-api-key';
export const RENEGADE_AUTH_HEADER = 'x-renegade-auth';
export const RENEGADE_AUTH_EXPIRATION_HEADER = 'x-renegade-auth-expiration';
export const REQUEST_SIGNATURE_DURATION_MS = 10_000;

// Gas cost estimation
export const RENEGADE_GAS_COST = 3_000_000;

// Calldata / selector constants
export const RENEGADE_SETTLEMENT_BUNDLE_DATA_WORDS = 33;
export const RENEGADE_SETTLE_EXTERNAL_MATCH_AMOUNT_IN_POS = 4;

// Token metadata API constants
export const RENEGADE_TOKEN_MAPPINGS_BASE_URL =
  'https://raw.githubusercontent.com/renegade-fi/token-mappings/main/';
