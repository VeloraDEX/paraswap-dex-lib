/* eslint-disable no-console */
/**
 * Stage 5 gate — anvil mainnet-fork EXECUTION test.
 *
 * Builds the settlement calldata from `getDexParam` and actually executes the swap through the
 * Range Router on a local anvil fork (impersonate swapper, `deal` the input token via storage,
 * Permit2 approve, send the tx), then asserts the *realized* on-chain output equals the
 * *quoted* output from `getPricesVolume` — to the wei — for both live pools and both sides.
 *
 * The connector prices fully offline from the snapshot it loads at the fork block; each case runs
 * inside an evm_snapshot/evm_revert pair so every execution starts from the exact pool reserves
 * that the quote was computed against. (The canonical Tenderly E2E suite is Stage 8; this is the
 * interim proof required by Stage 5.)
 *
 * Requires `HTTP_PROVIDER_1` (an archive-capable mainnet RPC) and `anvil` on PATH. Run with
 * `--forceExit` (the web3 provider keeps a socket open).
 */
import dotenv from 'dotenv';
dotenv.config();

import { spawn, ChildProcess } from 'child_process';
import { Interface, defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { hexZeroPad } from '@ethersproject/bytes';
import { BigNumber } from '@ethersproject/bignumber';

import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { RangePool } from './range-pool';
import { PoolState } from './types';
import { RangePoolConfig } from './config';

const network = Network.MAINNET;
const dexKey = 'RangePool';

const ROME_USDT_POOL = '0xaf037e69f0fa8d1633443cc0c67d0b73e3694b36';
const TOP_CRYPTO_POOL = '0x67c02fc8f5a4140077999014efa7fe9d0ee2f29b';

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const SWAPPER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1);
const MAX_UINT160 = BigNumber.from(2).pow(160).sub(1);
const MAX_UINT48 = BigNumber.from(2).pow(48).sub(1);

const ANVIL_PORT = 8650;
const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;

const erc20Iface = new Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);
const permit2Iface = new Interface([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

let rpcId = 1;
async function rpc<T = any>(method: string, params: any[]): Promise<T> {
  const res = await fetch(ANVIL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const json = (await res.json()) as { error?: { message: string }; result: T };
  if (json.error) {
    throw new Error(`${method}: ${json.error.message}`);
  }
  return json.result;
}

async function ethCall(to: string, data: string): Promise<string> {
  return rpc('eth_call', [{ to, data }, 'latest']);
}

async function balanceOf(token: string, owner: string): Promise<bigint> {
  const ret = await ethCall(
    token,
    erc20Iface.encodeFunctionData('balanceOf', [owner]),
  );
  return BigInt(
    erc20Iface.decodeFunctionResult('balanceOf', ret)[0].toString(),
  );
}

async function decimalsOf(token: string): Promise<number> {
  const ret = await ethCall(
    token,
    erc20Iface.encodeFunctionData('decimals', []),
  );
  return Number(erc20Iface.decodeFunctionResult('decimals', ret)[0]);
}

// Send a tx from an (impersonated) account and require success.
async function sendTx(from: string, to: string, data: string): Promise<void> {
  const hash = await rpc<string>('eth_sendTransaction', [
    { from, to, data, gas: '0x4c4b40' },
  ]);
  // The receipt isn't ready synchronously when eth_sendTransaction returns — poll for it.
  let receipt: { status: string } | null = null;
  for (let i = 0; i < 50 && !receipt; i++) {
    receipt = await rpc<{ status: string } | null>(
      'eth_getTransactionReceipt',
      [hash],
    );
    if (!receipt) await new Promise(r => setTimeout(r, 100));
  }
  if (!receipt || BigInt(receipt.status) !== 1n) {
    throw new Error(`tx to ${to} reverted (status ${receipt?.status})`);
  }
}

// Foundry-style `deal`: brute-force the ERC20 balance mapping slot (both Solidity and Vyper key
// orderings) and write `amount` into the holder's balance via anvil_setStorageAt.
async function deal(
  token: string,
  holder: string,
  amount: bigint,
): Promise<void> {
  const value = hexZeroPad(BigNumber.from(amount).toHexString(), 32);
  for (let slot = 0; slot < 40; slot++) {
    for (const key of [
      keccak256(defaultAbiCoder.encode(['address', 'uint256'], [holder, slot])),
      keccak256(defaultAbiCoder.encode(['uint256', 'address'], [slot, holder])),
    ]) {
      const original = await rpc<string>('eth_getStorageAt', [
        token,
        key,
        'latest',
      ]);
      await rpc('anvil_setStorageAt', [token, key, value]);
      if ((await balanceOf(token, holder)) === amount) return;
      await rpc('anvil_setStorageAt', [token, key, original]); // restore wrong slot
    }
  }
  throw new Error(`could not deal token ${token}`);
}

async function waitForAnvil(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await rpc('eth_blockNumber', []);
      return;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  throw new Error('anvil did not become ready in time');
}

describe('RangePool — Stage 5: settlement execution (anvil fork)', () => {
  let anvil: ChildProcess;
  let dexHelper: DummyDexHelper;
  let rangePool: RangePool;
  let blockNumber: number;
  let states: Record<string, PoolState>;
  const ROUTER = RangePoolConfig[dexKey][network].routerAddress;

  beforeAll(async () => {
    const realRpc = process.env.HTTP_PROVIDER_1;
    if (!realRpc) throw new Error('HTTP_PROVIDER_1 not set');

    anvil = spawn(
      'anvil',
      [
        '--fork-url',
        realRpc,
        '--port',
        String(ANVIL_PORT),
        '--silent',
        '--no-rate-limit',
      ],
      { stdio: 'ignore' },
    );
    await waitForAnvil(60_000);

    // Point the connector at the fork so it prices off the exact state we execute against.
    process.env.HTTP_PROVIDER_1 = ANVIL_URL;
    dexHelper = new DummyDexHelper(network);
    blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    rangePool = new RangePool(network, dexKey, dexHelper);
    await rangePool.initializePricing(blockNumber);
    states = (rangePool as any).poolStates;

    process.env.HTTP_PROVIDER_1 = realRpc; // restore for any other suite
  }, 120_000);

  afterAll(() => {
    if (anvil) anvil.kill('SIGKILL');
  });

  // Quote with the connector (offline) and return its price for a single amount.
  const quote = async (
    tokenIn: string,
    tokenOut: string,
    decIn: number,
    decOut: number,
    amount: bigint,
    side: SwapSide,
    pool: string,
  ): Promise<bigint> => {
    const ex = await rangePool.getPricesVolume(
      { address: tokenIn, decimals: decIn },
      { address: tokenOut, decimals: decOut },
      [amount],
      side,
      blockNumber,
      [`${dexKey}_${pool}`],
    );
    const entry = ex?.find(p => p.poolIdentifiers?.[0] === `${dexKey}_${pool}`);
    expect(entry).toBeDefined();
    return entry!.prices[0];
  };

  // Execute one SELL (EXACT_IN) and assert realized output == quoted output.
  const runSell = async (
    pool: string,
    tokenIn: string,
    tokenOut: string,
  ): Promise<void> => {
    const s = states[pool];
    const iIn = s.tokens.indexOf(tokenIn);
    const iOut = s.tokens.indexOf(tokenOut);
    const decIn = await decimalsOf(tokenIn);
    const decOut = await decimalsOf(tokenOut);

    const factInRaw = s.balancesLiveScaled18[iIn] / s.scalingFactors[iIn];
    const amountIn = factInRaw / 100n; // 1% of the input-side fact balance

    const quotedOut = await quote(
      tokenIn,
      tokenOut,
      decIn,
      decOut,
      amountIn,
      SwapSide.SELL,
      pool,
    );
    expect(quotedOut).toBeGreaterThan(0n);

    const { exchangeData } = rangePool.getDexParam(
      tokenIn,
      tokenOut,
      amountIn.toString(),
      quotedOut.toString(),
      RECIPIENT,
      { exchange: pool },
      SwapSide.SELL,
    );

    const snap = await rpc<string>('evm_snapshot', []);
    try {
      await rpc('anvil_impersonateAccount', [SWAPPER]);
      await rpc('anvil_setBalance', [SWAPPER, '0x56BC75E2D63100000']); // 100 ETH
      await deal(tokenIn, SWAPPER, amountIn);

      await sendTx(
        SWAPPER,
        tokenIn,
        erc20Iface.encodeFunctionData('approve', [
          PERMIT2,
          MAX_UINT256.toString(),
        ]),
      );
      await sendTx(
        SWAPPER,
        PERMIT2,
        permit2Iface.encodeFunctionData('approve', [
          tokenIn,
          ROUTER,
          MAX_UINT160.toString(),
          MAX_UINT48.toString(),
        ]),
      );

      const before = await balanceOf(tokenOut, SWAPPER);
      await sendTx(SWAPPER, ROUTER, exchangeData);
      const realizedOut = (await balanceOf(tokenOut, SWAPPER)) - before;

      expect({ side: 'SELL', pool, realizedOut }).toEqual({
        side: 'SELL',
        pool,
        realizedOut: quotedOut,
      });
    } finally {
      await rpc('evm_revert', [snap]);
    }
  };

  // Execute one BUY (EXACT_OUT) and assert realized input == quoted input (and exact-out hit).
  const runBuy = async (
    pool: string,
    tokenIn: string,
    tokenOut: string,
  ): Promise<void> => {
    const s = states[pool];
    const iIn = s.tokens.indexOf(tokenIn);
    const iOut = s.tokens.indexOf(tokenOut);
    const decIn = await decimalsOf(tokenIn);
    const decOut = await decimalsOf(tokenOut);

    const factInRaw = s.balancesLiveScaled18[iIn] / s.scalingFactors[iIn];
    const factOutRaw = s.balancesLiveScaled18[iOut] / s.scalingFactors[iOut];
    const amountOut = factOutRaw / 200n; // 0.5% of the output-side fact balance

    const quotedIn = await quote(
      tokenIn,
      tokenOut,
      decIn,
      decOut,
      amountOut,
      SwapSide.BUY,
      pool,
    );
    expect(quotedIn).toBeGreaterThan(0n);

    const { exchangeData } = rangePool.getDexParam(
      tokenIn,
      tokenOut,
      MAX_UINT256.toString(), // maxAmountIn — encoded as MAX, slippage enforced elsewhere
      amountOut.toString(),
      RECIPIENT,
      { exchange: pool },
      SwapSide.BUY,
    );

    const snap = await rpc<string>('evm_snapshot', []);
    try {
      await rpc('anvil_impersonateAccount', [SWAPPER]);
      await rpc('anvil_setBalance', [SWAPPER, '0x56BC75E2D63100000']); // 100 ETH
      await deal(tokenIn, SWAPPER, factInRaw); // fund generously for the exact-out pull

      await sendTx(
        SWAPPER,
        tokenIn,
        erc20Iface.encodeFunctionData('approve', [
          PERMIT2,
          MAX_UINT256.toString(),
        ]),
      );
      await sendTx(
        SWAPPER,
        PERMIT2,
        permit2Iface.encodeFunctionData('approve', [
          tokenIn,
          ROUTER,
          MAX_UINT160.toString(),
          MAX_UINT48.toString(),
        ]),
      );

      const beforeIn = await balanceOf(tokenIn, SWAPPER);
      const beforeOut = await balanceOf(tokenOut, SWAPPER);
      await sendTx(SWAPPER, ROUTER, exchangeData);
      const realizedIn = beforeIn - (await balanceOf(tokenIn, SWAPPER));
      const realizedOut = (await balanceOf(tokenOut, SWAPPER)) - beforeOut;

      expect({ side: 'BUY', pool, realizedIn, realizedOut }).toEqual({
        side: 'BUY',
        pool,
        realizedIn: quotedIn,
        realizedOut: amountOut, // exact-out delivered exactly
      });
    } finally {
      await rpc('evm_revert', [snap]);
    }
  };

  it('ROME/USDT — SELL: realized out == quoted out', async () => {
    const t = states[ROME_USDT_POOL].tokens;
    await runSell(ROME_USDT_POOL, t[0], t[1]);
  }, 120_000);

  it('ROME/USDT — BUY: realized in == quoted in', async () => {
    const t = states[ROME_USDT_POOL].tokens;
    await runBuy(ROME_USDT_POOL, t[0], t[1]);
  }, 120_000);

  it('TOP CRYPTO — SELL: realized out == quoted out (WETH->USDT)', async () => {
    const t = states[TOP_CRYPTO_POOL].tokens; // [6]=WETH, [7]=USDT
    await runSell(TOP_CRYPTO_POOL, t[6], t[7]);
  }, 120_000);

  it('TOP CRYPTO — BUY: realized in == quoted in (WETH->USDT)', async () => {
    const t = states[TOP_CRYPTO_POOL].tokens;
    await runBuy(TOP_CRYPTO_POOL, t[6], t[7]);
  }, 120_000);
});
