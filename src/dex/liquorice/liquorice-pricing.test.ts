import BigNumber from 'bignumber.js';
import { SwapSide } from '../../constants';
import { bestQuote, curveDepth, quoteCurve } from './pricing';
import { LiquoriceCurve } from './types';

const bn = (v: string | number) => new BigNumber(v);

// Liquorice docs example: the maker buys 0.5 @ 2999.5, 1 @ 3000.5, 2 @ 3002
const docsCurve: LiquoriceCurve = {
  minAmount: '0.5',
  levels: [
    ['2999.5', '0.5'],
    ['3000.5', '1'],
    ['3002.0', '2'],
  ],
};

describe('Liquorice pricing', () => {
  describe('quoteCurve SELL', () => {
    it('consumes levels in order', () => {
      expect(quoteCurve(docsCurve, bn(2), SwapSide.SELL)!.toFixed()).toBe(
        // 0.5 * 2999.5 + 1 * 3000.5 + 0.5 * 3002
        '6001.25',
      );
    });

    it('quotes the full depth exactly', () => {
      expect(quoteCurve(docsCurve, bn(3.5), SwapSide.SELL)!.toFixed()).toBe(
        '10504.25',
      );
    });

    it('does not quote beyond the depth', () => {
      expect(quoteCurve(docsCurve, bn('3.5000001'), SwapSide.SELL)).toBeNull();
    });

    it('does not quote below the maker minimum', () => {
      expect(quoteCurve(docsCurve, bn('0.4999'), SwapSide.SELL)).toBeNull();
      expect(quoteCurve(docsCurve, bn('0.5'), SwapSide.SELL)!.toFixed()).toBe(
        '1499.75',
      );
    });

    it('does not quote zero', () => {
      expect(quoteCurve(docsCurve, bn(0), SwapSide.SELL)).toBeNull();
    });
  });

  it('does not support BUY yet', () => {
    expect(quoteCurve(docsCurve, bn(1), SwapSide.BUY)).toBeNull();
    expect(bestQuote([docsCurve], bn(1), SwapSide.BUY)).toBeNull();
  });

  describe('bestQuote', () => {
    const small: LiquoriceCurve = { minAmount: '1', levels: [['3010', '2']] };
    const large: LiquoriceCurve = {
      minAmount: '5',
      levels: [['3005', '100']],
    };

    it('picks the single best maker and never sums curves', () => {
      // 1.5: only `small` and `docsCurve` cover it; small pays more
      expect(
        bestQuote([docsCurve, small, large], bn(1.5), SwapSide.SELL)!.toFixed(),
      ).toBe('4515');
      // 4: only `docsCurve` would need 4 > 3.5 and `small` has 2, `large` min is 5
      expect(
        bestQuote([docsCurve, small, large], bn(4), SwapSide.SELL),
      ).toBeNull();
      // 50: only `large`
      expect(
        bestQuote([docsCurve, small, large], bn(50), SwapSide.SELL)!.toFixed(),
      ).toBe('150250');
    });
  });

  it('curveDepth sums src and dest', () => {
    const depth = curveDepth(docsCurve);
    expect(depth.src.toFixed()).toBe('3.5');
    expect(depth.dest.toFixed()).toBe('10504.25');
  });
});
