/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { GlueHook } from './gluehook-hook';
import { GlueHookConfig } from './config';
import { Network } from '../../../../constants';
import { PoolKey } from '../../types';

const poolKey = {} as PoolKey;

describe('GlueHook', () => {
  const hook = new GlueHook(null as any, Network.BASE, console as any);

  it('is configured with the same address on every supported network', () => {
    const addresses = Object.values(GlueHookConfig).map(c =>
      c.hookAddress.toLowerCase(),
    );
    expect(new Set(addresses).size).toBe(1);
    expect(hook.address).toBe('0x0f41715dc432692b66a5adf8dcfef6ac407b20c8');
  });

  it('afterSwap is a pure passthrough of the pool output (exact input)', () => {
    // zeroForOne exact-in: user receives amount1
    expect(
      hook.afterSwap(
        '0x0000000000000000000000000000000000000000',
        poolKey,
        {
          zeroForOne: true,
          amountSpecified: (-1000000n).toString(),
          sqrtPriceLimitX96: '0',
        },
        { amount0: -1000000n, amount1: 987654n },
        '0x',
      ),
    ).toBe(987654n);

    // oneForZero exact-in: user receives amount0
    expect(
      hook.afterSwap(
        '0x0000000000000000000000000000000000000000',
        poolKey,
        {
          zeroForOne: false,
          amountSpecified: (-1000000n).toString(),
          sqrtPriceLimitX96: '0',
        },
        { amount0: 987654n, amount1: -1000000n },
        '0x',
      ),
    ).toBe(987654n);
  });

  it('afterSwap is a pure passthrough of the pool input (exact output)', () => {
    // zeroForOne exact-out: user pays -amount0
    expect(
      hook.afterSwap(
        '0x0000000000000000000000000000000000000000',
        poolKey,
        {
          zeroForOne: true,
          amountSpecified: (1000000n).toString(),
          sqrtPriceLimitX96: '0',
        },
        { amount0: -1012345n, amount1: 1000000n },
        '0x',
      ),
    ).toBe(1012345n);

    // oneForZero exact-out: user pays -amount1
    expect(
      hook.afterSwap(
        '0x0000000000000000000000000000000000000000',
        poolKey,
        {
          zeroForOne: false,
          amountSpecified: (1000000n).toString(),
          sqrtPriceLimitX96: '0',
        },
        { amount0: 1000000n, amount1: -1012345n },
        '0x',
      ),
    ).toBe(1012345n);
  });
});
