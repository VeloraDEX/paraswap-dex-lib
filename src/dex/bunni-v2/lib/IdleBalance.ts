import { divWad, subReLU } from './Math';

export type IdleBalance = string;

export const IdleBalanceLibrary = {
  BALANCE_MASK: BigInt(
    '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  ),
  ZERO: '0x8000000000000000000000000000000000000000000000000000000000000000',

  fromIdleBalance(idleBalance: IdleBalance): {
    rawBalance: bigint;
    isToken0: boolean;
  } {
    const _idleBalance = BigInt(idleBalance);
    const isToken0 = _idleBalance >> BigInt(255) !== BigInt(0);
    const rawBalance = _idleBalance & this.BALANCE_MASK;
    return { rawBalance, isToken0 };
  },

  toIdleBalance(rawBalance: bigint, isToken0: boolean): IdleBalance {
    if (BigInt(rawBalance) > this.BALANCE_MASK) {
      throw new Error('IdleBalanceLibrary__BalanceOverflow');
    }

    const balanceBigInt = BigInt(rawBalance);
    const token0Flag = isToken0 ? BigInt(1) << BigInt(255) : BigInt(0);
    const packed = (token0Flag | balanceBigInt).toString(16);

    const paddedHex = '0x' + packed.padStart(64, '0');
    return paddedHex as IdleBalance;
  },

  computeIdleBalance(
    activeBalance0: bigint,
    activeBalance1: bigint,
    balance0: bigint,
    balance1: bigint,
  ): IdleBalance {
    const extraBalance0 = subReLU(balance0, activeBalance0);
    const extraBalance1 = subReLU(balance1, activeBalance1);
    const extraBalanceProportion0 =
      balance0 === 0n ? 0n : divWad(extraBalance0, balance0);
    const extraBalanceProportion1 =
      balance1 === 0n ? 0n : divWad(extraBalance1, balance1);
    const isToken0 = extraBalanceProportion0 >= extraBalanceProportion1;
    return this.toIdleBalance(
      isToken0 ? extraBalance0 : extraBalance1,
      isToken0,
    );
  },
};
