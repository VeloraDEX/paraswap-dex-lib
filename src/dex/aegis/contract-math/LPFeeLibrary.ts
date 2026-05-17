import { _require } from '../../../utils';

export class LPFeeLibrary {
  static readonly DYNAMIC_FEE_FLAG: bigint = 0x800000n;
  static readonly OVERRIDE_FEE_FLAG: bigint = 0x400000n;
  static readonly REMOVE_OVERRIDE_MASK: bigint = 0xbfffffn;
  static readonly MAX_LP_FEE: bigint = 1000000n;

  static isDynamicFee(fee: bigint): boolean {
    return fee === this.DYNAMIC_FEE_FLAG;
  }

  static isValid(fee: bigint): boolean {
    return fee <= this.MAX_LP_FEE;
  }

  static validate(fee: bigint): void {
    _require(this.isValid(fee), `LPFeeTooLarge: ${fee}`, { fee });
  }

  static getInitialLPFee(fee: bigint): bigint {
    return this.isDynamicFee(fee) ? 0n : (this.validate(fee), fee);
  }

  static isOverride(fee: bigint): boolean {
    return (fee & this.OVERRIDE_FEE_FLAG) !== 0n;
  }

  static removeOverrideFlag(fee: bigint): bigint {
    return fee & this.REMOVE_OVERRIDE_MASK;
  }

  static removeOverrideFlagAndValidate(fee: bigint): bigint {
    const newFee = this.removeOverrideFlag(fee);
    this.validate(newFee);
    return newFee;
  }
}
