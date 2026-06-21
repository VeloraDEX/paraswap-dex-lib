/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { spawn, ChildProcess, execSync } from 'child_process';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Contract } from '@ethersproject/contracts';
import { BigNumber } from '@ethersproject/bignumber';
import { Network } from '../../constants';
import { MachimaConfig } from './config';
import { AGGREGATOR_ROUTER_ABI, AGGREGATOR_QUOTER_ABI } from './abi';

/*
  Machima fork-based e2e (Base mainnet) — NO external services required.

  Unlike the Tenderly-based machima-e2e.test.ts, this test spins up its own
  local anvil fork of Base, impersonates a real XMA holder, and executes swaps
  through the *actual* MachimaAggregatorRouter -> MachimaSwapAdapter -> pool
  stack. It then asserts the property that the whole integration relies on:

    the off-chain pricing source (MachimaAggregatorQuoter.quote) and on-chain
    execution (MachimaAggregatorRouter.swap) agree in lockstep — same output to
    the wei when a swap is possible, and both revert together when the XMA
    sell-price floor (xmaSellSqrtPriceLimit) is binding.

  This is what lets the ParaSwap integration safely delegate XMA-sell pricing to
  the quoter: a reverting quote becomes a no-route, never a reverting trade.

  Requirements: Foundry (anvil) on PATH. The suite auto-skips if anvil is
  missing. A reliable Base RPC is recommended for the fork source; set
  HTTP_PROVIDER_8453 (defaults to a public node otherwise). The fork block is
  pinned (ANVIL_FORK_BLOCK) so anvil's on-disk cache makes reruns fast (~3s) and
  parity numbers deterministic.

  Run:
    HTTP_PROVIDER_8453=https://<your-base-rpc> \
      npx jest src/dex/machima/machima-fork-e2e.test.ts

  Expected: 3 passed — WETH->XMA buy parity, XMA->WETH sell parity (to the wei),
  and a floor-bound XMA sell where the quoter and the router both revert.
*/

const network = Network.BASE;
const dexKey = 'Machima';
const cfg = MachimaConfig[dexKey][network];

const FORK_RPC =
  process.env.HTTP_PROVIDER_8453 || 'https://base-rpc.publicnode.com';
const PORT = Number(process.env.ANVIL_PORT || 8549);
const LOCAL_RPC = `http://127.0.0.1:${PORT}`;

// Pin the fork block so anvil persists fetched state to its on-disk cache
// (~/.foundry/cache) — keeps reruns fast and parity numbers deterministic, and
// avoids hammering rate-limited RPCs while hydrating tick state. Override with
// ANVIL_FORK_BLOCK if this block ever gets pruned by your provider.
const FORK_BLOCK = Number(process.env.ANVIL_FORK_BLOCK || 47641565);

const XMA = cfg.xma;
const WETH = cfg.weth;
const ROUTER = cfg.aggregatorRouter;
const QUOTER = cfg.aggregatorQuoter;

// A funded XMA holder on Base (same address used in tests/constants-e2e.ts).
const HOLDER = '0x02F67B2e6aFbac5d1590C39097d03829bc0beDa9';
const DEADLINE = 9999999999;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function anvilAvailable(): boolean {
  try {
    execSync('anvil --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

type SwapResult = { reverted: boolean; out: bigint };

const describeOrSkip = anvilAvailable() ? describe : describe.skip;

describeOrSkip('Machima fork e2e (anvil, Base)', () => {
  let anvil: ChildProcess;
  let provider: JsonRpcProvider;

  // Generous: each tick-crossing swap forces anvil to hydrate pool state from
  // the fork RPC. Fast with a private archive RPC; slow on public nodes.
  jest.setTimeout(600_000);

  beforeAll(async () => {
    anvil = spawn(
      'anvil',
      [
        '--fork-url',
        FORK_RPC,
        '--fork-block-number',
        String(FORK_BLOCK),
        '--port',
        String(PORT),
        '--silent',
      ],
      { stdio: 'ignore' },
    );

    provider = new JsonRpcProvider(LOCAL_RPC, network);
    // anvil mines instantly; ethers' default 4s poll interval otherwise makes
    // every tx.wait() dominate the runtime. Poll aggressively against the local
    // node so the suite runs in seconds rather than minutes.
    provider.pollingInterval = 20;

    // Wait for the fork to be ready.
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await provider.getBlockNumber();
        ready = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    if (!ready) throw new Error('anvil fork did not become ready in time');

    // Fund + unlock the holder so we can send from it.
    await provider.send('anvil_setBalance', [HOLDER, '0xDE0B6B3A7640000']);
    await provider.send('anvil_impersonateAccount', [HOLDER]);

    console.log(`forked Base at block ${await provider.getBlockNumber()}`);
  });

  afterAll(() => {
    if (provider) provider.removeAllListeners();
    if (anvil && !anvil.killed) anvil.kill('SIGKILL');
  });

  // Read the post-tax/post-floor quote exactly as ParaSwap pricing does.
  async function quote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
  ): Promise<SwapResult> {
    const q = new Contract(QUOTER, AGGREGATOR_QUOTER_ABI, provider);
    try {
      const res = await q.callStatic.quote(
        tokenIn,
        tokenOut,
        amountIn.toString(),
      );
      return { reverted: false, out: (res[0] as BigNumber).toBigInt() };
    } catch {
      return { reverted: true, out: 0n };
    }
  }

  // Execute the real swap and measure the tokenOut delta. No snapshot/revert:
  // each scenario reads its quote and executes against the same current state,
  // so the lockstep parity holds regardless of prior swaps. (Reverting the fork
  // between txs rolls the block back and stalls ethers' tx.wait polling.)
  async function executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
  ): Promise<SwapResult> {
    const signer = provider.getSigner(HOLDER);
    const tokenInC = new Contract(tokenIn, ERC20_ABI, signer);
    await (await tokenInC.approve(ROUTER, amountIn.toString())).wait();

    const outC = new Contract(tokenOut, ERC20_ABI, provider);
    const before: bigint = (await outC.balanceOf(HOLDER)).toBigInt();

    const router = new Contract(ROUTER, AGGREGATOR_ROUTER_ABI, signer);
    try {
      const tx = await router.swap(
        tokenIn,
        tokenOut,
        amountIn.toString(),
        0,
        HOLDER,
        DEADLINE,
        { gasLimit: 3_000_000 },
      );
      const rcpt = await tx.wait();
      if (rcpt.status !== 1) return { reverted: true, out: 0n };
    } catch {
      return { reverted: true, out: 0n };
    }

    const after: bigint = (await outC.balanceOf(HOLDER)).toBigInt();
    return { reverted: false, out: after - before };
  }

  it('WETH -> XMA buy: executes and matches the quoter to the wei', async () => {
    const amountIn = 1_000_000_000_000_000n; // 0.001 WETH
    const q = await quote(WETH, XMA, amountIn);
    const s = await executeSwap(WETH, XMA, amountIn);

    console.log('buy  quote:', q, 'exec:', s);
    expect(q.reverted).toBe(false);
    expect(s.reverted).toBe(false);
    expect(s.out).toEqual(q.out);
    expect(s.out > 0n).toBe(true);
  });

  it('XMA -> WETH sell: quoter and execution agree in lockstep', async () => {
    const amountIn = 1_000_000_000_000_000_000n; // 1 XMA
    const q = await quote(XMA, WETH, amountIn);
    const s = await executeSwap(XMA, WETH, amountIn);

    console.log('sell quote:', q, 'exec:', s);
    // Core invariant: same revert outcome, and same output when fillable.
    expect(s.reverted).toBe(q.reverted);
    if (!q.reverted) {
      expect(s.out).toEqual(q.out);
      expect(s.out > 0n).toBe(true);
    }
  });

  it('XMA sell floor: once price is driven to the floor, quoter and execution both revert', async () => {
    // Drive the pool price up to xmaSellSqrtPriceLimit by selling a large amount
    // of XMA: the swap fills only up to the floor and refunds the rest, leaving
    // the price exactly at the floor. Any subsequent XMA->WETH sell then sits at
    // the floor and reverts (SPL) — and the quoter, taking the same swap path,
    // reverts too. This is what makes the integration emit a no-route instead of
    // a reverting trade. Runs last (mutates state irreversibly; no revert).
    const driver = 10_000_000_000_000_000_000_000_000n; // 10,000,000 XMA
    await executeSwap(XMA, WETH, driver);

    const probe = 1_000_000_000_000_000_000n; // 1 XMA
    const q = await quote(XMA, WETH, probe);
    const s = await executeSwap(XMA, WETH, probe);

    console.log('floor-bound sell quote:', q, 'exec:', s);
    expect(q.reverted).toBe(true);
    expect(s.reverted).toBe(true);
  });
});
