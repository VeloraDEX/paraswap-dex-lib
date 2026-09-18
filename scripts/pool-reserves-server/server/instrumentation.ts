import log4js from 'log4js';
import { IDexHelper } from '../../../src/dex-helper';

export type RpcCounters = {
  jsonRpcRequests: number;
  multicallCalls: number;
  multicallSubCalls: number;
};

// Counts network-level JSON-RPC requests (ethers + web3 providers) and
// MultiWrapper aggregate/tryAggregate invocations with their sub-call
// totals. Counters are process-wide for the helper they are installed on;
// callers take deltas around the phase they measure.
export class RpcMeter {
  readonly counters: RpcCounters = {
    jsonRpcRequests: 0,
    multicallCalls: 0,
    multicallSubCalls: 0,
  };

  install(dexHelper: IDexHelper): void {
    const provider = dexHelper.provider as unknown as {
      send: (method: string, params: unknown[]) => Promise<unknown>;
    };
    const ethersSend = provider.send.bind(provider);
    provider.send = (method, params) => {
      this.counters.jsonRpcRequests++;
      return ethersSend(method, params);
    };

    const web3Provider = dexHelper.web3Provider.currentProvider as unknown as {
      send?: (payload: unknown, cb: unknown) => unknown;
    } | null;
    if (web3Provider?.send) {
      const web3Send = web3Provider.send.bind(web3Provider);
      web3Provider.send = (payload, cb) => {
        this.counters.jsonRpcRequests += Array.isArray(payload)
          ? payload.length
          : 1;
        return web3Send(payload, cb);
      };
    }

    for (const wrapper of [
      dexHelper.multiWrapper,
      dexHelper.multiNonZeroSenderWrapper,
    ]) {
      const w = wrapper as unknown as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      const aggregate = w.aggregate.bind(wrapper);
      w.aggregate = (calls: unknown, ...rest: unknown[]) => {
        this.count(calls);
        return aggregate(calls, ...rest);
      };
      const tryAggregate = w.tryAggregate.bind(wrapper);
      w.tryAggregate = (
        mandatory: unknown,
        calls: unknown,
        ...rest: unknown[]
      ) => {
        this.count(calls);
        return tryAggregate(mandatory, calls, ...rest);
      };
    }
  }

  private count(calls: unknown) {
    this.counters.multicallCalls++;
    if (Array.isArray(calls)) this.counters.multicallSubCalls += calls.length;
  }

  snapshot(): RpcCounters {
    return { ...this.counters };
  }

  static delta(before: RpcCounters, after: RpcCounters): RpcCounters {
    return {
      jsonRpcRequests: after.jsonRpcRequests - before.jsonRpcRequests,
      multicallCalls: after.multicallCalls - before.multicallCalls,
      multicallSubCalls: after.multicallSubCalls - before.multicallSubCalls,
    };
  }
}

const MAX_CAPTURED = 200;

const format = (data: unknown[]): string =>
  data
    .map(d => {
      if (d instanceof Error) return d.message;
      if (typeof d === 'string') return d;
      try {
        return JSON.stringify(d);
      } catch (e) {
        return String(d);
      }
    })
    .join(' ')
    .slice(0, 500);

export type CaptureWindow = { lines: string[] };

// Captures warn/error lines from every log4js category while at least one
// window is open. dex-lib swallows RPC failures into logs, so this is the
// only place they surface for the report. Windows are independent: an event
// lands in every open window, so concurrent chains see an upper bound
// rather than losing each other's lines.
export class LogCapture {
  private readonly windows = new Set<CaptureWindow>();

  install(stdoutLevel: string): void {
    const capture = {
      configure: () => (event: log4js.LoggingEvent) => {
        if (this.windows.size === 0) return;
        if (event.level.level < log4js.levels.WARN.level) return;
        const line = `[${event.level.levelStr}] ${event.categoryName}: ${format(
          event.data,
        )}`;
        for (const w of this.windows) {
          if (w.lines.length < MAX_CAPTURED) w.lines.push(line);
        }
      },
    };
    log4js.configure({
      appenders: {
        stdout: { type: 'stdout' },
        out: { type: 'logLevelFilter', appender: 'stdout', level: stdoutLevel },
        capture: { type: capture },
      },
      categories: {
        default: { appenders: ['out', 'capture'], level: 'debug' },
      },
    });
  }

  open(): CaptureWindow {
    const w: CaptureWindow = { lines: [] };
    this.windows.add(w);
    return w;
  }

  close(w: CaptureWindow): string[] {
    this.windows.delete(w);
    return w.lines;
  }
}
