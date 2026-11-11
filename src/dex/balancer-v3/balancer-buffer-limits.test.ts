// npx jest src/dex/balancer-v3/balancer-buffer-limits.test.ts
import dotenv from 'dotenv';
dotenv.config();
import { SwapKind } from '@balancer-labs/balancer-maths';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper';
import { BalancerV3EventPool } from './balancer-v3-pool';
import { BufferStateExt, Step } from './types';

// waGnoGNO, whose Aave GNO supply cap is full: maxDeposit and maxMint are 0
const waGnoGNO = '0x7c16f0185a26db0ae7a9377f23bc18ea7ce5d644';
const gno = '0x9c58bacc331c9aa871afd802db6379a98e80cedb';

const dexHelper = new DummyDexHelper(Network.GNOSIS);
const pool = new BalancerV3EventPool(
  'BalancerV3',
  Network.GNOSIS,
  dexHelper,
  dexHelper.getLogger('BalancerV3-buffer-limits'),
);

function bufferStep(limits: Partial<BufferStateExt>, isUnwrap = false): Step[] {
  return [
    {
      pool: waGnoGNO,
      isBuffer: true,
      swapInput: isUnwrap
        ? { tokenIn: waGnoGNO, tokenOut: gno }
        : { tokenIn: gno, tokenOut: waGnoGNO },
      poolState: {
        poolType: 'Buffer',
        poolAddress: waGnoGNO,
        tokens: [waGnoGNO, gno],
        rate: 1007217647221464673n,
        maxDeposit: 10n ** 30n,
        maxMint: 10n ** 30n,
        maxRedeem: 10n ** 30n,
        maxWithdraw: 10n ** 30n,
        ...limits,
      },
    },
  ];
}

const swap = (steps: Step[], amount: bigint, kind: SwapKind) =>
  pool.getSwapResult(steps, amount, kind, 0, {});

describe('BalancerV3 buffer ERC4626 limits', () => {
  const amount = 10n ** 17n;

  it('prices a wrap within the limits', () => {
    expect(swap(bufferStep({}), amount, SwapKind.GivenIn)).toBeGreaterThan(0n);
    expect(swap(bufferStep({}), amount, SwapKind.GivenOut)).toBeGreaterThan(0n);
  });

  it('returns 0 for a wrap when maxDeposit/maxMint is 0', () => {
    expect(
      swap(bufferStep({ maxDeposit: 0n }), amount, SwapKind.GivenIn),
    ).toEqual(0n);
    expect(
      swap(bufferStep({ maxMint: 0n }), amount, SwapKind.GivenOut),
    ).toEqual(0n);
  });

  it('returns 0 for a wrap above a nonzero limit', () => {
    expect(
      swap(bufferStep({ maxDeposit: amount - 1n }), amount, SwapKind.GivenIn),
    ).toEqual(0n);
  });

  it('returns 0 for an unwrap above maxRedeem/maxWithdraw', () => {
    expect(
      swap(bufferStep({ maxRedeem: 0n }, true), amount, SwapKind.GivenIn),
    ).toEqual(0n);
    expect(
      swap(bufferStep({ maxWithdraw: 0n }, true), amount, SwapKind.GivenOut),
    ).toEqual(0n);
    expect(
      swap(bufferStep({}, true), amount, SwapKind.GivenIn),
    ).toBeGreaterThan(0n);
  });
});
