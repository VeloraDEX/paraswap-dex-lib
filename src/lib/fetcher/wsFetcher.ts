import { Logger } from 'log4js';
import { RequestConfig, Response } from '../../dex-helper/irequest-wrapper';
import WebSocket from 'ws';
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

export class WebSocketFetcher<T> {
  private requests: RequestInfoWithHandler<T>;
  // Time to wait before declaring connection as broken and restarting it
  private timeoutInterval: number;
  // Time to wait after disconnection before reconnecting
  private reconnectDelay: number;
  private pingTimeout: NodeJS.Timeout | undefined = undefined;
  public lastFetchSucceeded: boolean = false;
  private stop: boolean = true;
  private connection: WebSocket | null = null;

  constructor(
    requestsInfo: RequestInfoWithHandler<T>,
    private logger: Logger,
    timeoutInterval: number = 10000,
    reconnectDelay: number = 5000,
  ) {
    this.requests = requestsInfo;
    this.timeoutInterval = timeoutInterval;
    this.reconnectDelay = reconnectDelay;
  }

  private connected() {
    this.logger.info(`Connected to ${this.requests.info.requestOptions.url}`);
    this.heartbeat();
  }

  private heartbeat() {
    clearTimeout(this.pingTimeout);
    this.pingTimeout = setTimeout(() => {
      this.logger.warn('No heartbeat. Terminating Connection...');
      this?.connection?.terminate();
    }, this.timeoutInterval);
  }

  private onClose() {
    this.logger.info(`Connection closed.`);
    // Do not reconnect if polling is stopped
    if (this.stop) {
      clearTimeout(this.pingTimeout);
      return;
    }

    this.logger.info(`Unexpected closure, Reconnecting...`);
    this.reconnectWithDelay();
  }

  private onError(error: any) {
    this.logger.error(
      `Websocket Error: ${error.toString()}. Stopping & Reconnecting...`,
    );
    this?.connection?.terminate();
  }

  private onMessage(data: WebSocket.RawData) {
    this.heartbeat();
    const reqInfo = this.requests;
    const info = reqInfo.info;
    const options = reqInfo.info.requestOptions;
    this.logger.debug(`(${options.url}) received new data`);

    try {
      const parsedData = info.caster(data);
      reqInfo.handler(parsedData);
    } catch (e) {
      this.logger.info(e);
      this.logger.info(
        `(${options.url}) received incorrect data ${JSON.stringify(
          data,
        ).replace(/(?:\r\n|\r|\n)/g, ' ')}`,
        e,
      );
      return;
    }
  }

  private connect() {
    const authorization =
      this.requests.info.requestOptions.headers!.authorization;
    const name = this.requests.info.requestOptions.headers!.name;
    if (typeof authorization !== 'string') {
      throw new Error('Authorization header is not a string');
    }
    if (typeof name !== 'string') {
      throw new Error('Name header is not a string');
    }
    this.logger.info(
      `Connecting to ${this.requests.info.requestOptions.url}...`,
    );
    const ws = new WebSocket(this.requests.info.requestOptions.url!, {
      headers: {
        Authorization: authorization,
        name: name,
      },
    });

    ws.on('open', this.connected.bind(this));
    ws.on('message', this.onMessage.bind(this));
    ws.on('error', this.onError.bind(this));
    ws.on('close', this.onClose.bind(this));
    this.connection = ws;
  }

  reconnectWithDelay() {
    this.logger.info(`Waiting ${this.reconnectDelay}ms before reconnecting...`);
    clearTimeout(this.pingTimeout);
    setTimeout(() => {
      this.reconnect();
    }, this.reconnectDelay);
  }

  reconnect() {
    clearTimeout(this.pingTimeout);
    this.connect();
    this.logger.info(
      `Connection started for ${this.requests.info.requestOptions.url}`,
    );
  }

  startPolling(): void {
    this.stop = false;
    this.reconnect();
  }

  stopPolling() {
    this.stop = true;
    this.connection?.terminate();
    this.logger.info(
      `Connection stopped for ${this.requests.info.requestOptions.url}`,
    );
  }

  isPolling(): boolean {
    return !this.stop;
  }
}
