import { ScenarioSpec } from './types';

const USDC_10 = (10n * 10n ** 6n).toString();
const USDT_10 = (10n * 10n ** 6n).toString();
const ETH_0_01 = (10n ** 16n).toString();

/**
 * The fallback test matrix. All SELL, Arbitrum, priced on UniswapV3.
 *
 * Executor mapping: 100%-per-hop routes -> Executor01; any split -> Executor02.
 */
export const SCENARIOS: ScenarioSpec[] = [
  {
    name: 'single-hop-fallback',
    description:
      'E01 whole-hop group: single USDC->WETH hop, primary reverts, fallback fills',
    path: ['USDC', 'WETH'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0 }],
  },
  {
    name: 'multihop-fallback-first-hop',
    description:
      'E01 group at sequence START: USDC->WETH->WBTC, hop0 falls back, its output threads to hop1',
    path: ['USDC', 'WETH', 'WBTC'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0 }, {}],
  },
  {
    name: 'multihop-fallback-last-hop',
    description:
      'E01 group at sequence END: USDC->WETH->WBTC, hop1 falls back after a real hop0',
    path: ['USDC', 'WETH', 'WBTC'],
    amount: USDC_10,
    hops: [{}, { fabricatedMemberIndex: 0 }],
  },
  {
    name: 'multihop-fallback-middle-hop',
    description:
      'E01 group in sequence MIDDLE: USDT->USDC->WETH->WBTC, hop1 falls back between real hops',
    path: ['USDT', 'USDC', 'WETH', 'WBTC'],
    amount: USDT_10,
    hops: [{}, { fabricatedMemberIndex: 0 }, {}],
  },
  {
    name: 'single-hop-fallback-curve',
    description:
      'E01 case D (recipient-capable primary + false-recipient fallback): USDC->USDT, the Curve single-pool fallback (dexFuncHasRecipient=false) leaves its output on the executor while the primary would have delivered to Augustus — the group must forward it inside the fallback block. Repro of prod native->curvev1stableng / metric->dodov2 fails.',
    path: ['USDC', 'USDT'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0, fallbackPricingDex: 'CurveV1StableNg' }],
  },
  {
    name: 'split-member-fallback-curve',
    description:
      'E02 counterpart of case D: USDC->USDT split 50/50, member 0 falls back to a Curve single-pool quote (false-recipient); E02 appends its executor->Augustus forward per-branch, so the fallback block must self-deliver.',
    path: ['USDC', 'USDT'],
    amount: USDC_10,
    hops: [
      {
        split: [50, 50],
        fabricatedMemberIndex: 0,
        fallbackPricingDex: 'CurveV1StableNg',
      },
    ],
  },
  {
    name: 'eth-src-wrap-in-try',
    description:
      'E01 wrap rollback: ETH->USDC, primary (needs WETH) wraps inside the try; on revert the wrap rolls back and the fallback re-wraps',
    path: ['ETH', 'USDC'],
    amount: ETH_0_01,
    hops: [{ fabricatedMemberIndex: 0 }],
  },
  {
    name: 'eth-dest-unwrap',
    description:
      'E01 unwrap side: USDC->ETH, primary and fallback both WETH-based (same wrap-ness), unwrap-after machinery',
    path: ['USDC', 'ETH'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0 }],
  },
  {
    name: 'split-member-fallback',
    description:
      'E02 group nested in a path: USDC->WETH split 50/50, member 0 falls back, sibling unaffected',
    path: ['USDC', 'WETH'],
    amount: USDC_10,
    hops: [{ split: [50, 50], fabricatedMemberIndex: 0 }],
  },
  {
    name: 'multihop-split-then-fallback-hop',
    description:
      'E02 WHOLE-HOP group with threading flag: USDC->WETH->WBTC, hop0 split 50/50 (all real), hop1 single fabricated',
    path: ['USDC', 'WETH', 'WBTC'],
    amount: USDC_10,
    hops: [{ split: [50, 50] }, { fabricatedMemberIndex: 0 }],
  },
  {
    name: 'eth-src-split-member-fallback',
    description:
      'E02 input normalization: ETH->USDC split 50/50, member 0 falls back; external wrap persists, fallback gets its approve prepended',
    path: ['ETH', 'USDC'],
    amount: ETH_0_01,
    hops: [{ split: [50, 50], fabricatedMemberIndex: 0 }],
  },
  {
    name: 'multihop-fallback-hop-then-split',
    description:
      'E02 MID-ROUTE whole-hop group threading (flag 11): USDC->WETH->WBTC, hop0 single fabricated (its output must thread on), hop1 split 50/50 all real',
    path: ['USDC', 'WETH', 'WBTC'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0 }, { split: [50, 50] }],
  },
  {
    name: 'split-last-member-fallback',
    description:
      'E02 group as the LAST split member (remainder-path semantics): USDC->WETH split 50/50, member 1 falls back',
    path: ['USDC', 'WETH'],
    amount: USDC_10,
    hops: [{ split: [50, 50], fabricatedMemberIndex: 1 }],
  },
  {
    name: 'eth-dest-split-member-fallback',
    description:
      'E02 ETH-dest split: USDC->ETH split 50/50, member 0 falls back; unwrap-after machinery composes with the group (same wrap-ness)',
    path: ['USDC', 'ETH'],
    amount: USDC_10,
    hops: [{ split: [50, 50], fabricatedMemberIndex: 0 }],
  },
  {
    name: 'multihop-double-fallback',
    description:
      'E01 TWO groups in one route: USDC->WETH->WBTC, both hops fall back sequentially',
    path: ['USDC', 'WETH', 'WBTC'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0 }, { fabricatedMemberIndex: 0 }],
  },
  {
    name: 'split-member-and-hop-double-fallback',
    description:
      'E02 TWO groups in one route: hop0 split 50/50 with member 0 falling back (group in path), hop1 single fabricated (whole-hop group)',
    path: ['USDC', 'WETH', 'WBTC'],
    amount: USDC_10,
    hops: [
      { split: [50, 50], fabricatedMemberIndex: 0 },
      { fabricatedMemberIndex: 0 },
    ],
  },
  {
    name: 'eth-src-raw-eth-fallback',
    description:
      'E01 raw-ETH fallback: ETH->USDC, primary (needs WETH) wraps inside the try; on revert the wrap rolls back and the FluidDex fallback spends raw ETH directly',
    path: ['ETH', 'USDC'],
    amount: ETH_0_01,
    hops: [{ fabricatedMemberIndex: 0, fallbackPricingDex: 'FluidDex' }],
  },
  {
    name: 'eth-src-split-fallback-unwrap-normalization',
    description:
      'E02 input normalization WITHDRAW branch: ETH->USDC split 50/50 (all members need WETH -> root wrap, external), member 0 falls back to raw-ETH FluidDex -> WETH.withdraw(slice) prepended to the fallback block',
    path: ['ETH', 'USDC'],
    amount: ETH_0_01,
    hops: [
      {
        split: [50, 50],
        fabricatedMemberIndex: 0,
        fallbackPricingDex: 'FluidDex',
      },
    ],
  },
  {
    name: 'eth-src-mixed-siblings-wrap-in-try',
    description:
      'E02 branch-local wrap: ETH->USDC split 50/50 with a raw-ETH sibling (FluidDex) -> no root wrap -> member 0 wraps INSIDE its try; on revert the wrap rolls back and the WETH-based fallback re-wraps',
    path: ['ETH', 'USDC'],
    amount: ETH_0_01,
    hops: [
      {
        split: [50, 50],
        fabricatedMemberIndex: 0,
        pricingDexes: [undefined, 'FluidDex'],
      },
    ],
  },
  {
    name: 'eth-dest-mixed-wrapness-e01',
    description:
      'E01 mixed wrap-ness on ETH dest (no guard needed: E01 threads per-branch via raw return): USDC->ETH, primary WETH-based, fallback raw-ETH FluidDex',
    path: ['USDC', 'ETH'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0, fallbackPricingDex: 'FluidDex' }],
  },
  {
    name: 'megaswap-fallback-in-route',
    description:
      'MEGASWAP (bestRoute.length=2, 50/50): routeA = USDC->WETH->WBTC with hop0 falling back mid-route, routeB = same path all real',
    amount: USDC_10,
    routes: [
      {
        percent: 50,
        path: ['USDC', 'WETH', 'WBTC'],
        hops: [{ fabricatedMemberIndex: 0 }, {}],
      },
      { percent: 50, path: ['USDC', 'WETH', 'WBTC'], hops: [{}, {}] },
    ],
  },
  {
    name: 'megaswap-split-member-fallback',
    description:
      'MEGASWAP deepest nesting: routeA hop0 is a 50/50 split whose member 0 falls back (group in path, inside a nested vertical branch), routeB simple real',
    amount: USDC_10,
    routes: [
      {
        percent: 50,
        path: ['USDC', 'WETH', 'WBTC'],
        hops: [{ split: [50, 50], fabricatedMemberIndex: 0 }, {}],
      },
      { percent: 50, path: ['USDC', 'WETH', 'WBTC'], hops: [{}, {}] },
    ],
  },
  {
    name: 'megaswap-whole-route-fallback',
    description:
      'MEGASWAP: routeA is a single fabricated hop (the group IS the whole route content), routeB real multi-hop',
    amount: USDC_10,
    routes: [
      {
        percent: 50,
        path: ['USDC', 'WBTC'],
        hops: [{ fabricatedMemberIndex: 0 }],
      },
      { percent: 50, path: ['USDC', 'WETH', 'WBTC'], hops: [{}, {}] },
    ],
  },
  {
    name: 'eth-dest-split-mixed-wrapness',
    description:
      'E02 OUTPUT normalization (split): USDC->ETH split 50/50, member 0 primary WETH-based with raw-ETH FluidDex fallback -> group encoded; the fallback delivers ETH straight to Augustus (sent-outcome), sibling WETH threads through the usual unwrap machinery',
    path: ['USDC', 'ETH'],
    amount: USDC_10,
    hops: [
      {
        split: [50, 50],
        fabricatedMemberIndex: 0,
        fallbackPricingDex: 'FluidDex',
      },
    ],
  },
  {
    name: 'eth-dest-mixed-wrapness-whole-hop',
    description:
      'E02 OUTPUT normalization (whole-hop, flag 11): USDT->USDC->ETH, hop1 fabricated WETH-based primary with raw-ETH FluidDex fallback -> group threads via WETH balance check; fallback sent-outcome leaves it at 0 and Augustus receives the ETH directly',
    path: ['USDT', 'USDC', 'ETH'],
    amount: USDT_10,
    hops: [{}, { fabricatedMemberIndex: 0, fallbackPricingDex: 'FluidDex' }],
  },
  {
    name: 'mid-route-eth-mixed-wrapness-e01',
    description:
      'E01 MID-ROUTE mixed wrap-ness normalization: USDC->ETH->USDT (100% hops -> E01), hop0 fabricated WETH-based primary with raw-ETH FluidDex fallback, hop1 WETH-consuming UniswapV3 -> the primary threads WETH (no unwrap before a needWrapNative hop), so the fallback block wraps its raw-native output to match',
    path: ['USDC', 'ETH', 'USDT'],
    amount: USDC_10,
    hops: [{ fabricatedMemberIndex: 0, fallbackPricingDex: 'FluidDex' }, {}],
  },
];
