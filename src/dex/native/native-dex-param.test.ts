import dotenv from 'dotenv';
dotenv.config();

import { ParaSwapVersion } from '@paraswap/core';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { GetDexParamPreProcessOptions } from '../../types';
import { Native } from './native';

const dexKey = 'Native';
const network = Network.MAINNET;
const tokens = Tokens[network];

const routerAddress = '0x1111111254EEB25477B68fb85Ed929f73A960582';
const userAddress = '0x5Bad996643a924De21b6b2875c85C33F3c5bBcB6';
const executorAddress = '0x6A000F20005980200259B80c5102003040001068';
// tradeRFQT selector — the only one Native infers insertFromAmountPos for
const calldata = '0x0947c2d9' + '0'.repeat(64);

const DEADLINE = 1893456000;

const preProcess: GetDexParamPreProcessOptions = {
  slippageFactor: '0.99',
  txOrigin: userAddress,
  userAddress,
  executionContractAddress: executorAddress,
  recipient: userAddress,
  version: ParaSwapVersion.V6,
  srcToken: tokens['WETH'],
  destToken: tokens['USDC'],
  srcAmount: '1000000000000000000',
  destAmount: '1000000000',
};

const buildNative = () => {
  const dexHelper = new DummyDexHelper(network);
  (dexHelper.config.data as any).nativeApiKey = 'test-key';
  const requestMock = jest.fn(async () => ({
    data: {
      success: true,
      amountOut: '1000000000',
      orders: [{ deadlineTimestamp: DEADLINE }],
      txRequest: { target: routerAddress, calldata, value: '0' },
    },
  }));
  (dexHelper.httpRequest.request as any) = requestMock;

  return { native: new Native(network, dexKey, dexHelper), requestMock };
};

const getDexParam = (
  native: Native,
  data: any,
  options?: { preProcess: GetDexParamPreProcessOptions },
) =>
  native.getDexParam(
    tokens['WETH'].address,
    tokens['USDC'].address,
    '1000000000000000000',
    // getDexParam receives destAmount '1' on SELL; the real one only lives in
    // the preProcess payload
    '1',
    userAddress,
    data,
    SwapSide.SELL,
    executorAddress,
    options,
  );

describe('Native getDexParam without preProcessTransaction', () => {
  it('does not re-quote when the order build is already present', async () => {
    const { native, requestMock } = buildNative();

    const dexParam = await getDexParam(
      native,
      { quote: { txRequest: { target: routerAddress, calldata, value: '0' } } },
      { preProcess },
    );

    expect(requestMock).not.toHaveBeenCalled();
    expect(dexParam.exchangeData).toBe(calldata);
    expect(dexParam.targetExchange).toBe(routerAddress);
    expect(dexParam.insertFromAmountPos).toBe(36);
    expect(dexParam).not.toHaveProperty('minDeadline');
  });

  it('fetches the quote itself and reports the deadline', async () => {
    const { native, requestMock } = buildNative();

    const dexParam = await getDexParam(native, {}, { preProcess });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(dexParam.exchangeData).toBe(calldata);
    expect(dexParam.targetExchange).toBe(routerAddress);
    expect(dexParam.minDeadline).toBe(String(DEADLINE));
  });

  // a txRequest without calldata must not count as a built order: it used to
  // slip past the predicate and blow up in normalizeTxRequest
  it('treats a txRequest without calldata as not pre processed', async () => {
    const { native, requestMock } = buildNative();

    const dexParam = await getDexParam(
      native,
      { quote: { txRequest: { target: routerAddress } } },
      { preProcess },
    );

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(dexParam.exchangeData).toBe(calldata);
  });

  it('throws when there is neither order build nor preProcess context', async () => {
    const { native, requestMock } = buildNative();

    await expect(getDexParam(native, {})).rejects.toMatchObject({
      name: 'GetDexParamPreProcessError',
      code: 'MISSING_CONTEXT',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });
});
