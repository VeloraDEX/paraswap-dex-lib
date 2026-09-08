import BigNumber from 'bignumber.js';
import { ParaSwapVersion } from '@paraswap/core';
import { SwapSide } from '../constants';
import {
  ExchangeTxInfo,
  GetDexParamPreProcessOptions,
  OptimalSwapExchange,
} from '../types';
import {
  GetDexParamPreProcessError,
  resolvePreProcessedData,
  unwrapPreProcessError,
} from './preprocess-in-dex-param';

type TestData = { order?: string };

const DEX_KEY = 'TestRfq';

const srcToken = { address: '0xsrc', decimals: 18 };
const destToken = { address: '0xdest', decimals: 6 };

const preProcess: GetDexParamPreProcessOptions = {
  slippageFactor: '0.995',
  txOrigin: '0xorigin',
  userAddress: '0xuser',
  executionContractAddress: '0xexecutor',
  recipient: '0xrecipient',
  version: ParaSwapVersion.V6,
  srcToken,
  destToken,
  srcAmount: '1000',
  destAmount: '2000',
};

describe('resolvePreProcessedData', () => {
  it('returns the data untouched when it is already pre processed', async () => {
    const preProcessTransaction = jest.fn();
    const data: TestData = { order: 'already-built' };

    const result = await resolvePreProcessedData<TestData>({
      dexKey: DEX_KEY,
      data,
      side: SwapSide.SELL,
      isPreProcessed: true,
      preProcessTransaction,
      options: { preProcess },
    });

    expect(preProcessTransaction).not.toHaveBeenCalled();
    expect(result.data).toBe(data);
    expect(Object.keys(result)).toEqual(['data']);
  });

  it('builds the order from options.preProcess when it is missing', async () => {
    const preProcessTransaction = jest.fn(
      async (
        optimalSwapExchange: OptimalSwapExchange<TestData>,
      ): Promise<[OptimalSwapExchange<TestData>, ExchangeTxInfo]> => [
        { ...optimalSwapExchange, data: { order: 'built-lazily' } },
        { deadline: 1234567890n },
      ],
    );

    const result = await resolvePreProcessedData<TestData>({
      dexKey: DEX_KEY,
      data: {},
      side: SwapSide.BUY,
      isPreProcessed: false,
      preProcessTransaction,
      options: { preProcess },
    });

    expect(preProcessTransaction).toHaveBeenCalledTimes(1);

    const [swapExchange, passedSrcToken, passedDestToken, side, options] =
      preProcessTransaction.mock.calls[0] as any[];

    // the real per-exchange amounts, not the ones getDexParam receives
    expect(swapExchange.srcAmount).toBe('1000');
    expect(swapExchange.destAmount).toBe('2000');
    expect(swapExchange.exchange).toBe(DEX_KEY);
    expect(passedSrcToken).toBe(srcToken);
    expect(passedDestToken).toBe(destToken);
    expect(side).toBe(SwapSide.BUY);
    expect(BigNumber.isBigNumber(options.slippageFactor)).toBe(true);
    expect(options.slippageFactor.toFixed()).toBe('0.995');
    expect(options.txOrigin).toBe('0xorigin');
    expect(options).not.toHaveProperty('srcToken');

    expect(result.data).toEqual({ order: 'built-lazily' });
    expect(result.minDeadline).toBe('1234567890');
  });

  it('throws MISSING_CONTEXT when there is neither built order nor context', async () => {
    const error = await resolvePreProcessedData<TestData>({
      dexKey: DEX_KEY,
      data: {},
      side: SwapSide.SELL,
      isPreProcessed: false,
      preProcessTransaction: jest.fn(),
      options: { nowTimestampMs: 1 },
    }).catch(e => e);

    expect(error).toBeInstanceOf(GetDexParamPreProcessError);
    expect(error.code).toBe('MISSING_CONTEXT');
    expect(error.dexKey).toBe(DEX_KEY);
    expect(error.side).toBe(SwapSide.SELL);
  });

  it.each(['', 'not-a-number', 'Infinity', '0', '-0.5'])(
    'rejects a non-positive slippageFactor (%s) before requesting a quote',
    async slippageFactor => {
      const preProcessTransaction = jest.fn();

      await expect(
        resolvePreProcessedData<TestData>({
          dexKey: DEX_KEY,
          data: {},
          side: SwapSide.SELL,
          isPreProcessed: false,
          preProcessTransaction,
          options: { preProcess: { ...preProcess, slippageFactor } },
        }),
      ).rejects.toMatchObject({
        name: 'GetDexParamPreProcessError',
        code: 'INVALID_CONTEXT',
      });

      expect(preProcessTransaction).not.toHaveBeenCalled();
    },
  );

  it('throws MISSING_DATA when preProcessTransaction returns no data', async () => {
    await expect(
      resolvePreProcessedData<TestData>({
        dexKey: DEX_KEY,
        data: {},
        side: SwapSide.SELL,
        isPreProcessed: false,
        preProcessTransaction: async optimalSwapExchange => [
          { ...optimalSwapExchange, data: undefined },
          {},
        ],
        options: { preProcess },
      }),
    ).rejects.toMatchObject({ code: 'MISSING_DATA' });
  });

  it('wraps a failing preProcessTransaction and keeps the original error', async () => {
    class RfqFailure extends Error {
      isSlippageError = true;
    }
    const originalError = new RfqFailure('quote rejected');

    const error = await resolvePreProcessedData<TestData>({
      dexKey: DEX_KEY,
      data: {},
      side: SwapSide.SELL,
      isPreProcessed: false,
      preProcessTransaction: async () => {
        throw originalError;
      },
      options: { preProcess },
    }).catch(e => e);

    expect(error).toBeInstanceOf(GetDexParamPreProcessError);
    expect(error.code).toBe('PREPROCESS_FAILED');
    // the underlying reason stays visible in the message...
    expect(error.message).toContain('quote rejected');
    // ...and the original error stays reachable for callers that branch on it
    expect(error.originalError).toBe(originalError);
    expect(unwrapPreProcessError(error)).toBe(originalError);
  });

  it('unwrapPreProcessError passes through anything it did not wrap', () => {
    const plain = new Error('unrelated');

    expect(unwrapPreProcessError(plain)).toBe(plain);
  });
});
