// Live check against a real PropAMM on a local anvil chain, driven by the desk's anvil_live.py (which sets the
// MHOCDESK_ANVIL_* variables; skipped otherwise). It performs the poller's exact reads (snapshotCalls, pinned to
// one block), decodes them (decodeSnapshot), prices a few hundred sizes with the adapter's math, and compares each
// with eth_call quote() at the same block. Then it mines one empty block and compares the next-block pricing that
// getPricesVolume uses (block + 1) with eth_call quote() in that block.
import {
  decodeSnapshot,
  erc20BalanceIface,
  propAMMIface,
  registryIface,
  SNAPSHOT_WORDS,
  snapshotCalls,
  word,
  words,
} from './mhoc-desk-state';
import { constantsFor, quote } from './mhoc-desk-math';
import { Interface } from '@ethersproject/abi';

const RPC = process.env.MHOCDESK_ANVIL_RPC;
const POOL = process.env.MHOCDESK_ANVIL_POOL;
const MULTICALL = process.env.MHOCDESK_ANVIL_MULTICALL;
const REGISTRY = process.env.MHOCDESK_ANVIL_REGISTRY;

const decimalsIface = new Interface([
  'function decimals() view returns (uint8)',
]);

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}
const call = (to: string, data: string, block: string): Promise<string> =>
  rpc('eth_call', [{ to, data }, block]);

(RPC && POOL && MULTICALL ? describe : describe.skip)(
  'MhocDesk live (anvil)',
  () => {
    it('poller reads + math reproduce eth_call quote() in the read block and in the next one', async () => {
      const bn = Number(await rpc('eth_blockNumber', []));
      const blk = '0x' + bn.toString(16);
      const addr = (h: string) => '0x' + h.slice(26, 66);
      const base = addr(
        await call(POOL!, propAMMIface.encodeFunctionData('BASE', []), blk),
      );
      const quoteTok = addr(
        await call(POOL!, propAMMIface.encodeFunctionData('QUOTE', []), blk),
      );
      const ps = word(
        await call(
          POOL!,
          propAMMIface.encodeFunctionData('PRICE_SCALE', []),
          blk,
        ),
      );
      const dec = async (t: string) =>
        Number(
          word(
            await call(
              t,
              decimalsIface.encodeFunctionData('decimals', []),
              blk,
            ),
          ),
        );
      const [bd, qd] = [await dec(base), await dec(quoteTok)];
      const ks = word(
        await call(POOL!, propAMMIface.encodeFunctionData('K_SCALE', []), blk),
      );
      if (REGISTRY) {
        // the registry lists the pool
        const listed: string[] = registryIface.decodeFunctionResult(
          'pools',
          await call(
            REGISTRY,
            registryIface.encodeFunctionData('pools', []),
            blk,
          ),
        )[0];
        expect(
          listed.map(a => a.toLowerCase()).includes(POOL!.toLowerCase()),
        ).toEqual(true);
      }

      const calls = snapshotCalls(POOL!, base, quoteTok, MULTICALL!);
      const rets = await Promise.all(
        calls.map(c => call(c.target, c.callData, blk)),
      );
      const snap = decodeSnapshot(
        rets.map((r, i) => words(r, SNAPSHOT_WORDS[i])),
        bn,
      );
      const c = constantsFor(bd, qd, ps, ks);

      const compare = async (atBlock: number, ts: bigint) => {
        const at = '0x' + atBlock.toString(16);
        let fillable = 0;
        for (let i = 0; i < 300; i++) {
          const side = i % 2 === 0 ? 'base' : 'quote';
          const d = side === 'base' ? bd : qd;
          const amt =
            10n ** BigInt((i * 7919) % (d + 10)) *
            BigInt(1 + ((i * 104729) % 999));
          const tok = side === 'base' ? base : quoteTok;
          const want = word(
            await call(
              POOL!,
              propAMMIface.encodeFunctionData('quote', [tok, amt]),
              at,
            ),
          );
          const r = quote(c, snap, side, amt, BigInt(atBlock), ts);
          const got = r.ok ? r.amountOut : 0n;
          if (r.ok) fillable++;
          expect([atBlock, side, amt.toString(), got.toString()]).toEqual([
            atBlock,
            side,
            amt.toString(),
            want.toString(),
          ]);
        }
        return fillable;
      };

      const same = await compare(bn, snap.readTimestamp);
      // the balance reads are the pool's real balances
      const bal = word(
        await call(
          base,
          erc20BalanceIface.encodeFunctionData('balanceOf', [POOL!]),
          blk,
        ),
      );
      expect(bal).toEqual(snap.balanceBase);

      // one empty block later: same state, the per-block counter has restarted
      const ts1 = snap.readTimestamp + 1n;
      await rpc('evm_setNextBlockTimestamp', ['0x' + ts1.toString(16)]);
      await rpc('evm_mine', []);
      const next = await compare(bn + 1, ts1);
      // eslint-disable-next-line no-console
      console.log(
        `block ${bn}: 300 quotes match eth_call quote() (${same} fillable); ` +
          `block ${bn + 1}: 300 next-block quotes match (${next} fillable)`,
      );
    });
  },
);
