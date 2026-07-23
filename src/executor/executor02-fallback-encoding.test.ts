import dotenv from 'dotenv';
dotenv.config();

import { Executor02BytecodeBuilder } from './Executor02BytecodeBuilder';
import { Network, NULL_ADDRESS } from '../constants';
import { DummyDexHelper } from '../dex-helper';

import { OptimalRate } from '@paraswap/core';
import { DexExchangeBuildParam } from '../types';
import { DepositWithdrawReturn } from '../dex/weth/types';

import priceRoute from './fixtures/executor02/routes/price-route-multiSwap-univ3-sushiv3-sushi-eth-wbtc.json';
import exchangeParams from './fixtures/executor02/exchange-params/price-route-multiSwap-univ3-sushiv3-sushi-eth-wbtc.json';
import maybeWethCallData from './fixtures/executor02/maybe-weth-calldata/price-route-multiSwap-univ3-sushiv3-sushi-eth-wbtc.json';

import ethDestRoute from './fixtures/executor02/routes/price-route-multiswap-univ3-usdt-dai-eth.json';
import ethDestParams from './fixtures/executor02/exchange-params/price-route-multiswap-univ3-usdt-dai-eth.json';
import ethDestWeth from './fixtures/executor02/maybe-weth-calldata/price-route-multiswap-univ3-usdt-dai-eth.json';

// Group step metadata (hex, no 0x): [target=20 zero bytes][size(4)][fromAmtPos(2)=0]
// [destTokenPos(2)][returnAmountPos(1)=0][specialDex(1)=ff][flag(2)]
const GROUP_STEP_RE = /0{40}([0-9a-f]{8})0000([0-9a-f]{4})00ff([0-9a-f]{4})/;

describe('Executor02BytecodeBuilder revertable fallback group', () => {
  let builder: Executor02BytecodeBuilder;

  beforeEach(() => {
    builder = new Executor02BytecodeBuilder(
      new DummyDexHelper(Network.MAINNET),
    );
  });

  const route = priceRoute as unknown as OptimalRate;
  const primary = exchangeParams as unknown as DexExchangeBuildParam[];
  const weth = maybeWethCallData as unknown as DepositWithdrawReturn;

  // The last swap (ETH -> WBTC) is single-exchange: flat param index 2. Attach a
  // fallback alternative with a distinct target so its block differs.
  const withFallback = () => {
    const params = primary.map(p => ({ ...p }));
    params[2].fallbackParam = {
      ...primary[2],
      targetExchange: '0x1111111111111111111111111111111111111111',
    };
    return params;
  };

  it('encodes a 0xFF group step for the single-exchange swap carrying a fallback', () => {
    const plain = builder.buildByteCode(route, primary, NULL_ADDRESS, weth);
    const grouped = builder.buildByteCode(
      route,
      withFallback(),
      NULL_ADDRESS,
      weth,
    );

    expect(grouped).not.toEqual(plain);
    expect(plain.replace('0x', '')).not.toMatch(GROUP_STEP_RE);

    const match = grouped.replace('0x', '').match(GROUP_STEP_RE);
    expect(match).not.toBeNull();

    const [, sizeHex] = match!;
    const size = parseInt(sizeHex, 16);

    // Payload = [28-byte padding][tryLen(4)][fallbackLen(4)][try][fallback](+optional
    // appended token). Read the lengths right after the padding and reconcile.
    const stepStart = match!.index!;
    const payload = grouped
      .replace('0x', '')
      .slice(stepStart + 64 /* metadata word */ + 56 /* 28-byte padding */);
    const tryLen = parseInt(payload.slice(0, 8), 16);
    const fallbackLen = parseInt(payload.slice(8, 16), 16);

    expect(tryLen).toBeGreaterThan(0);
    expect(fallbackLen).toBeGreaterThan(0);
    // size covers padding(28) + lengths(8) + both blocks (+ appended token if any)
    expect(size).toBeGreaterThanOrEqual(36 + tryLen + fallbackLen);

    // The fallback block encodes the substituted target.
    const blocks = payload.slice(16, 16 + (tryLen + fallbackLen) * 2);
    expect(blocks).toContain('1111111111111111111111111111111111111111');
  });

  it('encodes a 0xFF group step for a split member (vertical-branch path)', () => {
    // The first swap (SUSHI -> ETH) is split across two exchanges: flat param
    // indices 0 and 1. Attach a fallback to member 0.
    const params = primary.map(p => ({ ...p }));
    params[0].fallbackParam = {
      ...primary[0],
      targetExchange: '0x2222222222222222222222222222222222222222',
    };

    const grouped = builder.buildByteCode(route, params, NULL_ADDRESS, weth);
    const match = grouped.replace('0x', '').match(GROUP_STEP_RE);
    expect(match).not.toBeNull();

    // Inside a path the wrapper does the threading: flag must be 0.
    const [, , , flagHex] = match!;
    expect(parseInt(flagHex, 16)).toBe(0);

    // The fallback block encodes the substituted target.
    expect(grouped.replace('0x', '')).toContain(
      '2222222222222222222222222222222222222222',
    );
  });
});

describe('Executor02 fallback group ETH-dest output normalization', () => {
  let builder: Executor02BytecodeBuilder;

  beforeEach(() => {
    builder = new Executor02BytecodeBuilder(
      new DummyDexHelper(Network.MAINNET),
    );
  });

  const route = ethDestRoute as unknown as OptimalRate;
  const primary = ethDestParams as unknown as DexExchangeBuildParam[];
  const weth = ethDestWeth as unknown as DepositWithdrawReturn;

  const DEPOSIT_SELECTOR = 'd0e30db0';
  const WITHDRAW_SELECTOR = '2e1a7d4d';

  // Extract the try/fallback blocks of the first group step in the bytecode.
  const groupBlocks = (bytecode: string) => {
    const raw = bytecode.replace('0x', '');
    const match = raw.match(GROUP_STEP_RE);
    expect(match).not.toBeNull();
    const payload = raw.slice(
      match!.index! + 64 /* metadata word */ + 56 /* 28-byte padding */,
    );
    const tryLen = parseInt(payload.slice(0, 8), 16);
    const fallbackLen = parseInt(payload.slice(8, 16), 16);
    return {
      tryBlock: payload.slice(16, 16 + tryLen * 2),
      fallbackBlock: payload.slice(
        16 + tryLen * 2,
        16 + (tryLen + fallbackLen) * 2,
      ),
    };
  };

  // The last hop (DAI -> ETH) is a 4-way split of WETH-based UniswapV3 members:
  // flat param indices 4..7. Member 4 carries the group in all tests.
  const GROUP_MEMBER = 4;

  it('raw-ETH fallback WITH recipient: output wrapped to match the WETH-holding try', () => {
    // Pre-normalization this exact shape was guarded and ran plain. Fallback
    // params are built with recipient = executor (never Augustus), so even a
    // recipient-capable raw-ETH dex leaves its ETH on the executor — the
    // compensation deposit wraps it to match the try branch.
    const params = primary.map(p => ({ ...p }));
    params[GROUP_MEMBER].fallbackParam = {
      ...primary[GROUP_MEMBER],
      targetExchange: '0x3333333333333333333333333333333333333333',
      needWrapNative: false,
      dexFuncHasRecipient: true,
    };

    const grouped = builder.buildByteCode(route, params, NULL_ADDRESS, weth);
    const { tryBlock, fallbackBlock } = groupBlocks(grouped);

    expect(fallbackBlock).toContain('3333333333333333333333333333333333333333');
    expect(fallbackBlock).toContain(DEPOSIT_SELECTOR);
    // Try holds WETH for the root unwrap — no unwrap inside it.
    expect(tryBlock).not.toContain(WITHDRAW_SELECTOR);
    expect(tryBlock).not.toContain(DEPOSIT_SELECTOR);
  });

  it('raw-ETH fallback WITHOUT recipient (eth-outcome): wraps its output to match the WETH-holding try', () => {
    const params = primary.map(p => ({ ...p }));
    params[GROUP_MEMBER].fallbackParam = {
      ...primary[GROUP_MEMBER],
      targetExchange: '0x3333333333333333333333333333333333333333',
      needWrapNative: false,
      dexFuncHasRecipient: false,
    };

    const grouped = builder.buildByteCode(route, params, NULL_ADDRESS, weth);
    const { tryBlock, fallbackBlock } = groupBlocks(grouped);

    // The compensation deposit ends the fallback block; the try has none.
    expect(fallbackBlock).toContain(DEPOSIT_SELECTOR);
    expect(tryBlock).not.toContain(DEPOSIT_SELECTOR);
  });

  it('raw-ETH primary (sent-outcome) with WETH-based fallback: unwraps and sends the fallback output', () => {
    // Case B (Dexalot-shaped primary): the route machinery expects the output
    // already delivered, so the WETH-holding fallback must withdraw + send.
    const params = primary.map(p => ({ ...p }));
    params[GROUP_MEMBER] = {
      ...primary[GROUP_MEMBER],
      needWrapNative: false,
      dexFuncHasRecipient: true,
      fallbackParam: {
        ...primary[GROUP_MEMBER],
        targetExchange: '0x4444444444444444444444444444444444444444',
        needWrapNative: true,
      },
    };

    const grouped = builder.buildByteCode(route, params, NULL_ADDRESS, weth);
    const { tryBlock, fallbackBlock } = groupBlocks(grouped);

    expect(fallbackBlock).toContain(WITHDRAW_SELECTOR);
    expect(tryBlock).not.toContain(WITHDRAW_SELECTOR);
    // SEND_NATIVE step targets Augustus V6.
    const augustus = new DummyDexHelper(
      Network.MAINNET,
    ).config.data.augustusV6Address!.replace('0x', '');
    expect(fallbackBlock).toContain(augustus);
    expect(tryBlock).not.toContain(augustus);
  });

  it('mid-route ETH-dest mixed wrap-ness stays guarded (runs plain)', () => {
    // sushi-eth-wbtc: swap0 (SUSHI -> ETH) is mid-route with ETH dest.
    const midRoute = priceRoute as unknown as OptimalRate;
    const midPrimary = exchangeParams as unknown as DexExchangeBuildParam[];
    const midWeth = maybeWethCallData as unknown as DepositWithdrawReturn;

    const params = midPrimary.map(p => ({ ...p }));
    params[0].fallbackParam = {
      ...midPrimary[0],
      targetExchange: '0x5555555555555555555555555555555555555555',
      needWrapNative: !midPrimary[0].needWrapNative,
    };

    const plain = builder.buildByteCode(
      midRoute,
      midPrimary,
      NULL_ADDRESS,
      midWeth,
    );
    const grouped = builder.buildByteCode(
      midRoute,
      params,
      NULL_ADDRESS,
      midWeth,
    );
    expect(grouped).toEqual(plain);
  });
});
