import dotenv from 'dotenv';
dotenv.config();

import BigNumber from 'bignumber.js';
import { ParaSwapVersion } from '@paraswap/core';
import { DummyDexHelper } from '../dex-helper/index';
import { Network, SwapSide } from '../constants';
import { Tokens } from '../../tests/constants-e2e';
import { GetDexParamPreProcessOptions } from '../types';
import {
  BlacklistError,
  PairRestrictedError,
  RFQConfig,
  SlippageCheckError,
  TooStrictSlippageCheckError,
} from './generic-rfq/types';
import { Dexalot } from './dexalot/dexalot';
import { SwaapV2 } from './swaap-v2/swaap-v2';
import { GenericRFQ } from './generic-rfq/generic-rfq';

const network = Network.ARBITRUM;
const tokens = Tokens[network];
const userAddress = '0x5Bad996643a924De21b6b2875c85C33F3c5bBcB6';
const executorAddress = '0x6A000F20005980200259B80c5102003040001068';

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

const axiosError = (message: string, extra: Record<string, unknown>) =>
  Object.assign(new Error(message), { isAxiosError: true, ...extra });

const timeoutError = () =>
  axiosError('timeout of 1000ms exceeded', { code: 'ECONNABORTED' });

const slippageArgs = [
  network,
  SwapSide.SELL,
  '1000000000',
  '900000000',
  new BigNumber('0.99'),
] as const;

const newDummyDexHelper = () => {
  const dexHelper = new DummyDexHelper(network);
  dexHelper.config.data.dexalotAuthToken = 'test-key';
  dexHelper.config.data.swaapV2AuthToken = 'test-key';
  const rawset = jest.spyOn(dexHelper.cache, 'rawset');
  return { dexHelper, rawset };
};

const getDexParam = (dex: { getDexParam: Function }) =>
  dex
    .getDexParam(
      tokens['WETH'].address,
      tokens['USDC'].address,
      preProcess.srcAmount,
      '1',
      userAddress,
      {},
      SwapSide.SELL,
      executorAddress,
      { preProcess },
    )
    .catch((e: any) => e);

const fetcherParams = {
  reqParams: { url: 'http://localhost/none', method: 'GET' as const },
  secret: { domain: 'test', accessKey: 'access', secretKey: 'secret' },
  intervalMs: 60_000,
  dataTTLS: 60,
};

const rfqConfig: RFQConfig = {
  maker: userAddress,
  tokensConfig: fetcherParams,
  pairsConfig: fetcherParams,
  rateConfig: fetcherParams,
  firmRateConfig: {
    url: 'http://localhost/firm',
    method: 'POST',
    secret: fetcherParams.secret,
  },
  minTradeUsd: null,
};

describe('Dexalot pair restriction on getDexParam', () => {
  const build = (failure: unknown) => {
    const { dexHelper, rawset } = newDummyDexHelper();
    (dexHelper.httpRequest.post as any) = jest.fn(async () => {
      throw failure;
    });
    return { dex: new Dexalot(network, 'Dexalot', dexHelper), rawset };
  };

  it('reports the failure that restricts the pair as a PairRestrictedError', async () => {
    const { dex, rawset } = build(new Error('no liquidity'));

    const error = await getDexParam(dex);

    expect(error.code).toBe('PREPROCESS_FAILED');
    expect(error.originalError).toBeInstanceOf(PairRestrictedError);
    expect(error.originalError.reason).toBeUndefined();
    expect(error.originalError.message).toContain('no liquidity');
    expect(
      await dex.isRestrictedPair(
        tokens['USDC'].address,
        tokens['WETH'].address,
      ),
    ).toBe(true);
    expect(rawset).toHaveBeenCalledWith(
      dex.getRestrictedPairCacheKey(
        tokens['WETH'].address,
        tokens['USDC'].address,
      ),
      expect.anything(),
      30 * 60,
    );
  });

  it('does not restrict on a too strict slippage', async () => {
    const { dex } = build(
      new TooStrictSlippageCheckError('Dexalot', ...slippageArgs),
    );

    const error = await getDexParam(dex);

    expect(error.originalError).toBeInstanceOf(TooStrictSlippageCheckError);
    expect(
      await dex.isRestrictedPair(
        tokens['WETH'].address,
        tokens['USDC'].address,
      ),
    ).toBe(false);
  });

  it('does not restrict when the API refuses the user', async () => {
    const { dex } = build(
      axiosError('Request failed', {
        response: { status: 400, data: { ReasonCode: 'FQ-009' } },
      }),
    );

    const error = await getDexParam(dex);

    expect(error.originalError).toBeInstanceOf(BlacklistError);
    expect(
      await dex.isRestrictedPair(
        tokens['WETH'].address,
        tokens['USDC'].address,
      ),
    ).toBe(false);
  });
});

describe('SwaapV2 pair restriction on getDexParam', () => {
  const build = (failure: unknown) => {
    const { dexHelper, rawset } = newDummyDexHelper();
    const dex = new SwaapV2(network, 'SwaapV2', dexHelper);
    const getQuote = jest.fn(async () => {
      throw failure;
    });
    (dex as any).rateFetcher.getQuote = getQuote;
    const notify = jest.fn(async () => ({ success: true }));
    (dex as any).rateFetcher.notify = notify;
    return { dex, rawset, notify, getQuote };
  };

  it('restricts the pair and notifies Swaap before reporting PairRestrictedError', async () => {
    const { dex, rawset, notify } = build(new Error('bad calldata'));

    const error = await getDexParam(dex);

    expect(error.originalError).toBeInstanceOf(PairRestrictedError);
    expect(error.originalError.message).toContain('bad calldata');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(rawset).toHaveBeenCalledWith(
      expect.stringContaining('_restricted_pair_'),
      expect.anything(),
      30 * 60,
    );
  });

  it.each([
    ['a timeout', timeoutError()],
    ['a 5xx', axiosError('Request failed', { response: { status: 503 } })],
    [
      'a too strict slippage',
      new TooStrictSlippageCheckError('SwaapV2', ...slippageArgs),
    ],
  ])('does not restrict on %s', async (_, failure) => {
    const { dex, notify, getQuote } = build(failure);

    const error = await getDexParam(dex);

    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(error.originalError).toBe(failure);
    expect(notify).not.toHaveBeenCalled();
    expect(
      await dex.isRestrictedPair(
        tokens['WETH'].address,
        tokens['USDC'].address,
      ),
    ).toBe(false);
  });
});

describe('GenericRFQ pair restriction on getDexParam', () => {
  const build = (failure: unknown) => {
    const { dexHelper, rawset } = newDummyDexHelper();
    const dex = new GenericRFQ(network, 'ParaSwapPool1', dexHelper, rfqConfig);
    (dex as any).rateFetcher.getFirmRate = jest.fn(async () => {
      throw failure;
    });
    return { dex, rawset };
  };

  it('restricts the pair for 15 minutes on a failed firm quote', async () => {
    const { dex, rawset } = build(new Error('maker refused'));

    const error = await getDexParam(dex);

    expect(error.originalError).toBeInstanceOf(PairRestrictedError);
    expect(error.originalError.reason).toBeUndefined();
    expect(rawset).toHaveBeenCalledWith(
      expect.stringContaining('_restricted_pair_'),
      expect.anything(),
      15 * 60,
    );
  });

  it('restricts the pair for 5 minutes on a timeout and says so', async () => {
    const { dex, rawset } = build(timeoutError());

    const error = await getDexParam(dex);

    expect(error.originalError).toBeInstanceOf(PairRestrictedError);
    expect(error.originalError.reason).toBe('TIMEOUT');
    expect(rawset).toHaveBeenCalledWith(
      expect.stringContaining('_restricted_pair_'),
      expect.anything(),
      5 * 60,
    );
  });

  it.each([
    [
      'a 403',
      axiosError('Request failed', { response: { status: 403 } }),
      BlacklistError,
    ],
    [
      'a slippage',
      new SlippageCheckError('ParaSwapPool1', ...slippageArgs),
      SlippageCheckError,
    ],
  ])('does not restrict on %s', async (_, failure, expected) => {
    const { dex, rawset } = build(failure);

    const error = await getDexParam(dex);

    expect(error.originalError).toBeInstanceOf(expected);
    expect(rawset).not.toHaveBeenCalledWith(
      expect.stringContaining('_restricted_pair_'),
      expect.anything(),
      expect.anything(),
    );
  });
});
