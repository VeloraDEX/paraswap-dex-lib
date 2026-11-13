import { BigNumber } from 'ethers';
import { hexConcat, hexlify, hexZeroPad } from 'ethers/lib/utils';
import { AbiPoolKey } from './types';

// Packed route data of Ekubo's Yul router (EkuboProtocol/yul-router). The
// router has no function selector: the call data is the route itself.
const FLAG_HAS_RECIPIENT = '0x01';
const HOP_TYPE_FORWARDED = '0x01';
// Zero selects the minimum or maximum sqrt ratio, by direction
const NO_SQRT_RATIO_LIMIT = '0x000000000000000000000000';
const ALLOW_PARTIAL_FILL = 0x80000000;

export const MIN_INT128 = -(1n << 127n);

const address = (a: string | bigint) =>
  hexZeroPad(hexlify(BigInt(a)), 20).toLowerCase();

const int128 = (x: bigint) =>
  hexZeroPad(BigNumber.from(x).toTwos(128).toHexString(), 16);

export type ForwardedSwapRoute = {
  // Token of `specifiedAmount`; Ekubo's address, zero for native ETH
  specifiedToken: bigint;
  calculatedToken: bigint;
  // Positive for exact input, negative for exact output
  specifiedAmount: bigint;
  // Minimum output (exact input) or negative maximum input (exact output)
  calculatedAmountThreshold: bigint;
  recipient: string;
  forwardee: bigint;
  poolKey: AbiPoolKey;
  skipAhead: number;
  allowPartial: boolean;
};

/**
 * One single-hop path through `Core.forward(forwardee, abi.encode(poolKey,
 * params))`. The router pulls the specified token from the caller with
 * `transferFrom` (or takes native ETH from the call value, refunding the
 * rest), settles once and sends the calculated token to `recipient`.
 *
 * Layout: flags (1) | path count - 1 (1) | specified token (20) | calculated
 * token (20) | threshold (int128) | recipient (20), then the path: amount
 * (int128) | hop count - 1 (1) | hop type (1) | forwardee (20) | token0 (20) |
 * token1 (20) | pool config (32) | sqrt ratio limit (12) | skip ahead with the
 * partial-fill flag in its top bit (4).
 */
export function encodeForwardedSwapRoute(route: ForwardedSwapRoute): string {
  return hexConcat([
    FLAG_HAS_RECIPIENT,
    '0x00',
    address(route.specifiedToken),
    address(route.calculatedToken),
    int128(route.calculatedAmountThreshold),
    address(route.recipient),
    int128(route.specifiedAmount),
    '0x00',
    HOP_TYPE_FORWARDED,
    address(route.forwardee),
    address(route.poolKey.token0),
    address(route.poolKey.token1),
    hexZeroPad(route.poolKey.config, 32).toLowerCase(),
    NO_SQRT_RATIO_LIMIT,
    hexZeroPad(
      hexlify(
        (route.skipAhead | (route.allowPartial ? ALLOW_PARTIAL_FILL : 0)) >>> 0,
      ),
      4,
    ),
  ]);
}

// Byte offset of the path's specified amount in `encodeForwardedSwapRoute`
export const FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET = 1 + 1 + 20 + 20 + 16 + 20;
export const FORWARDED_SWAP_ROUTE_LENGTH =
  FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET + 16 + 1 + 1 + 20 + 20 + 20 + 32 + 12 + 4;
