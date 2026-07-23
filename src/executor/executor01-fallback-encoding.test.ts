import dotenv from 'dotenv';
dotenv.config();

import { Executor01BytecodeBuilder } from './Executor01BytecodeBuilder';
import { Network, NULL_ADDRESS } from '../constants';
import { DummyDexHelper } from '../dex-helper';

import { OptimalRate } from '@paraswap/core';
import { DexExchangeBuildParam } from '../types';

import priceRoute from './fixtures/executor01/routes/price-route-simpleSwap-univ3-usdc-usdt.json';
import exchangeParams from './fixtures/executor01/exchange-params/price-route-simpleSwap-univ3-usdc-usdt.json';

// Strip the outer [offset(32)][length(32)] wrapper that buildByteCode prepends,
// leaving just the swaps calldata (the concatenated steps).
const innerSteps = (bytecode: string): string => bytecode.slice(2 + 64 + 64);
const byteLen = (hexNoPrefix: string): number => hexNoPrefix.length / 2;

describe('Executor01BytecodeBuilder revertable fallback group (Style 2)', () => {
  let builder: Executor01BytecodeBuilder;

  beforeEach(() => {
    builder = new Executor01BytecodeBuilder(
      new DummyDexHelper(Network.MAINNET),
    );
  });

  const primary = exchangeParams as unknown as DexExchangeBuildParam[];
  // A distinct fallback alternative for the same hop (different target address
  // so its encoded block differs from the primary's).
  const fallback = [
    {
      ...primary[0],
      targetExchange: '0x1111111111111111111111111111111111111111',
    },
  ] as unknown as DexExchangeBuildParam[];

  it('encodes the group as a 0xFF special-dex step carrying both sub-blocks', () => {
    const route = priceRoute as unknown as OptimalRate;

    const tryBlock = innerSteps(
      builder.buildByteCode(route, primary, NULL_ADDRESS, undefined),
    );
    const fallbackBlock = innerSteps(
      builder.buildByteCode(route, fallback, NULL_ADDRESS, undefined),
    );

    const grouped = builder.buildByteCode(
      route,
      [
        { ...primary[0], fallbackParam: fallback[0] },
      ] as unknown as DexExchangeBuildParam[],
      NULL_ADDRESS,
      undefined,
    );
    const step = innerSteps(grouped);

    // The group differs from the plain primary-only encoding.
    expect(grouped).not.toEqual(
      builder.buildByteCode(route, primary, NULL_ADDRESS, undefined),
    );

    // --- metadata word (EXECUTOR_01_02 layout) ---
    // [addr(20)][size(4)][fromAmtPos(2)][srcTokPos(2)][retPos(1)][specialDex(1)][flag(2)][zeros(28)][payload]
    const addr = step.slice(0, 40);
    const sizeHex = step.slice(40, 48);
    const specialDex = step.slice(58, 60);

    expect(addr).toBe('0'.repeat(40)); // target unused for a group
    expect(specialDex).toBe('ff'); // REVERTABLE_FALLBACK_GROUP

    // --- payload: [28-byte padding][tryLen(4)][fallbackLen(4)][tryBlock][fallbackBlock] ---
    const PADDING = 28 * 2; // hex chars
    const payload = step.slice(64 /* metadata word */ + PADDING);

    const tryLen = parseInt(payload.slice(0, 8), 16);
    const fallbackLen = parseInt(payload.slice(8, 16), 16);
    const blocks = payload.slice(16);

    expect(tryLen).toBe(byteLen(tryBlock));
    expect(fallbackLen).toBe(byteLen(fallbackBlock));
    expect(blocks.slice(0, tryBlock.length)).toBe(tryBlock);
    expect(blocks.slice(tryBlock.length)).toBe(fallbackBlock);

    // calldataSize in the metadata word = payload bytes + 28 (standard packing).
    expect(parseInt(sizeHex, 16)).toBe(byteLen(payload) + 28);
  });
});

describe('Executor01 revertable group: ETH-dest mixed wrap-ness normalization', () => {
  let builder: Executor01BytecodeBuilder;

  beforeEach(() => {
    builder = new Executor01BytecodeBuilder(
      new DummyDexHelper(Network.MAINNET),
    );
  });

  const ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  const SRC_AMOUNT = '1000000000';
  const DEST_AMOUNT = '500000000000000000';

  const pad32 = (n: string): string => BigInt(n).toString(16).padStart(64, '0');

  // Raw-native RFQ-style primary: delivers native straight to its recipient.
  const rawPrimary = {
    needWrapNative: false,
    dexFuncHasRecipient: true,
    exchangeData: '0xdeadbeef' + pad32(SRC_AMOUNT),
    insertFromAmountPos: 4,
    targetExchange: '0x2222222222222222222222222222222222222222',
  };

  // WETH-based AMM fallback for the same hop.
  const wethFallback = {
    needWrapNative: true,
    dexFuncHasRecipient: true,
    exchangeData: '0xfeedc0de' + pad32(SRC_AMOUNT),
    insertFromAmountPos: 4,
    targetExchange: '0x1111111111111111111111111111111111111111',
  };

  const maybeWethCallData = {
    withdraw: {
      callee: WETH,
      calldata: '0x2e1a7d4d' + pad32(DEST_AMOUNT),
      value: '0',
    },
  };

  const makeSwap = (srcToken: string, destToken: string) => ({
    srcToken,
    destToken,
    swapExchanges: [
      {
        exchange: 'Dexalot',
        srcAmount: SRC_AMOUNT,
        destAmount: DEST_AMOUNT,
        percent: 100,
      },
    ],
  });

  const makeRoute = (swaps: object[]): OptimalRate =>
    ({
      network: 1,
      side: 'SELL',
      srcToken: (swaps[0] as any).srcToken,
      destToken: (swaps[swaps.length - 1] as any).destToken,
      srcAmount: SRC_AMOUNT,
      destAmount: DEST_AMOUNT,
      bestRoute: [{ percent: 100, swaps }],
      contractMethod: 'swapExactAmountIn',
    } as unknown as OptimalRate);

  // Group metadata word: zero target(20) + size(4) + zero positions(5) + 0xff + zero flag(2).
  const GROUP_STEP_MARKER = /0{40}[0-9a-f]{8}0{10}ff0000/;

  it('normalizes the final hop: group encoded, fallback block ends with the native send, route-level send suppressed', () => {
    const route = makeRoute([makeSwap(USDT, ETH)]);
    const finalFlag = (builder as any).buildFinalSpecialFlagCalldata();
    const finalFlagHex = finalFlag.slice(2);

    // Plain builds of each alternative as its own route: [unit][route-level send].
    const plainPrimary = innerSteps(
      builder.buildByteCode(
        route,
        [rawPrimary] as unknown as DexExchangeBuildParam[],
        NULL_ADDRESS,
        maybeWethCallData as any,
      ),
    );
    const plainFallback = innerSteps(
      builder.buildByteCode(
        route,
        [wethFallback] as unknown as DexExchangeBuildParam[],
        NULL_ADDRESS,
        maybeWethCallData as any,
      ),
    );
    expect(plainPrimary.endsWith(finalFlagHex)).toBe(true);
    expect(plainFallback.endsWith(finalFlagHex)).toBe(true);

    const grouped = innerSteps(
      builder.buildByteCode(
        route,
        [
          { ...rawPrimary, fallbackParam: wethFallback },
        ] as unknown as DexExchangeBuildParam[],
        NULL_ADDRESS,
        maybeWethCallData as any,
      ),
    );

    // The group is encoded (guard no longer drops it on the final hop).
    expect(grouped).toMatch(GROUP_STEP_MARKER);

    // Parse the payload: [meta word][28-byte padding][tryLen][fallbackLen][try][fallback].
    const payload = grouped.slice(64 + 28 * 2);
    const tryLen = parseInt(payload.slice(0, 8), 16) * 2;
    const fallbackLen = parseInt(payload.slice(8, 16), 16) * 2;
    const tryBlock = payload.slice(16, 16 + tryLen);
    const fallbackBlock = payload.slice(16 + tryLen, 16 + tryLen + fallbackLen);

    // Nothing after the group step — the route-level native send is suppressed
    // (the fallback block carries its own; the try branch delivered itself).
    expect(grouped.length).toBe(64 + 28 * 2 + 16 + tryLen + fallbackLen);

    // The try block is the primary's unit, byte-identical to a plain build
    // (minus the route-level send, which a plain build appends after it).
    expect(tryBlock).toBe(
      plainPrimary.slice(0, plainPrimary.length - finalFlagHex.length),
    );

    // The fallback block is exactly what a standalone route through the
    // fallback would encode: its unit (dex call + unwrap) + the native send.
    expect(fallbackBlock).toBe(plainFallback);
    expect(fallbackBlock.endsWith(finalFlagHex)).toBe(true);
    // The unwrap rides inside the block (WETH.withdraw selector).
    expect(fallbackBlock).toContain('2e1a7d4d');
  });

  it('normalizes the final hop of a multihop route the same way', () => {
    const route = makeRoute([makeSwap(USDC, USDT), makeSwap(USDT, ETH)]);
    const hop1 = {
      needWrapNative: false,
      dexFuncHasRecipient: false,
      exchangeData: '0xcafebabe' + pad32(SRC_AMOUNT),
      insertFromAmountPos: 4,
      targetExchange: '0x3333333333333333333333333333333333333333',
    };

    const grouped = innerSteps(
      builder.buildByteCode(
        route,
        [
          hop1,
          { ...rawPrimary, fallbackParam: wethFallback },
        ] as unknown as DexExchangeBuildParam[],
        NULL_ADDRESS,
        maybeWethCallData as any,
      ),
    );

    // The group is encoded and is the LAST step — no route-level native send
    // after it (grouped calldata ends exactly where the group step ends).
    const match = grouped.match(GROUP_STEP_MARKER);
    expect(match).not.toBeNull();
    const sizeBytes = parseInt(
      grouped.slice(match!.index! + 40, match!.index! + 48),
      16,
    );
    // step hex length = metadata word (64) + 28-byte padding (56) + payload
    // (sizeBytes - 28 bytes).
    expect(grouped.length).toBe(match!.index! + 64 + 56 + (sizeBytes - 28) * 2);
  });

  // --- MID-ROUTE ETH-dest mixed wrap-ness: the fallback block must end in the
  // same token form the primary threads to the next hop. ---

  const WITHDRAW_SEL = '2e1a7d4d';
  const DEPOSIT_SEL = 'd0e30db0';
  const count = (haystack: string, needle: string): number =>
    (haystack.match(new RegExp(needle, 'g')) || []).length;

  const parseGroup = (steps: string) => {
    const m = steps.match(GROUP_STEP_MARKER);
    expect(m).not.toBeNull();
    const payload = steps.slice(m!.index! + 64 + 56);
    const tryLen = parseInt(payload.slice(0, 8), 16) * 2;
    const fallbackLen = parseInt(payload.slice(8, 16), 16) * 2;
    return {
      tryBlock: payload.slice(16, 16 + tryLen),
      fallbackBlock: payload.slice(16 + tryLen, 16 + tryLen + fallbackLen),
    };
  };

  const midRouteBuild = (
    primaryHop: object,
    fallbackHop: object,
    nextHop: object,
  ): string =>
    innerSteps(
      builder.buildByteCode(
        makeRoute([makeSwap(USDT, ETH), makeSwap(ETH, USDC)]),
        [
          { ...primaryHop, fallbackParam: fallbackHop },
          nextHop,
        ] as unknown as DexExchangeBuildParam[],
        NULL_ADDRESS,
        maybeWethCallData as any,
      ),
    );

  const rawNextHop = {
    needWrapNative: false,
    dexFuncHasRecipient: true,
    exchangeData: '0xcafebabe' + pad32(DEST_AMOUNT),
    insertFromAmountPos: 4,
    targetExchange: '0x3333333333333333333333333333333333333333',
  };
  const wethNextHop = { ...rawNextHop, needWrapNative: true };

  it('mid-route: raw primary + WETH fallback + raw next hop — group encoded, fallback unwraps (unit-level), raw threading matches', () => {
    const { tryBlock, fallbackBlock } = parseGroup(
      midRouteBuild(rawPrimary, wethFallback, rawNextHop),
    );
    expect(count(tryBlock, WITHDRAW_SEL)).toBe(0);
    expect(count(fallbackBlock, WITHDRAW_SEL)).toBe(1);
    expect(count(fallbackBlock, DEPOSIT_SEL)).toBe(0);
  });

  it('mid-route: raw primary + WETH fallback + WETH next hop — fallback unwraps to match the raw threading form', () => {
    const { tryBlock, fallbackBlock } = parseGroup(
      midRouteBuild(rawPrimary, wethFallback, wethNextHop),
    );
    // Threading form is raw native (the next unit deposits its own input, as
    // shaped by the raw primary), so the WETH-holding fallback must unwrap.
    expect(count(tryBlock, WITHDRAW_SEL)).toBe(0);
    expect(count(fallbackBlock, WITHDRAW_SEL)).toBe(1);
    expect(count(fallbackBlock, DEPOSIT_SEL)).toBe(0);
  });

  it('mid-route: WETH primary + raw fallback + WETH next hop — fallback wraps to match the WETH threading form', () => {
    const wethPrimary = {
      ...wethFallback,
      targetExchange: '0x2222222222222222222222222222222222222222',
    };
    const rawFallback = {
      ...rawPrimary,
      targetExchange: '0x1111111111111111111111111111111111111111',
    };
    const { tryBlock, fallbackBlock } = parseGroup(
      midRouteBuild(wethPrimary, rawFallback, wethNextHop),
    );
    // The primary keeps WETH (its unit skips the unwrap before a
    // needWrapNative hop), so the raw-native fallback must wrap its output.
    expect(count(tryBlock, WITHDRAW_SEL)).toBe(0);
    expect(count(tryBlock, DEPOSIT_SEL)).toBe(0);
    expect(count(fallbackBlock, DEPOSIT_SEL)).toBe(1);
    expect(count(fallbackBlock, WITHDRAW_SEL)).toBe(0);
  });
});
