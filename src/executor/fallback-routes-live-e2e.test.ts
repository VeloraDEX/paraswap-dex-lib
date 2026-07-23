import dotenv from 'dotenv';
dotenv.config();

/**
 * Consumes the manufactured fallback routes from fallback-routes/routes.json
 * (see fallback-routes/generate.ts) and runs each through the REAL pipeline:
 * buildTransaction (skipPreProcess keeps the fabricated reverting quotes) ->
 * Tenderly simulation at the route's pinned block against the deployed
 * fallback-capable executors.
 *
 * Every route's marked primary is a guaranteed on-chain revert, so a
 * successful simulation proves the revertable fallback group filled.
 *
 * Regenerate stale routes: npx ts-node src/executor/fallback-routes/generate.ts
 * Requires .env: HTTP_PROVIDER_42161 + TENDERLY_TOKEN/TENDERLY_ACCOUNT_ID/TENDERLY_PROJECT.
 */
import { OptimalRate } from '@paraswap/core';
import { LocalParaswapSDK } from '../implementations/local-paraswap-sdk';
import { TenderlySimulator, StateOverride } from '../tenderly-simulation';
import { isETHAddress } from '../utils';
import { GeneratedRoutesFile } from './fallback-routes/types';
import * as routesFile from './fallback-routes/routes.json';

jest.setTimeout(600 * 1000);

// Group step metadata marker: [20 zero bytes][size(4)][fromAmtPos(2)=0][destPos(2)][retPos(1)][ff][flag(2)]
const GROUP_STEP_RE = /0{40}[0-9a-f]{8}0000[0-9a-f]{4}[0-9a-f]{2}ff[0-9a-f]{4}/;

const { routes } = routesFile as unknown as GeneratedRoutesFile;

describe('Revertable fallback groups — manufactured routes (Arbitrum)', () => {
  if (!routes.length) {
    it('has generated routes', () => {
      throw new Error(
        'fallback-routes/routes.json is empty — run: npx ts-node src/executor/fallback-routes/generate.ts',
      );
    });
    return;
  }

  it.each(routes.map(r => [r.name, r] as const))('%s', async (_name, route) => {
    const priceRoute = route.priceRoute as OptimalRate;

    // Stateful venues (e.g. FluidDex's pool registry) need pricing initialized
    // on the SAME adapter service the builder uses, or getDexParam has no
    // state. Native is a stateless data-carrier — skip it.
    const venues = new Set<string>();
    priceRoute.bestRoute.forEach(r =>
      r.swaps.forEach(s =>
        s.swapExchanges.forEach(se => {
          venues.add(se.exchange);
          if (se.fallback) venues.add(se.fallback.exchange);
        }),
      ),
    );
    venues.delete('Native');

    const sdk = new LocalParaswapSDK(route.network, [...venues], '');
    sdk.skipPreProcess = true;

    try {
      await sdk.initializePricing?.();
      const userAddress = TenderlySimulator.DEFAULT_OWNER;
      const minMaxAmount =
        (BigInt(priceRoute.destAmount) * (10000n - BigInt(route.slippageBps))) /
        10000n;

      const swapParams = await sdk.buildTransaction(
        priceRoute,
        minMaxAmount,
        userAddress,
      );

      // The calldata must carry a 0xFF group step — unless this scenario
      // documents a builder guard that intentionally skips the group.
      if (route.expectGroup ?? true) {
        expect(swapParams.data!.replace('0x', '')).toMatch(GROUP_STEP_RE);
      } else {
        expect(swapParams.data!.replace('0x', '')).not.toMatch(GROUP_STEP_RE);
      }

      const tenderlySimulator = TenderlySimulator.getInstance();
      const stateOverride: StateOverride = {};
      const amountToFund = BigInt(priceRoute.srcAmount) * 2n;
      if (isETHAddress(priceRoute.srcToken)) {
        tenderlySimulator.addBalanceOverride(
          stateOverride,
          userAddress,
          amountToFund,
        );
      } else {
        await tenderlySimulator.addTokenBalanceOverride(
          stateOverride,
          route.network,
          priceRoute.srcToken,
          userAddress,
          amountToFund,
        );
        await tenderlySimulator.addAllowanceOverride(
          stateOverride,
          route.network,
          priceRoute.srcToken,
          userAddress,
          priceRoute.contractAddress,
          amountToFund,
        );
      }

      const { simulation } = await tenderlySimulator.simulateTransaction({
        chainId: route.network,
        from: swapParams.from!,
        to: swapParams.to!,
        data: swapParams.data!,
        value: swapParams.value ?? '0',
        blockNumber: priceRoute.blockNumber,
        stateOverride,
      });

      console.log(
        `${route.name}: https://dashboard.tenderly.co/simulator/${simulation.id}`,
      );

      // The fabricated primary cannot succeed — success means the fallback
      // filled. For guarded (no-group) scenarios the plain primary must revert.
      expect(simulation.status).toBe(route.expectSuccess ?? true);
    } finally {
      await sdk.releaseResources?.();
    }
  });
});
