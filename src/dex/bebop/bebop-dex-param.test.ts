import dotenv from 'dotenv';
dotenv.config();

import { utils } from 'ethers';
import { ParaSwapVersion } from '@paraswap/core';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Tokens } from '../../../tests/constants-e2e';
import { GetDexParamPreProcessOptions } from '../../types';
import { BlacklistError, RestrictedError } from '../generic-rfq/types';
import { Bebop } from './bebop';

const dexKey = 'Bebop';
const network = Network.MAINNET;
const tokens = Tokens[network];

const routerAddress = '0xBeb0009ACa35087ce7cCF11637E24dd1Aad3bf2A';
const settlementAddress = '0xbbbbbBB520d69a9775E85b458C58c648259FAD5F';
const userAddress = '0x5Bad996643a924De21b6b2875c85C33F3c5bBcB6';
const executorAddress = '0x6A000F20005980200259B80c5102003040001068';
const routerCalldata = '0xa3ce737f' + '0'.repeat(64) + '1'.padStart(64, '0');

const QUOTE_EXPIRY = 1893456000;

const buildQuoteResponse = () => ({
  requestId: 'request-id',
  quoteId: 'quote-id',
  expiry: QUOTE_EXPIRY,
  approvalTarget: settlementAddress,
  partialFillOffset: 1,
  buyTokens: {
    [utils.getAddress(tokens['USDC'].address)]: {
      amount: '1000000000',
      minimumAmount: '1000000000',
    },
  },
  sellTokens: {
    [utils.getAddress(tokens['WETH'].address)]: {
      amount: '1000000000000000000',
    },
  },
  tx: {
    to: routerAddress,
    value: '0x0',
    data: routerCalldata,
  },
});

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

const getDexParam = (
  bebop: Bebop,
  data: any,
  options?: { preProcess: GetDexParamPreProcessOptions },
) =>
  bebop.getDexParam(
    tokens['WETH'].address,
    tokens['USDC'].address,
    '1000000000000000000',
    // getDexParam receives destAmount '1' on SELL — the real one only lives in
    // the preProcess payload
    '1',
    userAddress,
    data,
    SwapSide.SELL,
    executorAddress,
    options,
  );

describe('Bebop getDexParam without preProcessTransaction', () => {
  it('does not re-quote when the order build is already present', async () => {
    const dexHelper = new DummyDexHelper(network);
    const getMock = jest.fn();
    (dexHelper.httpRequest.get as any) = getMock;
    const bebop = new Bebop(network, dexKey, dexHelper);

    const dexParam = await getDexParam(
      bebop,
      {
        approvalTarget: settlementAddress,
        partialFillOffset: 1,
        tx: { to: routerAddress, value: '0x0', data: routerCalldata },
      },
      { preProcess },
    );

    expect(getMock).not.toHaveBeenCalled();
    expect(dexParam.targetExchange).toBe(utils.getAddress(routerAddress));
    expect(dexParam.exchangeData).toBe(routerCalldata);
    expect(dexParam).not.toHaveProperty('minDeadline');
  });

  it('fetches the quote itself and reports the quote expiry', async () => {
    const dexHelper = new DummyDexHelper(network);
    const getMock = jest.fn(async () => buildQuoteResponse());
    (dexHelper.httpRequest.get as any) = getMock;
    const bebop = new Bebop(network, dexKey, dexHelper);

    const dexParam = await getDexParam(bebop, {}, { preProcess });

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(dexParam.targetExchange).toBe(utils.getAddress(routerAddress));
    expect(dexParam.spender).toBe(utils.getAddress(settlementAddress));
    expect(dexParam.exchangeData).toBe(routerCalldata);
    expect(dexParam.minDeadline).toBe(String(QUOTE_EXPIRY));
  });

  it('reports a failing quote as GetDexParamPreProcessError', async () => {
    const dexHelper = new DummyDexHelper(network);
    const getMock = jest.fn(async () => ({
      error: { errorCode: 999, message: 'no liquidity' },
    }));
    (dexHelper.httpRequest.get as any) = getMock;
    const bebop = new Bebop(network, dexKey, dexHelper);

    const error = await getDexParam(bebop, {}, { preProcess }).catch(e => e);

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(error.name).toBe('GetDexParamPreProcessError');
    expect(error.code).toBe('PREPROCESS_FAILED');
    expect(error.dexKey).toBe(dexKey);
    // the dex's own reason stays visible instead of being swallowed
    expect(error.message).toContain('no liquidity');
    expect(error.originalError).toBeInstanceOf(Error);
  });

  it('keeps a DenyListed quote as a BlacklistError with its reason', async () => {
    const dexHelper = new DummyDexHelper(network);
    (dexHelper.httpRequest.get as any) = jest.fn(async () => ({
      error: { errorCode: 112, message: 'DenyListed' },
    }));
    const bebop = new Bebop(network, dexKey, dexHelper);

    const error = await getDexParam(bebop, {}, { preProcess }).catch(e => e);

    expect(error.code).toBe('PREPROCESS_FAILED');
    expect(error.originalError).toBeInstanceOf(BlacklistError);
    expect(error.originalError.reason).toBe('DENY_LISTED');
    expect(error.originalError.user).toBe(userAddress);
  });

  it('throws when there is neither order build nor preProcess context', async () => {
    const dexHelper = new DummyDexHelper(network);
    const getMock = jest.fn();
    (dexHelper.httpRequest.get as any) = getMock;
    const bebop = new Bebop(network, dexKey, dexHelper);

    await expect(getDexParam(bebop, {})).rejects.toMatchObject({
      name: 'GetDexParamPreProcessError',
      code: 'MISSING_CONTEXT',
    });
    expect(getMock).not.toHaveBeenCalled();
  });

  it('reports the failure that restricts the dex as a RestrictedError', async () => {
    const dexHelper = new DummyDexHelper(network);
    (dexHelper.httpRequest.get as any) = jest.fn(async () => ({
      error: { errorCode: 999, message: 'no liquidity' },
    }));
    const bebop = new Bebop(network, dexKey, dexHelper);

    const errors = [];
    for (let i = 0; i < 10; i++) {
      errors.push(await getDexParam(bebop, {}, { preProcess }).catch(e => e));
    }

    // bebop restricts on its 10th failure within the window
    for (const error of errors.slice(0, 9)) {
      expect(error.originalError).not.toBeInstanceOf(RestrictedError);
    }
    expect(errors[9].code).toBe('PREPROCESS_FAILED');
    expect(errors[9].originalError).toBeInstanceOf(RestrictedError);
    // keeps the request and quote ids the plain error carried
    expect(errors[9].originalError.message).toContain('requestId:');
    expect(errors[9].originalError.message).toContain('no liquidity');
    expect(await bebop.isRestricted()).toBe(true);
  });

  it('does not restrict on a DenyListed quote', async () => {
    const dexHelper = new DummyDexHelper(network);
    (dexHelper.httpRequest.get as any) = jest.fn(async () => ({
      error: { errorCode: 112, message: 'DenyListed' },
    }));
    const bebop = new Bebop(network, dexKey, dexHelper);

    for (let i = 0; i < 10; i++) {
      const error = await getDexParam(bebop, {}, { preProcess }).catch(e => e);
      expect(error.originalError).toBeInstanceOf(BlacklistError);
    }
    expect(await bebop.isRestricted()).toBe(false);
  });
});
