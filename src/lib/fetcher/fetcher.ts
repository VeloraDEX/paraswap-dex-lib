import { isFunction } from 'lodash';
import { Logger } from 'log4js';
import { IRequestWrapper } from '../../dex-helper';
import { RequestConfig, Response } from '../../dex-helper/irequest-wrapper';

const FETCH_TIMEOUT_MS = 10 * 1000;
const FETCH_FAIL_MAX_ATTEMPT = 5;
const FETCH_FAIL_RETRY_TIMEOUT_MS = 60 * 1000;

export class SkippingRequest {
  constructor(public message = '') {}
}

export type RequestInfo<T> = {
  requestFunc?: (
    options: RequestConfig,
  ) => Promise<Response<T> | SkippingRequest>;
  requestOptions: RequestConfig;
  caster: (data: unknown) => T;
  authenticate?: (options: RequestConfig) => RequestConfig;
  excludedFieldsCaching?: string[];
};

export type RequestInfoWithHandler<T> = {
  info: RequestInfo<T>;
  handler: (data: T) => void;
};

export class Fetcher<T> {
  private requests: RequestInfoWithHandler<T>[];
  public lastFetchSucceeded: boolean = false;
  private failedCount = 0;
  private stop: boolean = true;

  constructor(
    private requestWrapper: IRequestWrapper,
    requestsInfo: RequestInfoWithHandler<T> | RequestInfoWithHandler<T>[],
    private pollIntervalMs: number,
    private logger: Logger,
  ) {
    if (Array.isArray(requestsInfo)) {
      this.requests = requestsInfo;
    } else {
      this.requests = [requestsInfo];
    }
  }

  async fetch(force: boolean = false) {
    if (this.stop === true && !force) {
      return;
    }

    if (this.failedCount >= FETCH_FAIL_MAX_ATTEMPT) {
      this.stopPolling();

      setTimeout(() => {
        this.startPolling();
        this.failedCount = 0;
      }, FETCH_FAIL_RETRY_TIMEOUT_MS);
      return;
    }

    const promises = this.requests.map<
      Promise<Error | Response<T> | SkippingRequest>
    >(async (reqInfo: RequestInfoWithHandler<T>) => {
      const info = reqInfo.info;
      let options = info.requestOptions;

      if (info.authenticate) {
        info.authenticate(options);
      }

      try {
        let result;
        if (isFunction(info.requestFunc)) {
          result = await info.requestFunc({
            timeout: FETCH_TIMEOUT_MS,
            ...options,
          });
        } else {
          result = await this.requestWrapper.request({
            timeout: FETCH_TIMEOUT_MS,
            ...options,
          });
        }

        return result;
      } catch (e) {
        return e as Error;
      }
    });
    const results = await Promise.all(promises);
    const failures = results
      .map((_, i) => i)
      .filter(i => results[i] instanceof Error);

    const skipped = results
      .map((_, i) => i)
      .filter(i => results[i] instanceof SkippingRequest);

    results.map(result => {
      if (!(result instanceof Error || result instanceof SkippingRequest)) {
        this.logger.info(
          'Results Data:',
          JSON.stringify((result as any).data)
            .replace(/(?:\r\n|\r|\n)/g, ' ')
            .substring(0, 1000),
        );
      }
    });

    skipped.forEach(i => {
      const skippedRes = results[i] as SkippingRequest;
      this.logger.warn(
        `skipped request ${this.requests[i].info.requestOptions.url} ${skippedRes.message}`,
      );
    });

    failures.forEach(i => {
      const error = results[i];
      const errorDetails =
        error instanceof AggregateError
          ? error.errors.map(e => String(e)).join('; ')
          : String(error);

      this.logger.warn(
        `failed polling ${this.requests[i].info.requestOptions.url} ${errorDetails}`,
      );
    });

    if (failures.length === results.length) {
      this.lastFetchSucceeded = false;
      this.failedCount += 1;
    } else {
      this.lastFetchSucceeded = true;
    }

    results
      .map((_, i) => i)
      .filter(
        i =>
          !(
            results[i] instanceof Error || results[i] instanceof SkippingRequest
          ),
      )
      .forEach(i => {
        const response = results[i] as Response<T>;
        const reqInfo = this.requests[i];
        const info = reqInfo.info;
        const options = reqInfo.info.requestOptions;
        this.logger.debug(`(${options.url}) received new data`);

        try {
          const parsedData = info.caster(response.data);
          reqInfo.handler(parsedData);
        } catch (e) {
          this.logger.info(
            `(${options.url}) received incorrect data ${JSON.stringify(
              response.data,
            ).replace(/(?:\r\n|\r|\n)/g, ' ')}`,
            e,
          );
          return;
        }
      });
    setTimeout(this.fetch.bind(this), this.pollIntervalMs);

    return failures;
  }

  private getUrls(): string[] {
    return this.requests.map(el => el.info.requestOptions.url!);
  }

  startPolling(): void {
    this.stop = false;
    this.logger.info(`Polling started for ${this.getUrls()}`);
    this.fetch();
  }

  stopPolling() {
    this.stop = true;
    this.logger.info(`Polling stopped for ${this.getUrls()}`);
  }

  isPolling(): boolean {
    return !this.stop;
  }
}
