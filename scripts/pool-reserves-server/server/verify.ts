import { Interface } from '@ethersproject/abi';
import { BytesLike } from '@ethersproject/bytes';
import { MultiResult } from '../../../src/lib/multi-wrapper';
import { generalDecoder } from '../../../src/lib/decoders';
import { UNLIMITED_RESERVES } from '../../../src/constants';
import { UniswapV2 } from '../../../src/dex/uniswap-v2/uniswap-v2';
import { StoredReserves } from '../consumer';
import { ChainContext } from './chain-context';

type Oracle = 'getReserves' | 'balanceOf' | 'idSet' | 'none';

export type PoolCheck = {
  id: string;
  address: string;
  result:
    | 'agreeAtStateBlock'
    | 'agreeAtRunBlock'
    | 'agreeAtLatest'
    | 'agreeWithinTolerance'
    | 'disagree'
    | 'unverified';
  stateBlock?: number;
  detail?: Record<
    string,
    { stored: string; runBlock?: string; latest?: string }
  >;
  reason?: string;
};

export type VerifyReport = {
  dexKey: string;
  chainId: number;
  oracle: Oracle;
  runBlock: number | null;
  latestBlock: number;
  eligible: number;
  sampled: number;
  agreeAtStateBlock: number;
  agreeAtRunBlock: number;
  agreeAtLatest: number;
  // relative difference <= TOLERANCE (state accounting vs token balance dust)
  agreeWithinTolerance: number;
  disagree: number;
  unverified: number;
  reason?: string;
  checks: PoolCheck[];
};

// 1e-6: Maverick/Algebra reserves are state accounting; the pool's token
// balance can carry protocol-fee dust on top.
const TOLERANCE_PPM = 1n;

const withinTolerance = (stored: string, onChain: string): boolean => {
  const a = BigInt(stored);
  const b = BigInt(onChain);
  const diff = a > b ? a - b : b - a;
  const base = a > b ? a : b;
  return base === 0n ? diff === 0n : diff * 1_000_000n <= base * TOLERANCE_PPM;
};

const erc20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
]);
const pair = new Interface([
  'function getReserves() view returns (uint112,uint112,uint32)',
]);

const strictUint = (r: MultiResult<BytesLike> | BytesLike): bigint =>
  generalDecoder(r, ['uint256'], undefined, v => v[0].toBigInt());
const reservesDecoder = (
  r: MultiResult<BytesLike> | BytesLike,
): [bigint, bigint] =>
  generalDecoder(r, ['uint112', 'uint112', 'uint32'], undefined, v => [
    v[0].toBigInt(),
    v[1].toBigInt(),
  ]);

type Row = { id: string } & StoredReserves;

// Best-effort: the block at which the dex's in-memory state for this pool
// was set. State-path values (Maverick, Algebra) are exact at that block,
// not at the run block. Looks through the usual pool maps by address.
function stateBlockOf(dex: unknown, address: string): number | null {
  const d = dex as Record<string, unknown>;
  for (const field of ['pools', 'eventPools']) {
    const pools = d[field];
    if (!pools || typeof pools !== 'object') continue;
    const values =
      pools instanceof Map ? [...pools.values()] : Object.values(pools);
    for (const pool of values as Array<Record<string, unknown>>) {
      const addr = (pool?.poolAddress ?? pool?.address) as string | undefined;
      if (typeof addr === 'string' && addr.toLowerCase() === address) {
        const fn = pool.getStateBlockNumber;
        if (typeof fn === 'function') {
          const bn = Number((fn as () => number).call(pool));
          return bn > 0 ? bn : null;
        }
      }
    }
  }
  return null;
}

// Metadata, a random sample (HRANDFIELD, O(sample)) and the count of the
// published hash in one MULTI, so a publication in between cannot pair one
// run's metadata with another run's rows.
async function snapshot(ctx: ChainContext, dexKey: string, sample: number) {
  const keys = ctx.keys(dexKey);
  const results = await ctx.redis
    .multi()
    .get(keys.meta)
    .hrandfield(keys.target, sample, 'WITHVALUES')
    .hlen(keys.target)
    .exec();
  if (!results || results.some(([err]) => err)) {
    throw new Error('redis read failed');
  }
  const metaRaw = results[0][1] as string | null;
  const flat = results[1][1] as string[] | null;
  const total = results[2][1] as number;
  const rows: Row[] = [];
  for (let i = 0; flat && i + 1 < flat.length; i += 2) {
    rows.push({ id: flat[i], ...(JSON.parse(flat[i + 1]) as StoredReserves) });
  }
  const meta = metaRaw
    ? (JSON.parse(metaRaw) as { blockNumber?: number | null })
    : null;
  return { rows, total, runBlock: meta?.blockNumber ?? null };
}

const plainTokens = (row: Row): string[] | null => {
  const keys = Object.keys(row.reserves);
  if (keys.length < 2 || keys.some(k => k.includes('_'))) return null;
  if (Object.values(row.reserves).includes(UNLIMITED_RESERVES)) return null;
  return keys;
};

// Reads the same quantity the dex reported, first at the run block and, on
// a mismatch, at the latest block (a swap in between is the benign case).
export async function verifyDex(
  ctx: ChainContext,
  dexKey: string,
  sample: number,
): Promise<VerifyReport> {
  const dex = ctx.sdk.dexAdapterService.getDexByKey(dexKey);
  // the published metadata, not ctx.reports: the latest report may describe
  // a failed run whose rows were never published
  const { rows, total, runBlock } = await snapshot(ctx, dexKey, sample);
  const latestBlock = await ctx.sdk.dexHelper.provider.getBlockNumber();
  const out: VerifyReport = {
    dexKey,
    chainId: ctx.chainId,
    oracle: 'none',
    runBlock,
    latestBlock,
    eligible: 0,
    sampled: 0,
    agreeAtStateBlock: 0,
    agreeAtRunBlock: 0,
    agreeAtLatest: 0,
    agreeWithinTolerance: 0,
    disagree: 0,
    unverified: 0,
    checks: [],
  };

  if (dexKey.toLowerCase().includes('ekubo')) {
    return verifyIdSet(ctx, dex, dexKey, out);
  }

  out.eligible = total;
  const candidates = rows.filter(r => plainTokens(r) !== null);
  if (candidates.length === 0) {
    out.reason =
      rows.length === 0
        ? 'no published rows'
        : 'rows are directional or unlimited: no on-chain balance oracle';
    out.unverified = rows.length;
    return out;
  }
  out.sampled = candidates.length;

  const isUniV2 = dex instanceof UniswapV2;
  out.oracle = isUniV2 ? 'getReserves' : 'balanceOf';
  const read = (block: number | null, rows: Row[] = candidates) =>
    isUniV2
      ? readGetReserves(ctx, rows, block)
      : readBalances(ctx, rows, block);

  const atRun = runBlock !== null ? await read(runBlock) : null;
  let atLatest: Map<string, Record<string, string | null>> | null = null;

  for (const row of candidates) {
    const tokens = plainTokens(row)!;
    const check: PoolCheck = {
      id: row.id,
      address: row.address,
      result: 'unverified',
      detail: {},
    };
    const runValues = atRun?.get(row.id);
    const agrees = (values: Record<string, string | null> | undefined) =>
      values !== undefined &&
      tokens.every(t => values[t] !== null && values[t] === row.reserves[t]);

    const stateBlock = isUniV2 ? null : stateBlockOf(dex, row.address);
    if (stateBlock !== null) check.stateBlock = stateBlock;
    if (agrees(runValues)) {
      check.result = 'agreeAtRunBlock';
    } else if (
      stateBlock !== null &&
      stateBlock !== runBlock &&
      agrees((await read(stateBlock, [row])).get(row.id))
    ) {
      check.result = 'agreeAtStateBlock';
    } else {
      if (!atLatest) atLatest = await read(null);
      const latestValues = atLatest.get(row.id);
      const near = (values: Record<string, string | null> | undefined) =>
        values !== undefined &&
        tokens.every(
          t =>
            values[t] !== null && withinTolerance(row.reserves[t], values[t]!),
        );
      if (agrees(latestValues)) check.result = 'agreeAtLatest';
      else if (near(runValues) || near(latestValues)) {
        check.result = 'agreeWithinTolerance';
      } else if (
        (runValues && tokens.some(t => runValues[t] === null)) ||
        (latestValues && tokens.some(t => latestValues[t] === null))
      ) {
        check.result = 'unverified';
        check.reason = 'oracle call failed';
      } else check.result = 'disagree';
      for (const t of tokens) {
        check.detail![t] = {
          stored: row.reserves[t],
          runBlock: runValues?.[t] ?? undefined,
          latest: latestValues?.[t] ?? undefined,
        };
      }
    }
    if (check.result.startsWith('agreeAt')) delete check.detail;
    out[check.result]++;
    out.checks.push(check);
  }
  return out;
}

async function readBalances(
  ctx: ChainContext,
  rows: Row[],
  block: number | null,
): Promise<Map<string, Record<string, string | null>>> {
  const calls = rows.flatMap(row =>
    plainTokens(row)!.map(token => ({
      target: token,
      callData: erc20.encodeFunctionData('balanceOf', [row.address]),
      decodeFunction: strictUint,
    })),
  );
  const results = await ctx.sdk.dexHelper.multiWrapper.tryAggregate(
    false,
    calls,
    block ?? undefined,
    200,
    false,
  );
  const out = new Map<string, Record<string, string | null>>();
  let i = 0;
  for (const row of rows) {
    const values: Record<string, string | null> = {};
    for (const token of plainTokens(row)!) {
      const r = results[i++];
      values[token] = r.success ? r.returnData.toString() : null;
    }
    out.set(row.id, values);
  }
  return out;
}

async function readGetReserves(
  ctx: ChainContext,
  rows: Row[],
  block: number | null,
): Promise<Map<string, Record<string, string | null>>> {
  const results = await ctx.sdk.dexHelper.multiWrapper.tryAggregate(
    false,
    rows.map(row => ({
      target: row.address,
      callData: pair.encodeFunctionData('getReserves'),
      decodeFunction: reservesDecoder,
    })),
    block ?? undefined,
    200,
    false,
  );
  const out = new Map<string, Record<string, string | null>>();
  rows.forEach((row, i) => {
    const [t0, t1] = plainTokens(row)!.slice().sort();
    const r = results[i];
    out.set(
      row.id,
      r.success
        ? { [t0]: r.returnData[0].toString(), [t1]: r.returnData[1].toString() }
        : { [t0]: null, [t1]: null },
    );
  });
  return out;
}

// EkuboV3 reports virtual TVL from state; the only independent check is
// that the published ids are exactly the manager's valid pools.
async function verifyIdSet(
  ctx: ChainContext,
  dex: unknown,
  dexKey: string,
  out: VerifyReport,
): Promise<VerifyReport> {
  out.oracle = 'idSet';
  const manager = (
    dex as {
      poolManager?: {
        poolsByString?: Map<string, { isInvalid?: () => boolean }>;
      };
    }
  ).poolManager;
  const expected = new Set<string>();
  for (const [k, pool] of manager?.poolsByString ?? []) {
    if (!pool.isInvalid?.()) expected.add(k);
  }
  const published = new Set(await ctx.redis.hkeys(ctx.keys(dexKey).target));
  out.eligible = expected.size;
  out.sampled = published.size;
  const missing = [...expected].filter(k => !published.has(k));
  const extra = [...published].filter(k => !expected.has(k));
  out.agreeAtRunBlock = published.size - extra.length;
  out.disagree = missing.length + extra.length;
  out.reason = `missing=${missing.length} extra=${extra.length}`;
  out.checks = [
    ...missing.slice(0, 20).map(id => ({
      id,
      address: '',
      result: 'disagree' as const,
      reason: 'not published',
    })),
    ...extra.slice(0, 20).map(id => ({
      id,
      address: '',
      result: 'disagree' as const,
      reason: 'not in pool manager',
    })),
  ];
  return out;
}
