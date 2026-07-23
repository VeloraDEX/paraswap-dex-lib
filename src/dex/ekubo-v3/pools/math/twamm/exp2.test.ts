import { exp2 } from './exp2';

describe(exp2, () => {
  test('cases', () => {
    expect(exp2(0n)).toEqual(1n << 64n);
    expect(exp2(1n << 64n)).toEqual(2n << 64n);
    expect(exp2((3n << 64n) / 2n)).toEqual(52175271301331128849n);
    expect(exp2((62n << 64n) + (3n << 64n) / 2n)).toEqual(
      240615969168004511545033772477625056927n,
    );
    expect(exp2(2n << 64n)).toEqual(4n << 64n);
    expect(exp2(3n << 64n)).toEqual(8n << 64n);
    expect(exp2(63n << 64n)).toEqual(9223372036854775808n << 64n);
  });
});
