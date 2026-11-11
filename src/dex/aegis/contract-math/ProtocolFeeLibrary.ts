export class ProtocolFeeLibrary {
  static readonly MAX_PROTOCOL_FEE: bigint = 1000n;
  static readonly FEE_0_THRESHOLD: bigint = 1001n;
  static readonly FEE_1_THRESHOLD: bigint = 1001n << 12n;
  static readonly PIPS_DENOMINATOR: bigint = 1_000_000n;

  static getZeroForOneFee(protocolFee: bigint): bigint {
    return BigInt(Number(protocolFee) & 0xfff);
  }

  static getOneForZeroFee(protocolFee: bigint): bigint {
    return protocolFee >> 12n;
  }

  static isValidProtocolFee(protocolFee: bigint): boolean {
    let isZeroForOneFeeOk =
      (protocolFee & 0xfffn) < ProtocolFeeLibrary.FEE_0_THRESHOLD;
    let isOneForZeroFeeOk =
      (protocolFee & 0xfff000n) < ProtocolFeeLibrary.FEE_1_THRESHOLD;
    return isZeroForOneFeeOk && isOneForZeroFeeOk;
  }

  static calculateSwapFee(protocolFee: bigint, lpFee: bigint): bigint {
    const numerator = protocolFee * lpFee;
    const swapFee = numerator / ProtocolFeeLibrary.PIPS_DENOMINATOR;
    return swapFee;
  }
}
