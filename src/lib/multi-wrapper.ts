import { BytesLike } from 'ethers';
import _ from 'lodash';
import { Logger } from 'log4js';
import { Contract } from 'web3-eth-contract';

export type MultiResult<T> = {
  success: boolean;
  returnData: T;
};

export type MultiCallParams<T> = {
  target: string;
  callData: string;
  decodeFunction: (str: MultiResult<BytesLike> | BytesLike) => T;
  cb?: (data: T) => void;
};

export class MultiWrapper {
  readonly defaultBatchSize: number;

  /* eslint-disable-next-line */
  constructor(private multi: Contract, private logger: Logger) {
    this.defaultBatchSize = 500;
  }

  async aggregate<T>(
    calls: MultiCallParams<T>[],
    blockNumber?: number | string,
    batchSize: number = this.defaultBatchSize,
  ): Promise<T[]> {
    const aggregatedResult = await Promise.all(
      _.chunk(calls, batchSize).map(async batch =>
        this.multi.methods.aggregate(batch).call(undefined, blockNumber),
      ),
    );

    let globalInd = 0;
    const resultsUndecoded: string[] = new Array(calls.length);
    for (const res of aggregatedResult) {
      for (const element of res.returnData) {
        resultsUndecoded[globalInd++] = element;
      }
    }

    const results: T[] = new Array(resultsUndecoded.length);
    for (const [i, undecodedElement] of resultsUndecoded.entries()) {
      results[i] = calls[i].decodeFunction(undecodedElement);
      calls[i].cb?.(results[i]);
    }

    return results;
  }

  async tryAggregate<T>(
    mandatory: boolean,
    calls: MultiCallParams<T>[],
    blockNumber?: number | string,
    batchSize: number = this.defaultBatchSize,
    reportFails: boolean = true,
  ): Promise<MultiResult<T>[]> {
    const allCalls = new Array(Math.ceil(calls.length / batchSize));
    for (let i = 0; i < calls.length; i += batchSize) {
      const batch = calls.slice(i, i + batchSize);
      allCalls[Math.floor(i / batchSize)] = batch;
    }

    if (allCalls.length > 25) {
      this.logger.warn(
        `MultiWrapper.tryAggregate: Number of batches (${
          allCalls.length
        }) exceeds 25 (total calls ${
          calls.length
        }), this may lead to performance issues. First call: ${JSON.stringify(
          calls[0],
        )}`,
      );
    }

    const aggregatedResult = await Promise.all(
      allCalls.map(batch =>
        this.multi.methods
          .tryAggregate(mandatory, batch)
          .call(undefined, blockNumber),
      ),
    );

    let globalInd = 0;
    const resultsUndecoded: MultiResult<string>[] = new Array(calls.length);
    for (const res of aggregatedResult) {
      for (const element of res) {
        resultsUndecoded[globalInd++] = element;
      }
    }

    const results: MultiResult<T>[] = new Array(resultsUndecoded.length);
    for (const [i, undecodedElement] of resultsUndecoded.entries()) {
      if (!undecodedElement.success) {
        if (reportFails) {
          this.logger.error(
            `Multicall request number ${i} for ${calls[i].target} with data ${calls[i].callData} on ${blockNumber} failed`,
          );
        }

        results[i] = {
          success: false,
        } as MultiResult<T>;
        continue;
      }

      results[i] = {
        success: true,
        returnData: calls[i].decodeFunction(undecodedElement.returnData),
      } as MultiResult<T>;

      calls[i].cb?.(results[i].returnData);
    }

    return results;
  }
}
