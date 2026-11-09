import {
  WAD,
  mulWad,
  mulWadUp,
  divWad,
  divWadUp,
  fullMulDiv,
  fullMulDivUp,
  zeroFloorSub,
  normalizeWad,
  denormalizeWad,
  denormalizeWadUp,
  lnWad,
  expWad,
  powWad,
  sqrtWad,
} from './baseline-math';

describe('Baseline fixed-point math', () => {
  describe('WAD multiply and divide', () => {
    it('multiplies two 1e18-scaled numbers', () => {
      // 2.5 * 4 = 10
      expect(mulWad((5n * WAD) / 2n, 4n * WAD)).toEqual(10n * WAD);
    });

    it('divides two 1e18-scaled numbers', () => {
      // 3 / 4 = 0.75
      expect(divWad(3n * WAD, 4n * WAD)).toEqual((3n * WAD) / 4n);
    });

    it('rounds down by default and up on the "Up" variants', () => {
      // A sub-wei product floors to 0 or ceils to 1
      expect(mulWad(1n, 1n)).toEqual(0n);
      expect(mulWadUp(1n, 1n)).toEqual(1n);
      // 1 / 3 = 0.333... — one wei apart depending on rounding
      expect(divWad(WAD, 3n * WAD)).toEqual(333333333333333333n);
      expect(divWadUp(WAD, 3n * WAD)).toEqual(333333333333333334n);
    });

    it('fullMulDiv computes x*y/d, flooring or ceiling the remainder', () => {
      expect(fullMulDiv(7n, 7n, 3n)).toEqual(16n); // 49/3 = 16.33
      expect(fullMulDivUp(7n, 7n, 3n)).toEqual(17n);
    });
  });

  describe('zeroFloorSub', () => {
    it('subtracts, clamping negatives to zero', () => {
      expect(zeroFloorSub(10n, 3n)).toEqual(7n);
      expect(zeroFloorSub(3n, 10n)).toEqual(0n);
    });
  });

  describe('decimal normalization', () => {
    it('scales an amount to and from 1e18 precision', () => {
      // 1 USDC (6 decimals) is 1e18 in WAD terms
      expect(normalizeWad(1_000_000n, 6)).toEqual(WAD);
      expect(denormalizeWad(WAD, 6)).toEqual(1_000_000n);
      // 18-decimal tokens are unchanged
      expect(normalizeWad(WAD, 18)).toEqual(WAD);
    });

    it('rounds down when shrinking precision, up on the "Up" variant', () => {
      // 1.5 wei of a 6-decimal token cannot be represented; direction differs
      expect(denormalizeWad(1_500_000_000_000n, 6)).toEqual(1n);
      expect(denormalizeWadUp(1_500_000_000_000n, 6)).toEqual(2n);
    });
  });

  describe('lnWad — natural log in 1e18 fixed point', () => {
    it('returns 0 at x = 1 and 1 at x = e', () => {
      expect(lnWad(WAD)).toEqual(0n);
      // ln(e) rounds to 1 - 1 wei
      expect(lnWad(2718281828459045235n)).toEqual(999999999999999999n);
    });

    it('is negative below 1 and grows with x', () => {
      expect(lnWad(1n)).toEqual(-41446531673892822313n);
      expect(lnWad(42n)).toEqual(-37708862055609454007n);
      expect(lnWad(10000n)).toEqual(-32236191301916639577n);
      expect(lnWad(1000000000n)).toEqual(-20723265836946411157n);
      expect(lnWad(11723640096265400935n)).toEqual(2461607324344817918n);
      expect(lnWad(340282366920938463463374607431768211456n)).toEqual(
        47276307437780177293n,
      );
    });

    it('rejects non-positive and out-of-domain inputs', () => {
      expect(() => lnWad(0n)).toThrow();
      expect(() => lnWad(-1n)).toThrow();
      expect(() => lnWad(1n << 300n)).toThrow();
    });
  });

  describe('expWad — e^x in 1e18 fixed point', () => {
    it('returns 1 at x = 0 and e at x = 1', () => {
      expect(expWad(0n)).toEqual(WAD);
      expect(expWad(WAD)).toEqual(2718281828459045235n);
    });

    it('matches known values across the domain', () => {
      expect(expWad(-3n * WAD)).toEqual(49787068367863942n);
      expect(expWad(-2n * WAD)).toEqual(135335283236612691n);
      expect(expWad(-1n * WAD)).toEqual(367879441171442321n);
      expect(expWad(2n * WAD)).toEqual(7389056098930650227n);
      expect(expWad(3n * WAD)).toEqual(20085536923187667741n);
      expect(expWad(10n * WAD)).toEqual(22026465794806716516980n);
    });

    it('underflows to zero below the lower bound', () => {
      expect(expWad(-41446531673892822312n)).toEqual(1n);
      expect(expWad(-41446531673892822313n)).toEqual(0n);
    });

    it('rejects inputs above the upper bound', () => {
      expect(() => expWad(135305999368893231589n)).toThrow();
    });
  });

  describe('powWad — x^y with both args in 1e18 fixed point', () => {
    it('raises a base to a fractional or integer power', () => {
      expect(powWad(2n * WAD, 2n * WAD)).toEqual(3999999999999999996n); // 2^2
      expect(powWad(4n * WAD, WAD / 2n)).toEqual(1999999999999999999n); // 4^0.5
      expect(powWad((3n * WAD) / 2n, 3n * WAD)).toEqual(3375000000000000000n); // 1.5^3
      expect(powWad(WAD, 5n * WAD)).toEqual(WAD); // 1^5
    });
  });

  describe('sqrtWad — square root in 1e18 fixed point', () => {
    it('computes exact roots of perfect squares', () => {
      expect(sqrtWad(WAD)).toEqual(WAD); // sqrt(1) = 1
      expect(sqrtWad(4n * WAD)).toEqual(2n * WAD); // sqrt(4) = 2
      expect(sqrtWad(9n * WAD)).toEqual(3n * WAD); // sqrt(9) = 3
    });

    it('floors an irrational root', () => {
      expect(sqrtWad(2n * WAD)).toEqual(1414213562373095048n); // sqrt(2)
    });
  });
});
