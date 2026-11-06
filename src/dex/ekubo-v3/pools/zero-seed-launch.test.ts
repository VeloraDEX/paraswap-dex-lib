import { createHash } from 'crypto';
import { Interface } from '@ethersproject/abi';
import { extensionType, ExtensionType } from '../extension-type';
import { PoolKey, PoolConfig, ConcentratedPoolTypeConfig } from './utils';
import { toSqrtRatio } from './math/tick';
import {
  decayedLaunchFee,
  quoteZeroSeedLaunch,
  LaunchState,
  ZERO_SEED_LAUNCH_ABI,
  ZERO_SEED_LAUNCH_ROBINHOOD,
} from './zero-seed-launch';

// Local Core/router vectors, evm-contracts 1d74ed414a5a91100440b128ef07fbe15acf37a5,
// test/vectors/zero-seed-launch.json v8. These are not live execution evidence.
const cases = [
  [
    -13798330,
    -9210880,
    1121810267768648385524834n,
    1000000000000000000n,
    932986871256060603263574n,
    1001724835881546318n,
    904056664383095550n,
  ],
  [
    -41430970,
    -36843520,
    1120910338181752946n,
    1000000n,
    934484255350952965119991n,
    1001729n,
    904058n,
  ],
  [
    9210880,
    13798330,
    1121810267768648385525007n,
    1000000000000000000n,
    932986871256060603067126n,
    1001724835881546317n,
    904056664383095550n,
  ],
  [
    36843520,
    41430970,
    1120910338181752946n,
    1000000n,
    934483764936307894582149n,
    1001728n,
    904058n,
  ],
] as const;
const key = new PoolKey(
  0n,
  256n,
  new PoolConfig(
    BigInt(ZERO_SEED_LAUNCH_ROBINHOOD),
    0n,
    new ConcentratedPoolTypeConfig(17990),
  ),
);

function state(i: number): LaunchState {
  const [lower, upper, liquidity] = cases[i];
  const initial = i < 2 ? lower : upper;
  return {
    sqrtRatio: toSqrtRatio(initial),
    liquidity: i < 2 ? liquidity : 0n,
    activeTick: initial,
    activeTickIndex: i < 2 ? 0 : 1,
    sortedTicks: [
      { number: lower, liquidityDelta: liquidity },
      { number: upper, liquidityDelta: -liquidity },
    ],
    checkedTicksBounds: [lower, upper],
    blockTimestamp: 1000n,
    blockNumber: 42,
    launch: {
      tradingStart: 1000n,
      decayRateX32: 68913100933n,
      initialFee: 922337203685477580n,
      finalFee: 55340232221128654n,
      tickLower: lower,
      tickUpper: upper,
    },
  };
}

describe('final zero-seed launch', () => {
  test.each([0, 1, 2, 3])(
    'sequential exact-input buy, exact-output buy and sell, vector %i',
    i => {
      let s = state(i);
      const [, , , input, bought, paid, sold] = cases[i];
      const launchIs1 = i >= 2;
      expect(quoteZeroSeedLaunch(key, 1n, launchIs1, s).consumedAmount).toBe(
        0n,
      );
      for (const [amount, isToken1, expected] of [
        [input, !launchIs1, bought],
        [-bought, launchIs1, paid],
        [bought, launchIs1, sold],
      ] as const) {
        const before = structuredClone(s);
        const q = quoteZeroSeedLaunch(key, amount, isToken1, s);
        expect(s).toEqual(before);
        expect(q.consumedAmount).toBe(amount);
        expect(q.calculatedAmount).toBe(expected);
        expect(q.feeToken).toBe(isToken1 ? key.token0 : key.token1);
        expect(q.skipAhead).toBe(1);
        s = { ...s, ...q.stateAfter };
      }
    },
  );

  test('fee-curve digests, fractional ticks and saturation match the independent oracle', () => {
    const curves = [
      [
        9223372036854775808n,
        55340232221128654n,
        68913100933n,
        3600,
        1,
        'c3de4d91d476acc61f73455efe7fb8c750b89de3759a0c500bbde0bdf9bcd062',
      ],
      [
        9223372036854775808n,
        55340232221128654n,
        68913100933n,
        2592000,
        60,
        'b2c022f5cbbc90cedca9834bcf64f636b97c45dee08c730ab4dbf17d8d5acc74',
      ],
      [
        922337203685477580n,
        55340232221128654n,
        9923486534471n,
        3600,
        1,
        'c4db35cd45f48222463cb9a940c506599715162db6c37b01428331ff5263bdc6',
      ],
      [
        18428297329635842064n,
        0n,
        8589934592n,
        2592000,
        3600,
        '8fdefff5fe4cfb98c43bbbf6ed6f0b9a0ae398f1f810ffea0522d5504e1321da',
      ],
      [
        18446744073709551615n,
        0n,
        1073741824n,
        3600,
        1,
        '11ff0a905ab22707579e714aba31b895ed3234788a0dab10b0daa0881a9ccf36',
      ],
    ] as const;
    for (const [initial, floor, rate, last, step, expected] of curves) {
      let digest: Buffer = Buffer.alloc(32);
      const feeBytes = Buffer.alloc(8);
      for (let elapsed = 0; elapsed <= last; elapsed += step) {
        feeBytes.writeBigUInt64BE(
          decayedLaunchFee(initial, floor, rate, BigInt(elapsed)),
        );
        digest = createHash('sha256').update(digest).update(feeBytes).digest();
      }
      expect(digest.toString('hex')).toBe(expected);
    }
    const max = (1n << 64n) - 1n;
    expect(decayedLaunchFee(max, 0n, 0n, max)).toBe(max);
    expect(decayedLaunchFee(max, 0n, 1n, (88722836n << 32n) - 1n)).toBe(1n);
    expect(decayedLaunchFee(max, 0n, 1n, 88722836n << 32n)).toBe(0n);
  });

  test.each([0, 1, 2, 3])('boundaries and pinned timestamp, vector %i', i => {
    const s = state(i),
      inputIs1 = i < 2;
    s.blockTimestamp = 999n;
    expect(() => quoteZeroSeedLaunch(key, 1n, inputIs1, s)).toThrow(
      'not started',
    );
    s.blockTimestamp = 1000n;
    s.launch.initialFee = (1n << 64n) - 1n;
    s.launch.finalFee = 0n;
    expect(quoteZeroSeedLaunch(key, 1n, inputIs1, s).calculatedAmount).toBe(0n);
    const q = quoteZeroSeedLaunch(key, 1n << 126n, inputIs1, s);
    expect(q.consumedAmount).toBeLessThan(1n << 126n);
    expect(q.stateAfter.sqrtRatio).toBe(
      toSqrtRatio(inputIs1 ? s.launch.tickUpper : s.launch.tickLower),
    );
    expect(() => quoteZeroSeedLaunch(key, 1n << 127n, inputIs1, s)).toThrow(
      'overflow',
    );
    s.launch.finalFee = 1n << 64n;
    expect(() => quoteZeroSeedLaunch(key, 1n, inputIs1, s)).toThrow('snapshot');
  });

  test('the final ABI is chain/address specific', () => {
    expect(new Interface(ZERO_SEED_LAUNCH_ABI).getSighash('getLaunch')).toBe(
      '0x7d1d589c',
    );
    expect(extensionType(BigInt(ZERO_SEED_LAUNCH_ROBINHOOD), 4663)).toBe(
      ExtensionType.ZeroSeedLaunch,
    );
    expect(extensionType(BigInt(ZERO_SEED_LAUNCH_ROBINHOOD), 1)).toBe(
      ExtensionType.Unknown,
    );
    expect(
      extensionType(0x5100000000000000000000000000000000000000n, 4663),
    ).toBe(ExtensionType.Unknown);
  });
});
