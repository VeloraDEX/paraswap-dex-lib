import dotenv from 'dotenv';
dotenv.config();

/**
 * TEMP debug harness: build a stored prod route (megaswap with fallbacks in a
 * split) through the real local pipeline to surface the error staging masks
 * as a 500. Run:
 *   DEBUG_ROUTE_FILE=<path to txopt doc json> npx jest src/executor/debug-stored-route.test.ts --forceExit
 */
import * as fs from 'fs';
import { OptimalRate } from '@paraswap/core';
import { LocalParaswapSDK } from '../implementations/local-paraswap-sdk';

jest.setTimeout(600 * 1000);

const file = process.env.DEBUG_ROUTE_FILE;

(file ? describe : describe.skip)('debug stored route build', () => {
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
});
