import dotenv from 'dotenv';
dotenv.config();

import BigNumber from 'bignumber.js';
import { ParaSwapVersion } from '@paraswap/core';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, NULL_ADDRESS, SwapSide } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import {
  GetDexParamPreProcessOptions,
  OptimalSwapExchange,
  PreprocessTransactionOptions,
} from '../../types';
import { Liquorice } from './liquorice';
import { LiquoriceData, LiquoriceFirmResponse } from './types';

const dexKey = 'Liquorice';
const network = Network.MAINNET;
const tokens = Tokens[network];

const SETTLEMENT = '0x43dcd6586e6209ee7235a21bdc4aa301e5bc44e8';
const BALANCE_MANAGER = '0x56b4720e40df52c560e520238e34e9c33d57e593';
const EXECUTOR = '0x3D546f0181b78b97c1a3C33CAb23AA443E26EAB4';
const AUGUSTUS = '0x6a000f20005980200259b80c5102003040001068';
const USER = '0x5Bad996643a924De21b6b2875c85C33F3c5bBcB6';
const DEADLINE = 1893456000;

const SRC_AMOUNT = '1000000000000000000';
const DEST_AMOUNT = '3000000000';
// selector + 3 words; the fill amount sits in the second word
const CALLDATA = `0x12345678${'00'.repeat(32)}${'00'.repeat(31)}01${'00'.repeat(
  32,
)}`;

const quote = (
  overrides: Partial<LiquoriceFirmResponse> = {},
): LiquoriceFirmResponse => ({
  rfqId: 'rfq-1',
  makerRfqId: 'maker-rfq-1',
  to: SETTLEMENT,
  data: CALLDATA,
  value: '0',
  spender: BALANCE_MANAGER,
  srcAmount: SRC_AMOUNT,
  destAmount: DEST_AMOUNT,
  partialFill: { amountInPos: 36, minSrcAmount: '100000000000000000' },
  expiry: DEADLINE,
  ...overrides,
});

const httpError = (status: number, code: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { code, message: code } },
  });

const build = (response: LiquoriceFirmResponse | Error = quote()) => {
  const dexHelper = new DummyDexHelper(network);
  (dexHelper.config.data as any).liquoriceApiKey = 'test-key';
  const requestMock = jest.fn(async () => {
    if (response instanceof Error) throw response;
    return { data: response };
  });
  (dexHelper.httpRequest.request as any) = requestMock;

  const liquorice = new Liquorice(network, dexKey, dexHelper);
  const restrictSpy = jest
    .spyOn(liquorice as any, 'restrict')
    .mockResolvedValue(undefined);

  return { liquorice, requestMock, restrictSpy };
};

const exchange = (): OptimalSwapExchange<LiquoriceData> => ({
  exchange: dexKey,
  srcAmount: SRC_AMOUNT,
  destAmount: DEST_AMOUNT,
  percent: 100,
  data: {},
});

const options = (
  overrides: Partial<PreprocessTransactionOptions> = {},
): PreprocessTransactionOptions => ({
  slippageFactor: new BigNumber('0.99'),
  txOrigin: USER,
  userAddress: USER,
  executionContractAddress: EXECUTOR,
  recipient: AUGUSTUS,
  version: ParaSwapVersion.V6,
  ...overrides,
});

const preProcess = (
  liquorice: Liquorice,
  opts = options(),
  srcToken = tokens['WETH'],
) =>
  liquorice.preProcessTransaction(
    exchange(),
    srcToken,
    tokens['USDC'],
    SwapSide.SELL,
    opts,
  );

describe('Liquorice preProcessTransaction', () => {
  it('requests a firm quote for the executor and recipient', async () => {
    const { liquorice, requestMock } = build();

    const [swapExchange, txInfo] = await preProcess(liquorice);

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [request] = (requestMock.mock.calls as any)[0];
    expect(request).toMatchObject({
      method: 'POST',
      url: 'https://velora.liquorice.tech/v1/velora/firm',
      headers: { 'x-api-key': 'test-key' },
    });
    expect(request.data).toEqual({
      chainId: 1,
      srcToken: tokens['WETH'].address.toLowerCase(),
      destToken: tokens['USDC'].address.toLowerCase(),
      side: 'SELL',
      amount: SRC_AMOUNT,
      expectedAmount: DEST_AMOUNT,
      slippageFactor: '0.99',
      executionContract: EXECUTOR.toLowerCase(),
      recipient: AUGUSTUS,
      userAddress: USER.toLowerCase(),
      txOrigin: USER.toLowerCase(),
    });
    expect(swapExchange.data?.quote).toEqual(quote());
    expect(swapExchange.destAmount).toBe(DEST_AMOUNT);
    expect(txInfo.deadline).toBe(BigInt(DEADLINE));
  });

  it('quotes ETH as WETH', async () => {
    const { liquorice, requestMock } = build();

    await preProcess(liquorice, options(), tokens['ETH']);

    expect((requestMock.mock.calls as any)[0][0].data.srcToken).toBe(
      tokens['WETH'].address.toLowerCase(),
    );
  });

  it('omits zero user and origin addresses', async () => {
    const { liquorice, requestMock } = build();

    await preProcess(
      liquorice,
      options({ userAddress: NULL_ADDRESS, txOrigin: NULL_ADDRESS }),
    );

    const { data } = (requestMock.mock.calls as any)[0][0];
    expect(data).not.toHaveProperty('userAddress');
    expect(data).not.toHaveProperty('txOrigin');
  });

  it('does not quote without an execution contract', async () => {
    const { liquorice, requestMock, restrictSpy } = build();

    await expect(
      preProcess(
        liquorice,
        options({ executionContractAddress: NULL_ADDRESS }),
      ),
    ).rejects.toThrow('missing executionContractAddress');
    expect(requestMock).not.toHaveBeenCalled();
    expect(restrictSpy).not.toHaveBeenCalled();
  });

  it('throws SlippageCheckError without restricting', async () => {
    const { liquorice, restrictSpy } = build(
      quote({ destAmount: '2969999999' }),
    );

    await expect(preProcess(liquorice)).rejects.toMatchObject({
      isSlippageError: true,
    });
    expect(restrictSpy).not.toHaveBeenCalled();
  });

  it('accepts a quote exactly at the slippage bound', async () => {
    const { liquorice } = build(quote({ destAmount: '2970000000' }));

    await expect(preProcess(liquorice)).resolves.toBeDefined();
  });

  it.each([
    ['foreign target', { to: USER }],
    ['foreign spender', { spender: USER }],
    ['different src amount', { srcAmount: '1' }],
    ['non-zero value', { value: '1' }],
    [
      'position past calldata',
      { partialFill: { amountInPos: 70, minSrcAmount: '1' } },
    ],
    [
      'position inside the selector',
      { partialFill: { amountInPos: 2, minSrcAmount: '1' } },
    ],
  ])('rejects a quote with %s and restricts', async (_name, overrides) => {
    const { liquorice, restrictSpy } = build(quote(overrides as any));

    await expect(preProcess(liquorice)).rejects.toThrow('invalid firm quote');
    expect(restrictSpy).toHaveBeenCalledTimes(1);
  });

  it('blacklists the user on 403', async () => {
    const { liquorice, restrictSpy } = build(httpError(403, 'blacklisted'));

    await expect(preProcess(liquorice)).rejects.toMatchObject({
      isBlacklistError: true,
    });
    expect(await liquorice.isBlacklisted(USER)).toBe(true);
    expect(restrictSpy).not.toHaveBeenCalled();
  });

  it('refuses blacklisted users before quoting', async () => {
    const { liquorice, requestMock } = build();
    await liquorice.addBlacklistedAddress(USER);

    await expect(preProcess(liquorice)).rejects.toMatchObject({
      isBlacklistError: true,
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'no_liquidity'],
    [422, 'unsupported_token'],
  ])('does not restrict on %i %s', async (status, code) => {
    const { liquorice, restrictSpy } = build(httpError(status, code));

    await expect(preProcess(liquorice)).rejects.toThrow(code);
    expect(restrictSpy).not.toHaveBeenCalled();
  });

  it.each([
    [503, 'upstream_unavailable'],
    [500, 'internal_error'],
    [401, 'unauthorized'],
    [400, 'invalid_request'],
  ])('restricts on %i %s', async (status, code) => {
    const { liquorice, restrictSpy } = build(httpError(status, code));

    await expect(preProcess(liquorice)).rejects.toThrow(code);
    expect(restrictSpy).toHaveBeenCalledTimes(1);
  });

  it('restricts on network errors', async () => {
    const { liquorice, restrictSpy } = build(new Error('timeout of 5000ms'));

    await expect(preProcess(liquorice)).rejects.toThrow('timeout');
    expect(restrictSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses BUY', async () => {
    const { liquorice, requestMock } = build();

    await expect(
      liquorice.preProcessTransaction(
        exchange(),
        tokens['WETH'],
        tokens['USDC'],
        SwapSide.BUY,
        options(),
      ),
    ).rejects.toThrow('BUY not supported');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

const preProcessContext: GetDexParamPreProcessOptions = {
  slippageFactor: '0.99',
  txOrigin: USER,
  userAddress: USER,
  executionContractAddress: EXECUTOR,
  recipient: AUGUSTUS,
  version: ParaSwapVersion.V6,
  srcToken: tokens['WETH'],
  destToken: tokens['USDC'],
  srcAmount: SRC_AMOUNT,
  destAmount: DEST_AMOUNT,
};

const getDexParam = (
  liquorice: Liquorice,
  data: LiquoriceData,
  withContext = true,
) =>
  liquorice.getDexParam(
    tokens['WETH'].address,
    tokens['USDC'].address,
    SRC_AMOUNT,
    '1',
    AUGUSTUS,
    data,
    SwapSide.SELL,
    EXECUTOR,
    withContext ? { preProcess: preProcessContext } : undefined,
  );

describe('Liquorice getDexParam', () => {
  it('encodes the settlement call with BalanceManager approval and amount insertion', async () => {
    const { liquorice, requestMock } = build();

    const param = await getDexParam(liquorice, { quote: quote() });

    expect(requestMock).not.toHaveBeenCalled();
    expect(param).toEqual({
      needWrapNative: true,
      dexFuncHasRecipient: true,
      exchangeData: CALLDATA,
      targetExchange: SETTLEMENT,
      spender: BALANCE_MANAGER,
      returnAmountPos: undefined,
      insertFromAmountPos: 36,
      sendEthButSupportsInsertFromAmount: true,
    });
  });

  it('marks the amount as absent when the quote cannot be partially filled', async () => {
    const { liquorice } = build();

    const param = await getDexParam(liquorice, {
      quote: quote({ partialFill: null }),
    });

    expect(param.swappedAmountNotPresentInExchangeData).toBe(true);
    expect(param).not.toHaveProperty('insertFromAmountPos');
  });

  it('fetches the quote itself when called standalone and reports the deadline', async () => {
    const { liquorice, requestMock } = build();

    const param = await getDexParam(liquorice, {});

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(param.exchangeData).toBe(CALLDATA);
    expect(param.minDeadline).toBe(String(DEADLINE));
  });

  it('treats a quote without spender as not pre processed', async () => {
    const { liquorice, requestMock } = build();

    await getDexParam(liquorice, {
      quote: { ...quote(), spender: undefined as any },
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('throws when there is neither a quote nor preProcess context', async () => {
    const { liquorice, requestMock } = build();

    await expect(getDexParam(liquorice, {}, false)).rejects.toMatchObject({
      name: 'GetDexParamPreProcessError',
      code: 'MISSING_CONTEXT',
    });
    expect(requestMock).not.toHaveBeenCalled();
  });
});
