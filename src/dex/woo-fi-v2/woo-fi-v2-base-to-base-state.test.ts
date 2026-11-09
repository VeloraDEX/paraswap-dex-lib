/**
 * WooPPV2._queryBaseToBase sets spread = max(s1, s2) / 2 on *memory* copies of
 * the oracle states. The TS mirror used to write it into this.state, which is
 * the poller's shared cached state, so every base->base quote halved the
 * spreads seen by all later quotes until the next poll — inflating base<->quote
 * prices (Polygon WPOL->USDC quoted up to ~+20 bps above on-chain).
 *
 * Values: real Polygon state at block 97015980; on-chain
 * WooPPV2.query(WPOL, USDC, 1e18) = 89158, query(WPOL, WETH, 1e18) =
 * 42013169245083.
 */
import { WooFiV2Math } from './woo-fi-v2-math';
import { PoolState } from './types';

const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const WPOL = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
const WETH = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';

const dummyLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  log: () => {},
} as any;

const tokenInfo = {
  reserve: 10n ** 30n,
  feeRate: 0n,
  maxGamma: 2n ** 100n,
  maxNotionalSwap: 2n ** 100n,
  capBal: 2n ** 190n,
};

const makeState = (): PoolState => ({
  tokenInfos: {
    [USDC]: { ...tokenInfo },
    [WPOL]: { ...tokenInfo },
    [WETH]: { ...tokenInfo },
  },
  tokenStates: {
    [WPOL]: {
      price: 8931837n,
      spread: 1791925658594537n,
      coeff: 100000000000n,
      woFeasible: true,
    },
    [WETH]: {
      price: 212214521416n,
      spread: 522199003050260n,
      coeff: 3000000000n,
      woFeasible: true,
    },
  },
  decimals: {
    [WPOL]: { priceDec: 10n ** 8n, quoteDec: 10n ** 6n, baseDec: 10n ** 18n },
    [WETH]: { priceDec: 10n ** 8n, quoteDec: 10n ** 6n, baseDec: 10n ** 18n },
  },
  oracleTimestamp: 0n,
  isPaused: false,
});

describe('WooFiV2 base->base query does not mutate shared state', () => {
  const ONE = 10n ** 18n;

  it('matches on-chain quotes on fresh state', () => {
    const math = new WooFiV2Math(dummyLogger, USDC);
    math.state = makeState();

    expect(math.query(WPOL, USDC, [ONE])).toEqual([89158n]);
    expect(math.query(WPOL, WETH, [ONE])).toEqual([42013169245083n]);
  });

  it('keeps base<->quote and base->base quotes stable after base->base queries', () => {
    const math = new WooFiV2Math(dummyLogger, USDC);
    const state = makeState();
    math.state = state;
    const spreadsBefore = {
      [WPOL]: state.tokenStates[WPOL].spread,
      [WETH]: state.tokenStates[WETH].spread,
    };

    const sellBase = math.query(WPOL, USDC, [ONE]);
    const sellQuote = math.query(USDC, WETH, [10n ** 9n]);
    const baseToBase = math.query(WPOL, WETH, [ONE]);

    for (let i = 0; i < 5; i++) {
      math.query(WPOL, WETH, [ONE]);
      math.query(WETH, WPOL, [ONE]);
    }

    expect(state.tokenStates[WPOL].spread).toBe(spreadsBefore[WPOL]);
    expect(state.tokenStates[WETH].spread).toBe(spreadsBefore[WETH]);
    expect(math.query(WPOL, USDC, [ONE])).toEqual(sellBase);
    expect(math.query(USDC, WETH, [10n ** 9n])).toEqual(sellQuote);
    expect(math.query(WPOL, WETH, [ONE])).toEqual(baseToBase);
  });
});
