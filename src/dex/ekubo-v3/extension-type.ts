import {
  BOOSTED_FEES_CONCENTRATED_ADDRESS,
  MEV_CAPTURE_ADDRESS,
  ORACLE_ADDRESS,
  TWAMM_ADDRESS,
} from './config';

export const enum ExtensionType {
  Unknown,
  NoSwapCallPoints,
  Oracle,
  Twamm,
  MevCapture,
  BoostedFeesConcentrated,
  MevCaptureV21,
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

/**
 * @param mevCaptureV21Extension the MEVCapture v2.1 deployment of the network,
 * if it has one
 */
export function extensionType(
  extension: bigint,
  mevCaptureV21Extension?: bigint,
): ExtensionType {
  const known = KNOWN_EXTENSION_TYPES.get(extension);
  if (typeof known !== 'undefined') {
    return known;
  }

  if (extension === mevCaptureV21Extension) {
    return ExtensionType.MevCaptureV21;
  }

  // Call points are encoded in the first byte of the extension address.
  const hasNoSwapCallPoints =
    (extension & 0x6000000000000000000000000000000000000000n) === 0n;
  if (hasNoSwapCallPoints) {
    return ExtensionType.NoSwapCallPoints;
  }

  return ExtensionType.Unknown;
}
