import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { WstGBP } from './wstgbp';
import { WstGBPConfig } from './config';
import { PoolState } from './types';

/**
 * Pure-math regressions with a synthetic PoolState (no network calls — `compute`/`convert` never
 * touch the RPC). The live integration suite cannot drive the wrapper's capacity or NAV, so the
 * capacity-boundary and dust-floor edges are pinned here instead.
 */
describe('WstGBP math', () => {
  const dexKey = 'wstGBP';
  const network = Network.MAINNET;
  const WAD = 10n ** 18n;

  const dexHelper = new DummyDexHelper(network);
  const wstGBP = new WstGBP(network, dexKey, dexHelper) as any;

  const baseState = (over: Partial<PoolState>): PoolState => ({
    mintcost: 1001300000000000000n, // ~1.0013 tGBP per wstGBP (at-par-ish live shape)
    burncost: 998800000000000000n,
    capacity: 10n ** 24n,
    totalSupply: 0n,
    tGBPReserve: 10n ** 24n,
    mintable: true,
    burnable: true,
    cooldown: 0n,
    ...over,
  });

  describe('exact-output buy capacity boundary (minted >= requested)', () => {
    // Sub-par NAV maximizes the over-mint: mintcost = 0.5 => requesting an odd-wei output rounds
    // the input up by half a wei of tGBP, which mints one extra wei of wstGBP. The request is far
    // above the wrapper's mint dust floor (tGBPIn >= mintcost), so capacity is the only gate.
    const mintcost = 500000000000000000n;
    const amountOut = 3n * WAD + 1n;
    const tGBPIn = (3n * WAD) / 2n + 1n; // ceil((3e18+1) * 0.5)
    const minted = (tGBPIn * WAD) / mintcost; // 3e18 + 2 — one wei MORE than requested
    const state = baseState({
      mintcost,
      capacity: amountOut, // headroom == the requested output exactly
      totalSupply: 0n,
    });

    it('quotes unfillable when headroom equals the requested output but the mint would overflow it', () => {
      // headroom == 3 == amountOut, but mint(2) mints 4 > 3 => on-chain mint reverts on capacity.
      expect(wstGBP.compute(true, SwapSide.BUY, amountOut, state)).toEqual(0n);
    });

    it('quotes fillable when headroom covers the minted amount', () => {
      const roomy = { ...state, capacity: minted };
      expect(wstGBP.compute(true, SwapSide.BUY, amountOut, roomy)).toEqual(
        tGBPIn,
      );
    });

    it('at-par: fillable at headroom == minted, unfillable one wei below', () => {
      const st = baseState({});
      const amount = 5n * WAD;
      const inAmt = wstGBP.convert(true, SwapSide.BUY, amount, st) as bigint;
      const minted5 = (inAmt * WAD) / st.mintcost;
      expect(minted5).toBeGreaterThanOrEqual(amount);

      const exact = { ...st, capacity: st.totalSupply + minted5 };
      expect(wstGBP.compute(true, SwapSide.BUY, amount, exact)).toEqual(inAmt);

      const short = { ...st, capacity: st.totalSupply + minted5 - 1n };
      expect(wstGBP.compute(true, SwapSide.BUY, amount, short)).toEqual(0n);
    });
  });

  describe('buy exact-in headroom boundary', () => {
    const state = baseState({});
    const amountIn = 5n * WAD;
    const out = wstGBP.convert(true, SwapSide.SELL, amountIn, state) as bigint;

    it('fillable when headroom equals the minted output, unfillable one wei below', () => {
      const exact = { ...state, capacity: state.totalSupply + out };
      expect(wstGBP.compute(true, SwapSide.SELL, amountIn, exact)).toEqual(out);

      const short = { ...state, capacity: state.totalSupply + out - 1n };
      expect(wstGBP.compute(true, SwapSide.SELL, amountIn, short)).toEqual(0n);
    });
  });

  describe('sell reserve boundary (the wrapper must fund the full claim)', () => {
    it('exact-in: fillable when the reserve equals the claim, unfillable one wei below', () => {
      const state = baseState({});
      const amountIn = 5n * WAD;
      const claim = (amountIn * state.burncost) / WAD;

      const exact = { ...state, tGBPReserve: claim };
      expect(wstGBP.compute(false, SwapSide.SELL, amountIn, exact)).toEqual(
        claim,
      );

      const short = { ...state, tGBPReserve: claim - 1n };
      expect(wstGBP.compute(false, SwapSide.SELL, amountIn, short)).toEqual(0n);
    });

    it('exact-out: the reserve must cover the claim, which exceeds the requested output (input rounds up)', () => {
      // burncost > WAD (a premium bid — the live shape today) makes each rounded-up wei of wstGBP
      // input worth > 1 wei of tGBP, so the wrapper's payout (the claim) overshoots the request.
      const state = baseState({ burncost: 2n * WAD });
      // Odd request => the wstGBP input rounds up by half a wei-equivalent; large enough to clear
      // the redeem dust floor (needs >= 1e18 wstGBP in at this price).
      const amountOut = 3n * WAD + 1n;
      const wstGBPIn = wstGBP.convert(false, SwapSide.BUY, amountOut, state);
      const claim = (wstGBPIn * state.burncost) / WAD;
      expect(claim).toBeGreaterThan(amountOut);

      const exact = { ...state, tGBPReserve: claim };
      expect(wstGBP.compute(false, SwapSide.BUY, amountOut, exact)).toEqual(
        wstGBPIn,
      );

      // Reserve covers the requested output but not the claim => on-chain redeem underpays => 0.
      const short = { ...state, tGBPReserve: claim - 1n };
      expect(wstGBP.compute(false, SwapSide.BUY, amountOut, short)).toEqual(0n);
    });
  });

  describe('dust floors', () => {
    const state = baseState({});

    it('sell exact-in: redeem needs >= 1e18 wstGBP in', () => {
      expect(wstGBP.compute(false, SwapSide.SELL, WAD - 1n, state)).toEqual(0n);
      expect(wstGBP.compute(false, SwapSide.SELL, WAD, state)).toEqual(
        state.burncost,
      );
    });

    it('sell exact-out: unfillable when the required wstGBP input is below 1e18', () => {
      // amountOut = burncost - 1 needs ceil((burncost-1)/burncost * 1e18) = 1e18 - 1 wstGBP in.
      expect(
        wstGBP.compute(false, SwapSide.BUY, state.burncost - 1n, state),
      ).toEqual(0n);
      // amountOut = burncost needs exactly 1e18 in — right at the floor.
      expect(
        wstGBP.compute(false, SwapSide.BUY, state.burncost, state),
      ).toEqual(WAD);
    });

    it('buy exact-out: unfillable when the required tGBP input is below mintcost', () => {
      // amountOut = 1e18 - 1 needs mintcost - 1 tGBP in — one wei under the mint dust floor.
      expect(wstGBP.compute(true, SwapSide.BUY, WAD - 1n, state)).toEqual(0n);
      // amountOut = 1e18 needs exactly mintcost in — right at the floor.
      expect(wstGBP.compute(true, SwapSide.BUY, WAD, state)).toEqual(
        state.mintcost,
      );
    });
  });

  describe('availability gates in getPricesVolume', () => {
    const { tGBPAddress, wstGBPAddress } = WstGBPConfig[dexKey][network];
    const tGBP = { address: tGBPAddress, decimals: 18 };
    const wstGBPToken = { address: wstGBPAddress, decimals: 18 };
    const amounts = [0n, 5n * WAD];

    const withState = (over: Partial<PoolState>) => {
      const dex = new WstGBP(network, dexKey, dexHelper) as any;
      dex.getState = async () => ({ blockNumber: 1, ...baseState(over) });
      return dex;
    };

    const buyPrices = (dex: any) =>
      dex.getPricesVolume(tGBP, wstGBPToken, amounts, SwapSide.SELL, 1);
    const sellPrices = (dex: any) =>
      dex.getPricesVolume(wstGBPToken, tGBP, amounts, SwapSide.SELL, 1);

    it('prices both directions when fully live', async () => {
      const dex = withState({});
      await expect(buyPrices(dex)).resolves.not.toBeNull();
      await expect(sellPrices(dex)).resolves.not.toBeNull();
    });

    it('mintable=false kills buys only', async () => {
      const dex = withState({ mintable: false });
      await expect(buyPrices(dex)).resolves.toBeNull();
      await expect(sellPrices(dex)).resolves.not.toBeNull();
    });

    it('burnable=false kills sells only', async () => {
      const dex = withState({ burnable: false });
      await expect(sellPrices(dex)).resolves.toBeNull();
      await expect(buyPrices(dex)).resolves.not.toBeNull();
    });

    it('non-zero redemption cooldown kills sells only (payout would be deferred)', async () => {
      const dex = withState({ cooldown: 3600n });
      await expect(sellPrices(dex)).resolves.toBeNull();
      await expect(buyPrices(dex)).resolves.not.toBeNull();
    });

    it('paused oracle (mintcost=0, burncost=0) kills both directions', async () => {
      const dex = withState({ mintcost: 0n, burncost: 0n });
      await expect(buyPrices(dex)).resolves.toBeNull();
      await expect(sellPrices(dex)).resolves.toBeNull();
    });

    it('burncost=0 alone (100% exit fee at a live NAV) kills sells only', async () => {
      const dex = withState({ burncost: 0n });
      await expect(sellPrices(dex)).resolves.toBeNull();
      await expect(buyPrices(dex)).resolves.not.toBeNull();
    });
  });

  describe('unit is the ungated marginal rate', () => {
    const state = baseState({});

    it('buy exact-in unit is non-zero even though 1e18 tGBP is below the mint dust floor', () => {
      expect(state.mintcost).toBeGreaterThan(WAD); // the 1e18 probe IS below the dust floor
      expect(wstGBP.compute(true, SwapSide.SELL, WAD, state)).toEqual(0n); // gated: unfillable
      expect(wstGBP.convert(true, SwapSide.SELL, WAD, state)).toEqual(
        (WAD * WAD) / state.mintcost, // ungated unit: the true marginal rate
      );
    });

    it('all four units equal their pure oracle-price conversions', () => {
      expect(wstGBP.convert(true, SwapSide.SELL, WAD, state)).toEqual(
        (WAD * WAD) / state.mintcost,
      );
      expect(wstGBP.convert(true, SwapSide.BUY, WAD, state)).toEqual(
        state.mintcost,
      );
      expect(wstGBP.convert(false, SwapSide.SELL, WAD, state)).toEqual(
        state.burncost,
      );
      expect(wstGBP.convert(false, SwapSide.BUY, WAD, state)).toEqual(
        (WAD * WAD + state.burncost - 1n) / state.burncost,
      );
    });
  });
});
