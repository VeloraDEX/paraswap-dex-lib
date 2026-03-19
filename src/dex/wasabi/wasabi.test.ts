import { Wasabi } from './wasabi';
import { Sample } from './types';

describe('Wasabi.interpolate', () => {
  const interpolate = (Wasabi.prototype as any).interpolate as (
    samples: Sample[],
    amountIn: bigint,
  ) => bigint;

  it('interpolates between surrounding samples', () => {
    const samples: Sample[] = [
      [1n, 100n],
      [2n, 150n],
      [4n, 210n],
    ];

    expect(interpolate(samples, 3n)).toBe(180n);
  });

  it('returns the exact sample output for an exact sample input', () => {
    const samples: Sample[] = [
      [1n, 100n],
      [2n, 150n],
      [4n, 210n],
    ];

    expect(interpolate(samples, 2n)).toBe(150n);
  });

  it('clamps to the last sample output above the sampled range', () => {
    const samples: Sample[] = [
      [1n, 100n],
      [2n, 150n],
      [4n, 210n],
    ];

    expect(interpolate(samples, 8n)).toBe(210n);
  });

  it('scales from origin below the first sample', () => {
    const samples: Sample[] = [[10n, 40n]];

    expect(interpolate(samples, 5n)).toBe(20n);
  });
});
