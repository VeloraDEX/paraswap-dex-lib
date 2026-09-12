/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { MAX_POOL_RESERVES_BATCH } from '../../../src/constants';
import { PoolReservesRequestError } from '../../../src/lib/pools-storage/reserves';
import { ChainContext } from './chain-context';
import { LogCapture } from './instrumentation';
import { verifyDex } from './verify';

const env = (name: string, fallback: string) => process.env[name] ?? fallback;

const config = {
  redisUrl: env('POOL_RESERVES_REDIS_URL', 'redis://127.0.0.1:6399'),
  port: Number(env('POOL_RESERVES_PORT', '3400')),
  chains: env('POOL_RESERVES_CHAINS', '1,8453').split(',').map(Number),
  masterCachePrefix: env('POOL_RESERVES_MASTER_PREFIX', 'is'),
  concurrency: Number(env('POOL_RESERVES_CONCURRENCY', '3')),
  batchSize: Number(
    env('POOL_RESERVES_BATCH_SIZE', String(MAX_POOL_RESERVES_BATCH)),
  ),
  initTimeoutMs: Number(env('POOL_RESERVES_INIT_TIMEOUT_MS', '120000')),
  keyPrefix: process.env.POOL_RESERVES_KEY_PREFIX,
  logLevel: env('LOG_LEVEL', 'warn'),
  generateOnStart: process.argv.includes('--generate'),
  exitAfter: process.argv.includes('--exit'),
};

const logCapture = new LogCapture();
logCapture.install(config.logLevel);

const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});
const contexts = new Map<number, ChainContext>();

const parseChain = (req: Request): ChainContext => {
  const ctx = contexts.get(Number(req.params.chainId));
  if (!ctx) throw new HttpError(404, `unknown chainId ${req.params.chainId}`);
  if (!ctx.ready)
    throw new HttpError(503, `chain ${ctx.chainId} still initializing`);
  return ctx;
};

const parseDex = (ctx: ChainContext, req: Request) => {
  const entry = ctx.resolveDexKey(req.params.dexKey);
  if (!entry) {
    throw new HttpError(404, `unknown dexKey ${req.params.dexKey}`, {
      known: [...ctx.dexes.values()].map(d => d.dexKey),
    });
  }
  return entry;
};

const cursorOf = (req: Request) => String(req.query.cursor ?? '0');
const countOf = (req: Request, fallback = 100) =>
  Math.min(Math.max(Number(req.query.count ?? fallback), 1), 5000);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: object,
  ) {
    super(message);
  }
}

const app = express();
app.use(express.json());

const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res)
      .then(body => res.json(body))
      .catch(next);

app.get(
  '/health',
  route(async () => ({
    ok: true,
    chains: [...contexts.values()].map(c => ({
      chainId: c.chainId,
      ready: c.ready,
      running: c.running,
    })),
  })),
);

app.get(
  '/dexs/:chainId',
  route(async req => {
    const ctx = parseChain(req);
    const dexs = [];
    for (const d of ctx.dexes.values()) {
      dexs.push({
        ...d,
        poolsInStorageNow: d.storage
          ? await ctx.redis.hlen(d.storage.key)
          : null,
        lastReport: ctx.reports.get(d.dexKey.toLowerCase())
          ? {
              runId: ctx.reports.get(d.dexKey.toLowerCase())!.runId,
              status: ctx.reports.get(d.dexKey.toLowerCase())!.status,
            }
          : null,
      });
    }
    return { chainId: ctx.chainId, count: dexs.length, dexs };
  }),
);

app.get(
  '/pools/:dexKey/:chainId',
  route(async req => {
    const ctx = parseChain(req);
    const entry = parseDex(ctx, req);
    if (entry.storage) {
      const [cursor, flat] = await ctx.redis.hscan(
        entry.storage.key,
        cursorOf(req),
        'COUNT',
        countOf(req),
      );
      const pools = [];
      for (let i = 0; i + 1 < flat.length; i += 2)
        pools.push({ id: flat[i], descriptor: tryJson(flat[i + 1]) });
      return {
        mode: 'storage',
        key: entry.storage.key,
        fieldInValue: entry.storage.fieldInValue,
        total: await ctx.redis.hlen(entry.storage.key),
        cursor,
        pools,
      };
    }
    const target = ctx.keys(entry.dexKey).target;
    const [cursor, ids] = await ctx.redis.hscan(
      target,
      cursorOf(req),
      'COUNT',
      countOf(req),
      'NOVALUES',
    );
    return {
      mode: 'enumerated',
      source: 'last-run',
      total: await ctx.redis.hlen(target),
      cursor,
      ids,
    };
  }),
);

app.get(
  '/pools/:dexKey/:chainId/:id',
  route(async req => {
    const ctx = parseChain(req);
    const entry = parseDex(ctx, req);
    const key = entry.storage
      ? entry.storage.key
      : ctx.keys(entry.dexKey).target;
    const raw = await ctx.redis.hget(key, req.params.id);
    if (raw === null) throw new HttpError(404, `no ${req.params.id} in ${key}`);
    return { key, id: req.params.id, value: tryJson(raw) };
  }),
);

app.get(
  '/reserves/:dexKey/:chainId',
  route(async req => {
    const ctx = parseChain(req);
    const entry = parseDex(ctx, req);
    const keys = ctx.keys(entry.dexKey);
    // one MULTI so meta, rows and count come from the same published run
    const results = await ctx.redis
      .multi()
      .mget(keys.meta, keys.lastFailure)
      .hscan(keys.target, cursorOf(req), 'COUNT', countOf(req))
      .hlen(keys.target)
      .exec();
    if (!results || results.some(([err]) => err)) {
      throw new Error('redis read failed');
    }
    const [meta, lastFailure] = results[0][1] as (string | null)[];
    const [cursor, flat] = results[1][1] as [string, string[]];
    const total = results[2][1] as number;
    if (meta === null) {
      throw new HttpError(
        404,
        `no completed run for ${entry.dexKey} on ${ctx.chainId}`,
        { lastFailure: lastFailure ? tryJson(lastFailure) : null },
      );
    }
    const reserves = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      reserves.push({ id: flat[i], ...(tryJson(flat[i + 1]) as object) });
    }
    return {
      meta: tryJson(meta),
      harness: ctx.reports.get(entry.dexKey.toLowerCase()) ?? null,
      lastFailure: lastFailure ? tryJson(lastFailure) : null,
      total,
      cursor,
      reserves,
    };
  }),
);

app.get(
  '/reserves/:dexKey/:chainId/:id',
  route(async req => {
    const ctx = parseChain(req);
    const entry = parseDex(ctx, req);
    const raw = await ctx.redis.hget(
      ctx.keys(entry.dexKey).target,
      req.params.id,
    );
    if (raw === null)
      throw new HttpError(404, `no reserves for ${req.params.id}`);
    return { id: req.params.id, ...(tryJson(raw) as object) };
  }),
);

const generate = async (req: Request) => {
  const ctx = parseChain(req);
  const only = req.params.dexKey ? [parseDex(ctx, req).dexKey] : undefined;
  if (ctx.running !== null)
    throw new HttpError(409, `run in progress: ${ctx.running}`);
  const run = await ctx.generate(only);
  return { chainId: ctx.chainId, ...run, reports: run.reports.map(summarize) };
};
app.post('/generate/:chainId', route(generate));
app.post('/generate/:chainId/:dexKey', route(generate));

app.get(
  '/status/:chainId',
  route(async req => {
    const ctx = contexts.get(Number(req.params.chainId));
    if (!ctx) throw new HttpError(404, `unknown chainId ${req.params.chainId}`);
    return {
      chainId: ctx.chainId,
      ready: ctx.ready,
      running: ctx.running,
      init: [...ctx.dexes.values()].map(d => ({
        dexKey: d.dexKey,
        mode: d.mode,
        ...d.init,
      })),
      lastRun: ctx.lastRun
        ? { ...ctx.lastRun, reports: ctx.lastRun.reports.map(summarize) }
        : null,
      reports: [...ctx.reports.values()].map(summarize),
    };
  }),
);

app.get(
  '/verify/:dexKey/:chainId',
  route(async req => {
    const ctx = parseChain(req);
    const entry = parseDex(ctx, req);
    const sample = Number(req.query.sample ?? 50);
    // negative HRANDFIELD counts sample with replacement: reject them
    if (!Number.isSafeInteger(sample) || sample < 1 || sample > 500) {
      throw new HttpError(400, 'sample must be an integer within 1..500');
    }
    return verifyDex(ctx, entry.dexKey, sample);
  }),
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError)
    return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof PoolReservesRequestError)
    return res.status(400).json({ error: err.message });
  console.error(err);
  return res
    .status(500)
    .json({ error: err instanceof Error ? err.message : String(err) });
});

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

// Compact view of a report for run/status responses; samples stay in
// /reserves.
function summarize(
  r: ChainContext['reports'] extends Map<string, infer R> ? R : never,
) {
  const {
    skippedSample,
    unexpectedIdSample,
    invalidSample,
    failedBatchErrors,
    warnings,
    ...rest
  } = r;
  return {
    ...rest,
    samples: {
      skipped: skippedSample.length,
      unexpectedId: unexpectedIdSample.length,
      invalid: invalidSample.length,
      failedBatchErrors: failedBatchErrors.length,
      warnings: warnings.length,
    },
  };
}

async function main() {
  await redis.connect();
  const server = app.listen(config.port, () =>
    console.log(
      `pool-reserves-server listening on :${config.port} (redis ${config.redisUrl})`,
    ),
  );

  let shuttingDown = false;
  const shutdown = async (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    await Promise.all([...contexts.values()].map(c => c.release(30_000)));
    await redis.quit();
    process.exit(code);
  };
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));

  for (const chainId of config.chains) {
    const rpcUrl = process.env[`HTTP_PROVIDER_${chainId}`];
    if (!rpcUrl) {
      console.error(`HTTP_PROVIDER_${chainId} is not set, skipping chain`);
      continue;
    }
    const ctx = new ChainContext(chainId, rpcUrl, redis, logCapture, config);
    contexts.set(chainId, ctx);
    const startedAt = Date.now();
    await ctx.init();
    console.log(
      `chain ${chainId}: ${ctx.dexes.size} pool-reserve dexes initialized in ${
        Date.now() - startedAt
      }ms`,
    );
    for (const d of ctx.dexes.values()) {
      console.log(
        `  ${d.dexKey.padEnd(28)} ${d.mode.padEnd(
          10,
        )} init=${d.init?.status.padEnd(7)} ` +
          `storage=${d.poolsInStorageBeforeInit ?? '-'} ${
            d.init?.readiness ?? ''
          } ${d.init?.error ?? ''}`,
      );
    }
  }

  if (config.generateOnStart) {
    for (const ctx of contexts.values()) {
      const run = await ctx.generate();
      console.table(
        run.reports.map(r => ({
          dexKey: r.dexKey,
          mode: r.mode,
          status: r.status,
          storage: r.poolsInStorageBeforeInit,
          scanned: r.scannedFields,
          returned: r.returned,
          skipped: r.skipped,
          failedBatches: r.failedBatches,
          rpc: r.rpc.jsonRpcRequests,
          ms: r.durationMs,
          warnings: r.warnings.length,
        })),
      );
    }
    if (config.exitAfter) await shutdown(0);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
