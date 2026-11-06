import {
  BOOSTED_FEES_CONCENTRATED_ADDRESS,
  MEV_CAPTURE_ADDRESS,
  ORACLE_ADDRESS,
  TWAMM_ADDRESS,
} from './config';
import {
  ZERO_SEED_LAUNCH_CHAIN,
  ZERO_SEED_LAUNCH_ROBINHOOD,
} from './pools/zero-seed-launch';

export const enum ExtensionType {
  Unknown,
  NoSwapCallPoints,
  Oracle,
  Twamm,
  MevCapture,
  BoostedFeesConcentrated,
  ZeroSeedLaunch,
}

const KNOWN_EXTENSION_TYPES = new Map<bigint, ExtensionType>([
  [BigInt(ORACLE_ADDRESS), ExtensionType.Oracle],
  [BigInt(TWAMM_ADDRESS), ExtensionType.Twamm],
  [BigInt(MEV_CAPTURE_ADDRESS), ExtensionType.MevCapture],
  [
    BigInt(BOOSTED_FEES_CONCENTRATED_ADDRESS),
    ExtensionType.BoostedFeesConcentrated,
  ],
]);

export function extensionType(
  extension: bigint,
  chainId?: number,
): ExtensionType {
  if (
    chainId === ZERO_SEED_LAUNCH_CHAIN &&
    extension === BigInt(ZERO_SEED_LAUNCH_ROBINHOOD)
  )
    return ExtensionType.ZeroSeedLaunch;
  const known = KNOWN_EXTENSION_TYPES.get(extension);
  if (typeof known !== 'undefined') {
    return known;
  }

  // Call points are encoded in the first byte of the extension address.
  const hasNoSwapCallPoints =
    (extension & 0x6000000000000000000000000000000000000000n) === 0n;
  if (hasNoSwapCallPoints) {
    return ExtensionType.NoSwapCallPoints;
  }

  return ExtensionType.Unknown;
}
