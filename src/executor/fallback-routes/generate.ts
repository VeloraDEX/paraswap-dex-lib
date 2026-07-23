/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

/**
 * Fallback test-route generator.
 *
 * For each scenario in ./scenarios.ts: price every hop (and split slice) live
 * on Arbitrum via LocalParaswapSDK, assemble a multi-hop OptimalRate, and
 * replace the marked member with a fabricated always-reverting `Native` quote
 * whose revertable fallback is the real priced quote. Writes ./routes.json,
 * consumed by src/executor/fallback-routes-live-e2e.test.ts.
 *
 * Run:  GENERATE_FALLBACK_ROUTES=1 npx jest src/executor/fallback-routes/generate-routes.test.ts --forceExit
 * Requires .env: HTTP_PROVIDER_42161.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Interface } from '@ethersproject/abi';
import {
  OptimalRate,
  OptimalSwap,
  OptimalSwapExchange,
  ParaSwapVersion,
} from '@paraswap/core';
import { LocalParaswapSDK } from '../../implementations/local-paraswap-sdk';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { Token } from '../../types';
import { isETHAddress } from '../../utils';

import { SCENARIOS } from './scenarios';
import {
  GeneratedRoute,
  GeneratedRoutesFile,
  HopSpec,
  RouteSpec,
  ScenarioSpec,
} from './types';

const NETWORK = Network.ARBITRUM;
const PRICING_DEX = 'UniswapV3';
const AUGUSTUS_V6 = '0x6a000f20005980200259b80c5102003040001068';
const WETH_ARBITRUM = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';

// Local token map (generate.ts is compiled as source, so it cannot import
// tests/constants-e2e which lives outside the tsconfig rootDir).
const TOKENS: Record<string, Token> = {
  ETH: {
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    decimals: 18,
  },
  WETH: { address: WETH_ARBITRUM, decimals: 18 },
  USDC: {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
  },
  USDT: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    decimals: 6,
  },
  WBTC: {
    address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    decimals: 8,
  },
};

const erc20 = new Interface(['function transferFrom(address,address,uint256)']);

// A quote whose calldata always reverts on-chain: transferFrom with no allowance.
function fabricatedRevertingQuote(hopSrcToken: string, amount: bigint) {
  return {
    quote: {
      txRequest: {
        // eee has no code — use WETH as the reverting ERC20 target for ETH hops
        target: isETHAddress(hopSrcToken) ? WETH_ARBITRUM : hopSrcToken,
        calldata: erc20.encodeFunctionData('transferFrom', [
          '0x000000000000000000000000000000000000dEaD',
          '0x000000000000000000000000000000000000bEEF',
          amount,
        ]),
        value: '0',
      },
    },
  };
}

// One SDK (with initialized pricing) per venue, created lazily.
class SdkRegistry {
  private sdks: Record<string, LocalParaswapSDK> = {};

  async get(dexKey: string): Promise<LocalParaswapSDK> {
    if (!this.sdks[dexKey]) {
      const sdk = new LocalParaswapSDK(NETWORK, [dexKey], '');
      await sdk.initializePricing?.();
      this.sdks[dexKey] = sdk;
    }
    return this.sdks[dexKey];
  }

  async release(): Promise<void> {
    for (const sdk of Object.values(this.sdks)) {
      await sdk.releaseResources?.();
    }
  }
}

// Build the swaps (hops) of one route, pricing every slice live. Returns the
// route's swaps, its output amount and the latest pricing block.
async function buildRouteSwaps(
  sdks: SdkRegistry,
  scenarioName: string,
  path: string[],
  hops: HopSpec[],
  routeAmount: bigint,
): Promise<{ swaps: OptimalSwap[]; out: bigint; blockNumber: number }> {
  const tokens = TOKENS;
  if (hops.length !== path.length - 1) {
    throw new Error(`${scenarioName}: hops must match path segments`);
  }

  let runningAmount = routeAmount;
  let blockNumber = 0;
  const swaps: OptimalSwap[] = [];

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    const from = tokens[path[i]];
    const to = tokens[path[i + 1]];
    const split = hop.split ?? [100];
    if (split.reduce((a, b) => a + b, 0) !== 100) {
      throw new Error(`${scenarioName}: hop ${i} split must sum to 100`);
    }

    // Slice amounts; last slice takes the remainder to preserve the total.
    const slices = split.map(p => (runningAmount * BigInt(p)) / 100n);
    slices[slices.length - 1] =
      runningAmount - slices.slice(0, -1).reduce((a, b) => a + b, 0n);

    const members: OptimalSwapExchange<any>[] = [];
    let hopDestTotal = 0n;

    const priceSlice = async (dexKey: string, amount: bigint) => {
      const sdk = await sdks.get(dexKey);
      // Some venues (e.g. FluidDex's liquidity-proxy state) warm up async
      // after initializePricing — retry once before giving up.
      let priced;
      for (let attempt = 0; ; attempt++) {
        try {
          priced = await sdk.getPrices(
            from,
            to,
            amount,
            SwapSide.SELL,
            ContractMethod.swapExactAmountIn,
          );
          break;
        } catch (e) {
          if (attempt >= 1) throw e;
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      blockNumber = priced.blockNumber;
      return priced.bestRoute[0].swaps[0].swapExchanges[0];
    };

    for (let j = 0; j < slices.length; j++) {
      const memberDex = hop.pricingDexes?.[j] ?? PRICING_DEX;
      const realSe = await priceSlice(memberDex, slices[j]);
      const member: OptimalSwapExchange<any> = {
        ...realSe,
        srcAmount: slices[j].toString(),
        percent: split[j],
      };

      if (hop.fabricatedMemberIndex === j) {
        // The fallback may be priced on a different venue (e.g. a raw-ETH one).
        const fallbackSe = hop.fallbackPricingDex
          ? {
              ...(await priceSlice(hop.fallbackPricingDex, slices[j])),
              srcAmount: slices[j].toString(),
              percent: split[j],
            }
          : member;
        hopDestTotal += BigInt(fallbackSe.destAmount);
        members.push({
          exchange: 'Native',
          srcAmount: member.srcAmount,
          destAmount: fallbackSe.destAmount,
          percent: split[j],
          data: fabricatedRevertingQuote(from.address, slices[j]),
          fallback: fallbackSe, // the real quote is the revertable fallback
        });
      } else {
        hopDestTotal += BigInt(realSe.destAmount);
        members.push(member);
      }
    }

    swaps.push({
      srcToken: from.address,
      srcDecimals: from.decimals,
      destToken: to.address,
      destDecimals: to.decimals,
      swapExchanges: members,
    });
    runningAmount = hopDestTotal;
  }

  return { swaps, out: runningAmount, blockNumber };
}

async function generateScenario(
  sdks: SdkRegistry,
  spec: ScenarioSpec,
): Promise<GeneratedRoute> {
  const tokens = TOKENS;
  const routeSpecs: RouteSpec[] = spec.routes ?? [
    { percent: 100, path: spec.path!, hops: spec.hops! },
  ];
  if (routeSpecs.reduce((a, r) => a + r.percent, 0) !== 100) {
    throw new Error(`${spec.name}: route percents must sum to 100`);
  }
  const srcSym = routeSpecs[0].path[0];
  const destSym = routeSpecs[0].path[routeSpecs[0].path.length - 1];
  if (
    !routeSpecs.every(
      r => r.path[0] === srcSym && r.path[r.path.length - 1] === destSym,
    )
  ) {
    throw new Error(`${spec.name}: all routes must share src and dest tokens`);
  }

  // Split the src amount across routes; last route takes the remainder.
  const total = BigInt(spec.amount);
  const routeAmounts = routeSpecs.map(r => (total * BigInt(r.percent)) / 100n);
  routeAmounts[routeAmounts.length - 1] =
    total - routeAmounts.slice(0, -1).reduce((a, b) => a + b, 0n);

  let blockNumber = 0;
  let destAmount = 0n;
  const bestRoute = [];
  for (let i = 0; i < routeSpecs.length; i++) {
    const r = routeSpecs[i];
    const built = await buildRouteSwaps(
      sdks,
      spec.name,
      r.path,
      r.hops,
      routeAmounts[i],
    );
    blockNumber = built.blockNumber;
    destAmount += built.out;
    bestRoute.push({ percent: r.percent, swaps: built.swaps });
  }

  const src = tokens[srcSym];
  const dest = tokens[destSym];
  const priceRoute = {
    blockNumber,
    network: NETWORK,
    srcToken: src.address,
    srcDecimals: src.decimals,
    srcAmount: spec.amount,
    destToken: dest.address,
    destDecimals: dest.decimals,
    destAmount: destAmount.toString(),
    bestRoute,
    gasCostUSD: '0',
    gasCost: '0',
    others: [],
    side: SwapSide.SELL,
    contractAddress: AUGUSTUS_V6,
    tokenTransferProxy: '',
    version: ParaSwapVersion.V6,
    contractMethod: ContractMethod.swapExactAmountIn,
    partner: 'test',
    maxImpactReached: false,
    hmac: '0',
    srcUSD: '0',
    destUSD: '0',
  } as unknown as OptimalRate;

  return {
    name: spec.name,
    description: spec.description,
    network: NETWORK,
    generatedAt: new Date().toISOString(),
    slippageBps: spec.slippageBps ?? 300,
    expectGroup: spec.expectGroup ?? true,
    expectSuccess: spec.expectSuccess ?? true,
    priceRoute,
  };
}

export async function generateAllRoutes(): Promise<{
  routes: GeneratedRoute[];
  failures: string[];
}> {
  const sdks = new SdkRegistry();

  const routes: GeneratedRoute[] = [];
  const failures: string[] = [];
  // ONLY_SCENARIO=name[,name...] regenerates just those scenarios and merges
  // them into the existing routes.json (replace-by-name), instead of
  // re-pricing the whole matrix.
  const only = process.env.ONLY_SCENARIO
    ? new Set(process.env.ONLY_SCENARIO.split(',').map(s => s.trim()))
    : undefined;
  const specs = only ? SCENARIOS.filter(s => only.has(s.name)) : SCENARIOS;
  try {
    for (const spec of specs) {
      try {
        console.log(`generating: ${spec.name} ...`);
        routes.push(await generateScenario(sdks, spec));
      } catch (e) {
        console.error(`FAILED: ${spec.name}:`, e);
        failures.push(spec.name);
      }
    }
  } finally {
    await sdks.release();
  }

  let finalRoutes = routes;
  if (only) {
    let existing: GeneratedRoute[] = [];
    try {
      existing = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'),
      ).routes;
    } catch {
      existing = [];
    }
    const byName = new Map(existing.map(r => [r.name, r]));
    for (const r of routes) byName.set(r.name, r);
    finalRoutes = [...byName.values()];
  }

  const out: GeneratedRoutesFile = {
    _readme:
      'GENERATED by src/executor/fallback-routes/generate.ts — do not edit by hand. ' +
      'Manufactured fallback test routes: each marked member is a Native swapExchange ' +
      'with an always-reverting quote whose `fallback` is a real quote priced at the ' +
      'pinned blockNumber. Regenerate when routes go stale: ' +
      'GENERATE_FALLBACK_ROUTES=1 npx jest src/executor/fallback-routes/generate-routes.test.ts --forceExit',
    routes: finalRoutes,
  };
  const outPath = path.join(__dirname, 'routes.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `\nwrote ${routes.length}/${specs.length} generated (${finalRoutes.length} total) to ${outPath}` +
      (failures.length ? `\nfailed: ${failures.join(', ')}` : ''),
  );
  return { routes, failures };
}
