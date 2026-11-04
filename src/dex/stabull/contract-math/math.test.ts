import { PoolState } from '../types';
import { quoteSell, quoteViewSell } from './math';

// Fixed BRZ/USDC Base snapshot for repeatable arithmetic checks. Values include
// raw token balances, oracle prices and the pool's stored 64.64 parameters.
const baseBrzUsdc: PoolState = {
  tokens: [
    {
      address: '0xe9185ee218cae427af7b9764a011bb89fea761b4',
      assimilator: '0x8ba5bddc1cd6d1a0c757982b2af3eb6db53903e0',
      proxy: '0x0b0e64c05083fdf9ed7c5d3d8262c4216efc9394',
      aggregator: '0x70f3a88dfd546de52d2cea8733e4decc5d58f5f0',
      decimals: 18,
      oracleDecimals: 8,
      balance: 81042678433308405213086n,
      answer: 19154519n,
      updatedAt: 1770137894n,
    },
    {
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      assimilator: '0x53b105e1d48a76cdb955d037f042c830d14d82ab',
      proxy: '0x7e860098f58bbfc8648a4311b374b1d669a2bc6b',
      aggregator: '0x68be4c50235205ede361ac8244b1ee221cdda5e2',
      decimals: 6,
      oracleDecimals: 8,
      balance: 7408220122n,
      answer: 99973367n,
      updatedAt: 1770137894n,
    },
  ],
  parameters: {
    alpha: 9223372036854775826n,
    beta: 6456360425798343084n,
    delta: 9223372036854775826n,
    epsilon: 2767011611056451n,
    lambda: 18446744073709551634n,
  },
  weights: [9223372036854775826n, 9223372036854775826n],
  frozen: false,
  emergency: false,
  globallyFrozen: false,
};

// Polygon BRZ/USDC snapshot at block 96302301. The USDC input shows the
// separately rounded old-balance calculation used by originSwap.
const polygonBrzUsdc: PoolState = {
  ...baseBrzUsdc,
  tokens: [
    {
      ...baseBrzUsdc.tokens[0],
      address: '0x4ed141110f6eeeaba9a1df36d8c26f684d2475dc',
      assimilator: '0x257f91ee9cdbbe1c0f806ffd947753b3dd5b6b7d',
      proxy: '0xb90da3ff54c3ed09115abf6fba0ff4645586af2c',
      aggregator: '0x96708ee1e2edf130e1a9e5c3550dd2aa37f9a49c',
      balance: 2506730940446466843538n,
      answer: 18724838n,
      updatedAt: 1793113230n,
    },
    {
      ...baseBrzUsdc.tokens[1],
      address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      assimilator: '0x7a7901031a9aab7bb9204de285a75cb7cb7c537b',
      proxy: '0xfe4a8cc5b5b2366c1b58bea3858e81843581b2f7',
      aggregator: '0x51e9881835ad37b1fbbe23620e23aba902c0d266',
      balance: 225955118n,
      answer: 99970414n,
      updatedAt: 1793158807n,
    },
  ],
};

const ONE_64 = 1n << 64n;

describe('Stabull SELL math', () => {
  it('quotes the Base BRZ/USDC snapshot with integer-exact local math', () => {
    expect(quoteSell(baseBrzUsdc, 0, 53866961516229112n)).toBe(10236n);
  });

  it('matches the high-imbalance BRZ/USDC fixture quote', () => {
    expect(quoteSell(baseBrzUsdc, 0, 5255386696151629112933n)).toBe(920970581n);
  });

  it('matches execution and view rounding for Polygon USDC input', () => {
    const amount = 1_000_000n;

    expect(quoteViewSell(polygonBrzUsdc, 1, amount)).toBe(5338203415121688171n);
    expect(quoteSell(polygonBrzUsdc, 1, amount)).toBe(5338203413579937497n);
  });

  it('preserves signed epsilon rounding before taking the output absolute value', () => {
    const state: PoolState = {
      ...baseBrzUsdc,
      tokens: [
        {
          ...baseBrzUsdc.tokens[0],
          decimals: 77,
          oracleDecimals: 0,
          balance: 10n ** 77n,
          answer: 1n,
        },
        {
          ...baseBrzUsdc.tokens[1],
          decimals: 1,
          oracleDecimals: 0,
          balance: 1n,
          answer: 1n,
        },
      ],
      parameters: {
        alpha: ONE_64 / 2n + 18n,
        beta: 0n,
        delta: 0n,
        epsilon: ONE_64 / 100n + 18n,
        lambda: ONE_64 + 18n,
      },
    };

    expect(quoteSell(state, 1, 1n)).toBe(
      9899999999999999989244714448943796014646068215370178222656250000000000000000n,
    );
  });

  it('rejects an amount that pushes the pool past its alpha halt boundary', () => {
    expect(() => quoteSell(baseBrzUsdc, 0, 10n ** 27n)).toThrow(
      /halt|overflow|liquidity/i,
    );
  });

  it('rejects input balance addition that overflows uint256', () => {
    const amount = 10n ** 60n;
    const state: PoolState = {
      ...baseBrzUsdc,
      tokens: [
        {
          ...baseBrzUsdc.tokens[0],
          decimals: 60,
          oracleDecimals: 0,
          balance: (1n << 256n) - 1n - amount + 1n,
          answer: 1n,
        },
        {
          ...baseBrzUsdc.tokens[1],
          decimals: 60,
          oracleDecimals: 0,
          balance: 10n ** 60n,
          answer: 1n,
        },
      ],
    };

    expect(() => quoteSell(state, 0, amount)).toThrow(
      /input balance after transfer overflows uint256/,
    );
  });
});
