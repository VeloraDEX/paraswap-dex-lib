import { Interface } from '@ethersproject/abi';
import { hexDataLength, hexDataSlice } from 'ethers/lib/utils';
import { BigNumber } from 'ethers';
import { SwapSide } from '../../constants';
import {
  MEV_CAPTURE_ADDRESS,
  MEV_CAPTURE_V21_ADDRESS,
  ROUTER_ADDRESS,
  YUL_ROUTER_ADDRESS,
} from './config';
import { EkuboV3 } from './ekubo-v3';
import { ExtensionType, extensionType } from './extension-type';
import { ConcentratedPoolTypeConfig, PoolConfig, PoolKey } from './pools/utils';
import {
  encodeForwardedSwapRoute,
  FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET,
  FORWARDED_SWAP_ROUTE_LENGTH,
  MIN_INT128,
} from './yul-router';
import { EkuboData } from './types';
import RouterABI from '../../abi/ekubo-v3/mev-capture-router.json';

const TOKEN0 = '0xaa6087b56a61becb9635d0ac85c95f2e6e50288f';
const TOKEN1 = '0xcb6773f3f224c3e98ee778d5746b11a2df0858e0';
const RECIPIENT = '0x3d546f0181b78b97c1a3c33cab23aa443e26eab4';

const poolKey = (extension: string) =>
  new PoolKey(
    BigInt(TOKEN0),
    BigInt(TOKEN1),
    new PoolConfig(
      BigInt(extension),
      9223372036854775n,
      new ConcentratedPoolTypeConfig(100),
    ),
  );

const int128At = (data: string, offset: number) =>
  BigNumber.from(hexDataSlice(data, offset, offset + 16))
    .fromTwos(128)
    .toBigInt();

// getDexParam without constructing the dex (which needs a provider)
function dexParam(
  extension: string,
  side: SwapSide,
  isToken1: boolean,
  amount: string,
  otherAmount?: string,
) {
  const dex = Object.create(EkuboV3.prototype);
  Object.assign(dex, {
    needWrapNative: false,
    mevCaptureV21Extension: BigInt(MEV_CAPTURE_V21_ADDRESS),
    routerIface: new Interface(RouterABI),
  });
  const data: EkuboData = {
    poolKeyAbi: poolKey(extension).toAbi(),
    isToken1,
    skipAhead: {},
  };
  return (dex as EkuboV3).getDexParam(
    TOKEN0,
    TOKEN1,
    side === SwapSide.SELL ? amount : otherAmount ?? '0',
    side === SwapSide.BUY ? amount : otherAmount ?? '1',
    RECIPIENT,
    data,
    side,
    RECIPIENT,
  );
}

describe('MEVCapture v2.1 execution through the Yul router', () => {
  test('the extension is only recognized where it is configured', () => {
    const v21 = BigInt(MEV_CAPTURE_V21_ADDRESS);
    expect(extensionType(v21, v21)).toBe(ExtensionType.MevCaptureV21);
    expect(extensionType(v21)).toBe(ExtensionType.Unknown);
    expect(extensionType(BigInt(MEV_CAPTURE_ADDRESS), v21)).toBe(
      ExtensionType.MevCapture,
    );
  });

  test('route layout', () => {
    const key = poolKey(MEV_CAPTURE_V21_ADDRESS);
    const route = encodeForwardedSwapRoute({
      specifiedToken: BigInt(TOKEN1),
      calculatedToken: BigInt(TOKEN0),
      specifiedAmount: -123n,
      calculatedAmountThreshold: MIN_INT128,
      recipient: RECIPIENT,
      forwardee: BigInt(MEV_CAPTURE_V21_ADDRESS),
      poolKey: key.toAbi(),
      skipAhead: 0,
      allowPartial: true,
    });

    expect(hexDataLength(route)).toBe(FORWARDED_SWAP_ROUTE_LENGTH);
    expect(route).toBe(route.toLowerCase());
    expect(hexDataSlice(route, 0, 2)).toBe('0x0100');
    expect(hexDataSlice(route, 2, 22)).toBe(TOKEN1);
    expect(hexDataSlice(route, 22, 42)).toBe(TOKEN0);
    expect(int128At(route, 42)).toBe(MIN_INT128);
    expect(hexDataSlice(route, 58, 78)).toBe(RECIPIENT);
    expect(int128At(route, FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET)).toBe(-123n);
    // one path, one forwarded hop
    expect(hexDataSlice(route, 94, 96)).toBe('0x0001');
    expect(hexDataSlice(route, 96, 116)).toBe(
      MEV_CAPTURE_V21_ADDRESS.toLowerCase(),
    );
    expect(hexDataSlice(route, 116, 136)).toBe(TOKEN0);
    expect(hexDataSlice(route, 136, 156)).toBe(TOKEN1);
    expect(hexDataSlice(route, 156, 188)).toBe(key.toAbi().config);
    expect(hexDataSlice(route, 188, 200)).toBe('0x' + '00'.repeat(12));
    expect(hexDataSlice(route, 200, 204)).toBe('0x80000000');
  });

  test('exact input: the amount Augustus inserts is the route amount', () => {
    const param = dexParam(
      MEV_CAPTURE_V21_ADDRESS,
      SwapSide.SELL,
      false,
      '1000',
    );
    expect(param.targetExchange).toBe(YUL_ROUTER_ADDRESS);
    expect(param.dexFuncHasRecipient).toBe(true);
    expect(param.amountsPacked128).toBe(true);
    // the inserted 128-bit amount is the low half of the word at the position
    expect(param.insertFromAmountPos! + 16).toBe(
      FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET,
    );
    const route = param.exchangeData;
    expect(hexDataSlice(route, 2, 22)).toBe(TOKEN0);
    expect(int128At(route, 42)).toBe(0n);
    expect(int128At(route, FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET)).toBe(1000n);
  });

  test('exact output: negative amount and an unbounded input', () => {
    const param = dexParam(MEV_CAPTURE_V21_ADDRESS, SwapSide.BUY, true, '1000');
    const route = param.exchangeData;
    expect(param.insertFromAmountPos).toBe(hexDataLength(route));
    expect(hexDataSlice(route, 2, 22)).toBe(TOKEN1);
    expect(hexDataSlice(route, 22, 42)).toBe(TOKEN0);
    expect(int128At(route, 42)).toBe(MIN_INT128);
    expect(int128At(route, FORWARDED_SWAP_ROUTE_AMOUNT_OFFSET)).toBe(-1000n);
  });

  test('other pools keep the Router', () => {
    for (const extension of [MEV_CAPTURE_ADDRESS, '0x0']) {
      const param = dexParam(extension, SwapSide.SELL, false, '1000');
      expect(param.targetExchange).toBe(ROUTER_ADDRESS);
      expect(param.insertFromAmountPos).toBeUndefined();
    }
  });

  test('exact output never lets the executor overwrite the output amount', () => {
    // srcAmount equal to destAmount would otherwise match the negated output
    for (const extension of [MEV_CAPTURE_V21_ADDRESS, MEV_CAPTURE_ADDRESS]) {
      const param = dexParam(extension, SwapSide.BUY, false, '1000', '1000');
      expect(param.insertFromAmountPos).toBe(hexDataLength(param.exchangeData));
    }
  });
});
