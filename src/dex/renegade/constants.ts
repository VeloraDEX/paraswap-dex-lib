// Constants for Renegade DEX integration
import { Network } from '../../constants';

export const RENEGADE_NAME = 'Renegade';

// Base API URLs for each network
export const RENEGADE_ARBITRUM_BASE_URL =
  'https://arbitrum-one.auth-server.renegade.fi';
export const RENEGADE_BASE_BASE_URL =
  'https://base-mainnet.auth-server.renegade.fi';

export const RENEGADE_LEVELS_ENDPOINT = '/rfqt/v3/levels';
export const RENEGADE_QUOTE_ENDPOINT = '/v0/matching-engine/quote';
export const RENEGADE_ASSEMBLE_ENDPOINT =
  '/v0/matching-engine/assemble-external-match';

// Get Renegade API base URL for a specific network.
export function buildRenegadeApiUrl(network: Network): string {
  switch (network) {
    case Network.ARBITRUM:
      return RENEGADE_ARBITRUM_BASE_URL;
    case Network.BASE:
      return RENEGADE_BASE_BASE_URL;
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

export const RENEGADE_QUOTE_CACHE_TTL_SECONDS = 5;
export const RENEGADE_QUOTE_CACHE_KEY = 'renegade_quote';

// API timeout settings
export const RENEGADE_API_TIMEOUT_MS = 10_000;
export const RENEGADE_INIT_TIMEOUT_MS = 5_000;

// Authentication constants
export const RENEGADE_HEADER_PREFIX = 'x-renegade';
export const RENEGADE_API_KEY_HEADER = 'x-renegade-api-key';
export const RENEGADE_AUTH_HEADER = 'x-renegade-auth';
export const RENEGADE_AUTH_EXPIRATION_HEADER = 'x-renegade-auth-expiration';
export const REQUEST_SIGNATURE_DURATION_MS = 10_000;

// Gas cost estimation
export const RENEGADE_GAS_COST = 3_000_000;

// Token metadata API constants
export const RENEGADE_TOKEN_MAPPINGS_BASE_URL =
  'https://raw.githubusercontent.com/renegade-fi/token-mappings/main/';
