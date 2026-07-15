import dotenv from 'dotenv';
dotenv.config();

/**
 * TEMP debug harness: build a stored prod route (megaswap with fallbacks in a
 * split) through the real local pipeline to surface the error staging masks
 * as a 500. Run:
 *   DEBUG_ROUTE_FILE=<path to txopt doc json> npx jest src/executor/debug-stored-route.test.ts --forceExit
 * With SIMULATE=1 it instead runs testPriceRoute (local build + Tenderly sim
 * at the route's pinned block) — full pre-publish validation. For stored
 * fallback routes the expired/foreign-taker RFQ primary reverts organically,
 * so a passing sim means the revertable group fell back and filled.
 */
import * as fs from 'fs';
import { OptimalRate } from '@paraswap/core';
import { LocalParaswapSDK } from '../implementations/local-paraswap-sdk';
import { TenderlySimulator, StateOverride } from '../tenderly-simulation';
import { isETHAddress } from '../utils';

jest.setTimeout(600 * 1000);

const file = process.env.DEBUG_ROUTE_FILE;

// Route the listed dexes through the remote (api-go) getDexParam like staging
// does — lets us A/B TS vs remote params locally.
function maybeInjectRemote(sdk: LocalParaswapSDK) {
  if (!process.env.REMOTE_DEXS) return;
  const tb = (sdk as any).transactionBuilder;
  tb.newDexsApiUrl =
    process.env.REMOTE_API_URL || 'https://api.staging.paraswap.io/go';
  tb.newDexs = Object.fromEntries(
    process.env.REMOTE_DEXS.split(',').map(k => [k, { needWrapNative: false }]),
  );
}

(file && process.env.SIMULATE === '1' ? describe : describe.skip)(
  'debug stored route build+sim',
  () => {
    it('builds and simulates the stored route', async () => {
      const doc = JSON.parse(fs.readFileSync(file!, 'utf8'));
      const priceRoute = doc.data.priceRoute as OptimalRate;
      const { network, srcToken } = priceRoute;

      const venues = new Set<string>();
      priceRoute.bestRoute.forEach(r =>
        r.swaps.forEach(s =>
          s.swapExchanges.forEach(se => {
            venues.add(se.exchange);
            if ((se as any).fallback) venues.add((se as any).fallback.exchange);
          }),
        ),
      );
      venues.delete('Native');

      const sdk = new LocalParaswapSDK(network, [...venues], '');
      (sdk as any).skipPreProcess = true;
      maybeInjectRemote(sdk);
      await sdk.initializePricing?.();

      const tenderlySimulator = TenderlySimulator.getInstance();
      const userAddress = TenderlySimulator.DEFAULT_OWNER;
      const stateOverride: StateOverride = {};
      const amountToFund = BigInt(priceRoute.srcAmount) * 2n;
      if (isETHAddress(srcToken)) {
        tenderlySimulator.addBalanceOverride(
          stateOverride,
          userAddress,
          amountToFund,
        );
      } else {
        await tenderlySimulator.addTokenBalanceOverride(
          stateOverride,
          network,
          srcToken,
          userAddress,
          amountToFund,
        );
        await tenderlySimulator.addAllowanceOverride(
          stateOverride,
          network,
          srcToken,
          userAddress,
          priceRoute.contractAddress,
          amountToFund,
        );
      }

      // Corrupt the RFQ primary's signature (like the replay campaign) so the
      // group's FALLBACK branch is what actually executes — without this the
      // primary can simply fill at the pinned block and the sim proves nothing
      // about the fallback.
      const tb = (sdk as any).transactionBuilder;
      const swapParams = await tb.build({
        priceRoute,
        minMaxAmount: '1', // non-binding min-out (matches the replay campaign)
        userAddress,
        partnerAddress: '0x0000000000000000000000000000000000000000',
        partnerFeePercent: '0',
        deadline: (Math.floor(Date.now() / 1000) + 10 * 60).toString(),
        uuid: '00000000-0000-4000-8000-000000000000',
        getDexParamOptions:
          process.env.FORCE_REVERT === '0'
            ? undefined
            : { forceRfqRevert: true },
      });

      const { transaction, simulation } =
        await tenderlySimulator.simulateTransaction({
          chainId: network,
          from: swapParams.from!,
          to: swapParams.to!,
          data: swapParams.data!,
          value: swapParams.value ?? '0',
          blockNumber: priceRoute.blockNumber,
          stateOverride,
        });
      // eslint-disable-next-line no-console
      console.log(
        'SIM',
        simulation.status ? 'PASS' : 'REVERT',
        `https://dashboard.tenderly.co/simulator/${simulation.id}`,
      );

      // calls of interest: WETH wrap/unwrap, value-carrying calls, errors
      const WETH_SELECTORS: Record<string, string> = {
        '0x2e1a7d4d': 'WETH.withdraw',
        '0xd0e30db0': 'WETH.deposit',
      };
      const walk = (n: any, d: number) => {
        if (!n) return;
        const sel = (n.input || '').slice(0, 10);
        const val =
          n.value && n.value !== '0x0' && n.value !== '0' ? n.value : null;
        const tag = WETH_SELECTORS[sel];
        if (tag || val || n.error) {
          // eslint-disable-next-line no-console
          console.log(
            `${'  '.repeat(Math.min(d, 12))}${n.call_type || ''} to=${
              n.to
            } sel=${sel}${tag ? ' <' + tag + '>' : ''}${
              val ? ' VALUE=' + BigInt(val).toString() : ''
            }${n.error ? '  ERROR: ' + n.error : ''}`,
          );
        }
        (n.calls || []).forEach((c: any) => walk(c, d + 1));
      };
      const t: any = transaction;
      if (t?.transaction_info?.call_trace) {
        walk(t.transaction_info.call_trace, 0);
      } else if (Array.isArray(t?.call_trace)) {
        // flat trace variant: no nesting, print sequentially
        t.call_trace.forEach((n: any) => walk(n, 1));
      } else {
        // eslint-disable-next-line no-console
        console.log(
          'NO TRACE in response; transaction keys:',
          Object.keys(t || {}).join(','),
        );
      }

      await sdk.releaseResources?.();
      expect(simulation.status).toEqual(true);
    });
  },
);

(file && process.env.SIMULATE !== '1' ? describe : describe.skip)(
  'debug stored route build',
  () => {
    it('builds the stored route', async () => {
      const doc = JSON.parse(fs.readFileSync(file!, 'utf8'));
      const priceRoute = doc.data.priceRoute as OptimalRate;
      const userAddress = doc.data.userAddress;

      const venues = new Set<string>();
      priceRoute.bestRoute.forEach(r =>
        r.swaps.forEach(s =>
          s.swapExchanges.forEach(se => {
            venues.add(se.exchange);
            if ((se as any).fallback) venues.add((se as any).fallback.exchange);
          }),
        ),
      );
      venues.delete('Native');

      const sdk = new LocalParaswapSDK(priceRoute.network, [...venues], '');
      (sdk as any).skipPreProcess = true;

      // REMOTE_DEXS=key[,key]: route those dexes through the remote (api-go)
      // getDexParam like staging does, to reproduce remote-path build errors.
      if (process.env.REMOTE_DEXS) {
        const tb = (sdk as any).transactionBuilder;
        tb.newDexsApiUrl =
          process.env.REMOTE_API_URL || 'https://api.staging.paraswap.io/go';
        tb.newDexs = Object.fromEntries(
          process.env.REMOTE_DEXS.split(',').map(k => [
            k,
            { needWrapNative: false },
          ]),
        );
      }

      try {
        await sdk.initializePricing?.();
        const swapParams = await sdk.buildTransaction(
          priceRoute,
          1n, // non-binding min-out
          userAddress,
        );
        // eslint-disable-next-line no-console
        console.log(
          'BUILD OK, data length:',
          (swapParams.data || '').length,
          'to:',
          swapParams.to,
        );
      } finally {
        await sdk.releaseResources?.();
      }
    });
  },
);
