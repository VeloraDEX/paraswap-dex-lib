import { Interface } from '@ethersproject/abi';
import { hexDataLength, hexDataSlice } from 'ethers/lib/utils';
import { BigNumber } from 'ethers';
import { IDexHelper } from '../../dex-helper';
import { Executor01BytecodeBuilder } from '../../executor/Executor01BytecodeBuilder';
import { Executor02BytecodeBuilder } from '../../executor/Executor02BytecodeBuilder';
import { Executor03BytecodeBuilder } from '../../executor/Executor03BytecodeBuilder';
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

const poolKey = (extension: string, token0 = TOKEN0) =>
  new PoolKey(
    BigInt(token0),
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
  token0 = TOKEN0,
) {
  const dex = Object.create(EkuboV3.prototype);
  Object.assign(dex, {
    needWrapNative: false,
    mevCaptureV21Extension: BigInt(MEV_CAPTURE_V21_ADDRESS),
    routerIface: new Interface(RouterABI),
  });
  const data: EkuboData = {
    poolKeyAbi: poolKey(extension, token0).toAbi(),
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
      expect(param.insertFromAmountPos).toBe(
        hexDataLength(param.exchangeData) -
          (extension === MEV_CAPTURE_ADDRESS ? 32 : 0),
      );
    }
  });

  describe.each([
    ['Executor01', Executor01BytecodeBuilder],
    ['Executor02', Executor02BytecodeBuilder],
    ['Executor03', Executor03BytecodeBuilder],
  ] as const)('%s BUY amount insertion', (_name, Builder) => {
    test('keeps the ERC20 Yul route at its exact calldata length', () => {
      const param = dexParam(
        MEV_CAPTURE_V21_ADDRESS,
        SwapSide.BUY,
        false,
        '1000',
        '1000',
      );
      const builder = new Builder({} as IDexHelper);
      const swap = {
        srcToken: TOKEN1,
        destToken: TOKEN0,
        swapExchanges: [{ srcAmount: '1000', destAmount: '1000' }],
      };
      const encoded = (builder as any).buildDexCallData({
        priceRoute: {
          srcToken: TOKEN1,
          destToken: TOKEN0,
          bestRoute: [{ swaps: [swap] }],
        },
        exchangeParams: [param],
        routeIndex: 0,
        swapIndex: 0,
        swapExchangeIndex: 0,
        exchangeParamIndex: 0,
        // The router has a recipient, so ERC20 output needs no balance check.
        flag: 3,
      });
      expect(hexDataSlice(encoded, 60)).toBe(param.exchangeData);
      expect(hexDataLength(hexDataSlice(encoded, 60))).toBe(
        FORWARDED_SWAP_ROUTE_LENGTH,
      );
      expect(BigNumber.from(hexDataSlice(encoded, 24, 26)).toNumber()).toBe(
        FORWARDED_SWAP_ROUTE_LENGTH,
      );
    });

    test.each([false, true])(
      'preserves the Router output and balance-check token (native=%s)',
      native => {
        const eth = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
        const param = dexParam(
          MEV_CAPTURE_ADDRESS,
          SwapSide.BUY,
          false,
          '1000',
          '1000',
          native ? '0x0' : TOKEN0,
        );
        const builder = new Builder({
          config: { data: { wrappedNativeTokenAddress: weth } },
        } as IDexHelper);
        const swap = {
          srcToken: TOKEN1,
          destToken: native ? eth : TOKEN0,
          swapExchanges: [
            { srcAmount: '1000', destAmount: '1000' },
            { srcAmount: '1000', destAmount: '1000' },
          ],
        };
        // Native output checks ETH (flag 7); ERC20 checks the token (flag 11).
        // The mega split also makes Executor02 append the destination token
        // for its vertical-branching wrapper, even when it checks native ETH.
        // Call the real builders, including their token appends and metadata.
        const encoded = (builder as any).buildDexCallData({
          priceRoute: {
            srcToken: swap.srcToken,
            destToken: swap.destToken,
            bestRoute: [{ swaps: [swap] }, { swaps: [swap] }],
          },
          exchangeParams: [param, param, param, param],
          routeIndex: 0,
          swapIndex: 0,
          swapExchangeIndex: 0,
          exchangeParamIndex: 0,
          flag: native ? 7 : 11,
        });
        const fromPos = BigNumber.from(
          hexDataSlice(encoded, 24, 26),
        ).toNumber();
        const callData = hexDataSlice(encoded, 60);
        const token = native ? eth : TOKEN0;
        const tokenIndex = callData.slice(2).indexOf(token.slice(2));
        // Executor01 checks ETH without appending a token; the other builders
        // append it for native-output bookkeeping.
        expect(tokenIndex >= 0).toBe(!native || _name !== 'Executor01');
        const padded = callData.padEnd(2 + (fromPos + 32) * 2, '0');
        // Model the executor's packed-128 input insertion with a slippage buffer.
        const inserted =
          hexDataSlice(padded, 0, fromPos + 16) +
          BigNumber.from(1100).toHexString().slice(2).padStart(32, '0') +
          hexDataSlice(padded, fromPos + 32).slice(2);
        if (tokenIndex >= 0) {
          expect(
            hexDataSlice(inserted, tokenIndex / 2, tokenIndex / 2 + 20),
          ).toBe(token);
        }
        const decoded = new Interface(RouterABI).decodeFunctionData(
          'swapAllowPartialFill((address,address,bytes32),bytes32,address)',
          inserted,
        );
        expect(int128At(decoded[1], 12)).toBe(-1000n);
      },
    );
  });
});
