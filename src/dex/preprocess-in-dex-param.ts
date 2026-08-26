import { AsyncOrSync } from 'ts-essentials';
import BigNumber from 'bignumber.js';
import { OptimalSwapExchange } from '@paraswap/core';
import { SwapSide } from '../constants';
import {
  ExchangeTxInfo,
  GetDexParamOptions,
  GetDexParamPreProcessOptions,
  NumberAsString,
  PreprocessTransactionOptions,
  Token,
} from '../types';

export type PreProcessTransactionFn<T> = (
  optimalSwapExchange: OptimalSwapExchange<T>,
  srcToken: Token,
  destToken: Token,
  side: SwapSide,
  options: PreprocessTransactionOptions,
) => AsyncOrSync<[OptimalSwapExchange<T>, ExchangeTxInfo]>;

export type GetDexParamPreProcessErrorCode =
  // getDexParam was called with neither a built order nor the context to build one
  | 'MISSING_CONTEXT'
  // options.preProcess is present but malformed
  | 'INVALID_CONTEXT'
  // the dex's own preProcessTransaction threw — see `originalError`
  | 'PREPROCESS_FAILED'
  // preProcessTransaction resolved without exchange data
  | 'MISSING_DATA';

// Single error type for every failure of the lazy preProcessTransaction that
// getDexParam runs itself. Without it these surface as whatever the dex happened
// to throw, indistinguishable from an encoding failure, which makes a build-time
// RFQ failure impossible to attribute. `originalError` keeps the underlying error
// (SlippageCheckError, BlacklistError, ...) reachable — see unwrapPreProcessError.
export class GetDexParamPreProcessError extends Error {
  isGetDexParamPreProcessError = true;
  cause = 'GetDexParamPreProcessError';

  constructor(
    public dexKey: string,
    public side: SwapSide,
    public code: GetDexParamPreProcessErrorCode,
    message: string,
    public originalError?: unknown,
  ) {
    super(
      `Error_${dexKey}_getDexParam preProcess ${code} on ${side}: ${message}`,
    );
    this.name = 'GetDexParamPreProcessError';
  }
}

// Callers that branch on the underlying RFQ error (`instanceof SlippageCheckError`,
// blacklist codes, ...) should unwrap first: the lazy path reports everything as
// GetDexParamPreProcessError.
export function unwrapPreProcessError(error: unknown): unknown {
  return error instanceof GetDexParamPreProcessError && error.originalError
    ? error.originalError
    : error;
}

const describeError = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

function toPreprocessTransactionOptions(
  dexKey: string,
  side: SwapSide,
  preProcess: GetDexParamPreProcessOptions,
): PreprocessTransactionOptions {
  const {
    srcToken,
    destToken,
    srcAmount,
    destAmount,
    slippageFactor,
    ...rest
  } = preProcess;

  // The payload crosses an HTTP boundary that does not validate it. A garbage
  // slippage would only blow up in the slippage check *after* the firm quote
  // was already requested, wasting an RFQ and possibly restricting the pair.
  const parsedSlippageFactor = new BigNumber(slippageFactor);
  if (
    !parsedSlippageFactor.isFinite() ||
    parsedSlippageFactor.isLessThanOrEqualTo(0)
  ) {
    throw new GetDexParamPreProcessError(
      dexKey,
      side,
      'INVALID_CONTEXT',
      `options.preProcess.slippageFactor is not a positive number: ${slippageFactor}`,
    );
  }

  return { ...rest, slippageFactor: parsedSlippageFactor };
}

// getDexParam has to be self-sufficient: it can be called standalone (over HTTP)
// without the caller running the preProcessTransaction step first. When the
// order build is missing from the exchange data, it is produced here from the
// context the caller passed in `options.preProcess`.
export async function resolvePreProcessedData<T>({
  dexKey,
  data,
  side,
  isPreProcessed,
  preProcessTransaction,
  options,
}: {
  dexKey: string;
  data: T;
  side: SwapSide;
  isPreProcessed: boolean;
  preProcessTransaction: PreProcessTransactionFn<T>;
  options?: GetDexParamOptions;
}): Promise<{ data: T; minDeadline?: NumberAsString }> {
  if (isPreProcessed) return { data };

  const { preProcess } = options ?? {};

  if (!preProcess) {
    throw new GetDexParamPreProcessError(
      dexKey,
      side,
      'MISSING_CONTEXT',
      'payload is not received: neither preProcessTransaction was called ' +
        'before nor options.preProcess was provided to build it',
    );
  }

  const preprocessOptions = toPreprocessTransactionOptions(
    dexKey,
    side,
    preProcess,
  );

  let preProcessedSwapExchange: OptimalSwapExchange<T>;
  let txInfo: ExchangeTxInfo;

  try {
    [preProcessedSwapExchange, txInfo] = await preProcessTransaction(
      {
        exchange: dexKey,
        srcAmount: preProcess.srcAmount,
        destAmount: preProcess.destAmount,
        percent: 100,
        data,
      },
      preProcess.srcToken,
      preProcess.destToken,
      side,
      preprocessOptions,
    );
  } catch (e) {
    // The dex already logged and applied its own restrictions before rethrowing;
    // this only re-labels the failure so the caller can tell a build-time RFQ
    // failure apart from an encoding one.
    throw new GetDexParamPreProcessError(
      dexKey,
      side,
      'PREPROCESS_FAILED',
      describeError(e),
      e,
    );
  }

  if (preProcessedSwapExchange.data === undefined) {
    throw new GetDexParamPreProcessError(
      dexKey,
      side,
      'MISSING_DATA',
      'preProcessTransaction returned no data',
    );
  }

  return {
    data: preProcessedSwapExchange.data,
    minDeadline: txInfo.deadline?.toString(),
  };
}
