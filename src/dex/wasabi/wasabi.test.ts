import { Interface } from '@ethersproject/abi';
import { Wasabi } from './wasabi';
import { Sample } from './types';
import { SwapSide } from '../../constants';
import { RETURN_AMOUNT_POS_0 } from '../../executor/constants';
import WasabiRouterABI from '../../abi/wasabi/WasabiRouter.json';

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

describe('Wasabi.getDexParam', () => {
  it('uses named amountOut output for returnAmountPos extraction', () => {
    const mockWasabi = {
      routerIface: new Interface(WasabiRouterABI),
      config: { routerAddress: '0x1111111111111111111111111111111111111111' },
      needWrapNative: true,
      getDeadline: () => '123',
    } as unknown as Wasabi;

    const dexParam = Wasabi.prototype.getDexParam.call(
      mockWasabi,
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '100',
      '90',
      '0x0000000000000000000000000000000000000003',
      {
        pool: '0x0000000000000000000000000000000000000004',
        tokenIn: '0x0000000000000000000000000000000000000001',
        tokenOut: '0x0000000000000000000000000000000000000002',
      },
      SwapSide.SELL,
    );

    expect(dexParam.returnAmountPos).toBe(RETURN_AMOUNT_POS_0);
  });
});
