/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { readFileSync } from 'fs';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Interface } from '@ethersproject/abi';
import { BigNumber } from 'ethers';
import { OptimalRate, ParaSwapVersion } from '@paraswap/core';
import { LocalParaswapSDK } from '../../implementations/local-paraswap-sdk';
import { ContractMethod, Network, SwapSide } from '../../constants';
import { Token } from '../../types';
import AUGUSTUS_V6_ABI from '../../abi/augustus-v6/ABI.json';
import ERC20_ABI from '../../abi/erc20.json';
import {
  BOOSTED_FEES_CONCENTRATED_ADDRESS,
  CORE_ADDRESS,
  DEX_KEY,
  MEV_CAPTURE_V21_ADDRESS,
  ROUTER_ADDRESS,
  TWAMM_ADDRESS,
  YUL_ROUTER_ADDRESS,
} from './config';
import { EkuboV3 } from './ekubo-v3';
import { EkuboV3PoolManager } from './ekubo-v3-pool-manager';
import { PoolConfig, PoolKey, ConcentratedPoolTypeConfig } from './pools/utils';
import { MevCaptureV21Pool } from './pools/mev-capture-v21';

// Executes MEVCapture v2.1 swaps through Augustus v6 on a local mainnet fork
// against the deployed extension, Core and Yul router, and checks that every
// executed amount equals the quote. Run against an anvil fork with a fresh
// pool, e.g. made by ForkMEVCaptureV21Pools.s.sol in an evm-contracts checkout
// (two test tokens, a MEVCapture v2.1 pool and a twin pool without extension
// with the same positions):
//
//   anvil --fork-url $RPC --port 8612
//   forge script script/ForkMEVCaptureV21Pools.s.sol --rpc-url http://127.0.0.1:8612 \
//     --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --broadcast --slow \
//     | sed -n 's/^ *FORKPOOL //p' > pool.json
//   EKUBO_V3_FORK_RPC_URL=http://127.0.0.1:8612 EKUBO_V3_FORK_POOL=pool.json \
//     pnpm test src/dex/ekubo-v3/ekubo-v3-mev-capture-v21-fork.test.ts
const RPC_URL = process.env.EKUBO_V3_FORK_RPC_URL;
const POOL_FILE = process.env.EKUBO_V3_FORK_POOL;
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SLOT_SECONDS = 12;

const augustusIface = new Interface(AUGUSTUS_V6_ABI);
const erc20Iface = new Interface(ERC20_ABI);

type CallFrame = {
  type: string;
  from: string;
  to: string;
  input: string;
  output?: string;
  gasUsed: string;
  error?: string;
  calls?: CallFrame[];
};

function frames(frame: CallFrame): CallFrame[] {
  return [frame, ...(frame.calls ?? []).flatMap(frames)];
}

const describeFork = RPC_URL && POOL_FILE ? describe : describe.skip;

describeFork('EkuboV3 MEVCapture v2.1 on a mainnet fork', () => {
  jest.setTimeout(10 * 60 * 1000);

  let provider: JsonRpcProvider;
  let sdk: LocalParaswapSDK;
  let dex: EkuboV3;
  let poolManager: EkuboV3PoolManager;
  let poolInfo: any;
  let v21Id: string;
  let twinId: string;
  let token0: Token;
  let token1: Token;
  let syncedBlock: number;
  let now = 0;
  const report: any[] = [];

  async function sync() {
    const latest = await provider.getBlockNumber();
    if (latest <= syncedBlock) return;
    const logs = await provider.getLogs({
      address: undefined,
      fromBlock: syncedBlock + 1,
      toBlock: latest,
    });
    const emitters = [
      CORE_ADDRESS,
      TWAMM_ADDRESS,
      BOOSTED_FEES_CONCENTRATED_ADDRESS,
    ].map(a => a.toLowerCase());
    const relevant = logs.filter(l =>
      emitters.includes(l.address.toLowerCase()),
    );
    const headers: Record<number, any> = {};
    for (const n of new Set(relevant.map(l => l.blockNumber))) {
      headers[n] = await sdk.dexHelper.web3Provider.eth.getBlock(n);
    }
    await poolManager.update(relevant as any, headers);
    syncedBlock = latest;
  }

  async function waitForState(id: string) {
    for (let i = 0; i < 100; i++) {
      const pool = poolManager.poolsByString.get(id) as any;
      if (pool?.getStaleState()) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`no state for ${id}`);
  }

  // The integration quotes at the estimated next block timestamp; the swap
  // is mined at exactly that time.
  async function pinNextTimestamp() {
    // anvil never mines a block before its own clock, which runs ahead of
    // the wall clock once blocks are mined in the future: read it by mining
    await provider.send('evm_mine', []);
    const block = await provider.getBlock('latest');
    now = block.timestamp + 60;
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
  }

  async function route(
    src: Token,
    dest: Token,
    side: SwapSide,
    legs: { poolId: string; amount: bigint }[],
  ): Promise<OptimalRate> {
    const blockNumber = await provider.getBlockNumber();
    const priced = await Promise.all(
      legs.map(async leg => {
        const prices = await dex.getPricesVolume(
          src,
          dest,
          [leg.amount],
          side,
          blockNumber,
          [leg.poolId],
        );
        expect(prices?.length).toBe(1);
        return { leg, price: prices![0] };
      }),
    );
    const total = legs.reduce((s, l) => s + l.amount, 0n);
    const quoted = priced.reduce((s, p) => s + p.price.prices[0], 0n);
    const [srcAmount, destAmount] =
      side === SwapSide.SELL ? [total, quoted] : [quoted, total];
    const unoptimized = {
      blockNumber,
      network: Network.MAINNET,
      srcToken: src.address,
      srcDecimals: src.decimals,
      srcAmount: srcAmount.toString(),
      destToken: dest.address,
      destDecimals: dest.decimals,
      destAmount: destAmount.toString(),
      bestRoute: [
        {
          percent: 100,
          swaps: [
            {
              srcToken: src.address,
              srcDecimals: src.decimals,
              destToken: dest.address,
              destDecimals: dest.decimals,
              swapExchanges: priced.map(({ leg, price }) => {
                const [legSrc, legDest] =
                  side === SwapSide.SELL
                    ? [leg.amount, price.prices[0]]
                    : [price.prices[0], leg.amount];
                return {
                  exchange: DEX_KEY,
                  srcAmount: legSrc.toString(),
                  destAmount: legDest.toString(),
                  percent: Number((leg.amount * 100n) / total),
                  data: price.data,
                  poolAddresses: price.poolAddresses,
                  poolIdentifiers: price.poolIdentifiers,
                };
              }),
            },
          ],
        },
      ],
      gasCostUSD: '0',
      gasCost: priced
        .reduce((s, p) => s + Number((p.price.gasCost as number[])[0]), 0)
        .toString(),
      others: [],
      side,
      contractAddress: sdk.dexHelper.config.data.augustusV6Address!,
      tokenTransferProxy: '',
      version: ParaSwapVersion.V6,
    };
    return {
      ...sdk.pricingHelper.optimizeRate(unoptimized as any),
      hmac: '0',
      srcUSD: '0',
      destUSD: '0',
      contractMethod:
        side === SwapSide.SELL
          ? ContractMethod.swapExactAmountIn
          : ContractMethod.swapExactAmountOut,
      partnerFee: 0,
    } as OptimalRate;
  }

  async function execute(
    name: string,
    src: Token,
    dest: Token,
    side: SwapSide,
    legs: { poolId: string; amount: bigint }[],
    tweakFromAmount?: (fromAmount: BigNumber) => BigNumber,
    slippageWei = 0n,
  ) {
    await pinNextTimestamp();
    await sync();
    const blockNumber = await provider.getBlockNumber();

    // the quotes of the v2.1 legs, with their execution resources
    const v21Quotes = legs
      .filter(l => l.poolId === v21Id)
      .map(l => {
        const pool = poolManager.poolsByString.get(v21Id)!;
        const amountToken = BigInt(
          (side === SwapSide.SELL ? src : dest).address,
        );
        return pool.quote(
          side === SwapSide.SELL ? l.amount : -l.amount,
          amountToken,
          blockNumber,
        ) as any;
      });

    const priceRoute = await route(src, dest, side, legs);
    const quotedAmount = BigInt(
      side === SwapSide.SELL ? priceRoute.destAmount : priceRoute.srcAmount,
    );
    const tx = await sdk.buildTransaction(
      priceRoute,
      side === SwapSide.SELL
        ? quotedAmount - slippageWei
        : quotedAmount + slippageWei,
      USER,
    );
    const executor = augustusIface.decodeFunctionData(
      priceRoute.contractMethod,
      tx.data,
    ).executor;

    let data = tx.data;
    if (tweakFromAmount) {
      const d = augustusIface.decodeFunctionData(
        priceRoute.contractMethod,
        tx.data,
      );
      const swapData = { ...d.swapData };
      swapData.fromAmount = tweakFromAmount(
        BigNumber.from(d.swapData.fromAmount),
      );
      swapData.toAmount = BigNumber.from(1);
      data = augustusIface.encodeFunctionData(priceRoute.contractMethod, [
        d.executor,
        swapData,
        d.partnerAndFee,
        d.permit,
        d.executorData,
      ]);
    }

    await provider.send('evm_setNextBlockTimestamp', [now]);
    const hash = await provider.send('eth_sendTransaction', [
      { from: USER, to: tx.to, data, value: '0x0', gas: '0x1c9c380' },
    ]);
    const receipt = await provider.waitForTransaction(hash);
    const block = await provider.getBlock(receipt.blockNumber);
    expect(block.timestamp).toBe(now);

    const trace: CallFrame = await provider.send('debug_traceTransaction', [
      hash,
      { tracer: 'callTracer' },
    ]);
    if (receipt.status !== 1) {
      console.log(
        'REVERTED',
        JSON.stringify(
          frames(trace).map(f => ({
            from: f.from,
            to: f.to,
            input: f.input.slice(0, 10),
            output: f.output,
            error: f.error,
          })),
        ),
      );
    }
    expect(receipt.status).toBe(1);

    const all = frames(trace);
    const routerCalls = all.filter(
      f =>
        f.to.toLowerCase() === YUL_ROUTER_ADDRESS.toLowerCase() &&
        f.from.toLowerCase() !== CORE_ADDRESS.toLowerCase(),
    );
    const ekuboRouterCalls = all.filter(
      f =>
        f.to.toLowerCase() === ROUTER_ADDRESS.toLowerCase() &&
        f.from.toLowerCase() !== CORE_ADDRESS.toLowerCase(),
    );
    const extension = MEV_CAPTURE_V21_ADDRESS.toLowerCase();
    // `swap_6269342730()` has the zero selector
    const extensionCoreSwaps = all.filter(
      f =>
        f.from.toLowerCase() === extension &&
        f.to.toLowerCase() === CORE_ADDRESS.toLowerCase() &&
        f.input.startsWith('0x00000000'),
    ).length;

    // Each Yul router call returns (specifiedToken, calculatedToken,
    // specifiedAmount, calculatedAmount); calculated is negative for output.
    const executed = routerCalls.map(f => {
      const words = f.output!.slice(2).match(/.{64}/g)!;
      return {
        specified: BigNumber.from(`0x${words[2]}`).fromTwos(256).toBigInt(),
        calculated: BigNumber.from(`0x${words[3]}`).fromTwos(256).toBigInt(),
        gasUsed: Number(f.gasUsed),
        input: f.input,
      };
    });

    const entry = {
      name,
      side,
      executor,
      block: receipt.blockNumber,
      timestamp: block.timestamp,
      legs: legs.map(l => ({
        pool: l.poolId === v21Id ? 'v2.1' : 'plain',
        amount: l.amount.toString(),
      })),
      quoted: quotedAmount.toString(),
      estimatedGas: priceRoute.gasCost,
      v21: v21Quotes.map((q, i) => ({
        quotedCalculated: q.calculatedAmount.toString(),
        executedSpecified: executed[i]?.specified.toString(),
        executedCalculated: executed[i]?.calculated.toString(),
        coreCallsQuoted: q.resources.coreCalls,
        accumulateAsFees: q.resources.accumulateAsFees,
        ticksCrossed: q.resources.initializedTicksCrossed,
        anchorUpdates: q.resources.anchorUpdates,
        estimatedGas: q.gasConsumed,
        routerCallGas: executed[i]?.gasUsed,
      })),
      extensionCoreSwaps,
      ekuboRouterCallGas: ekuboRouterCalls.map(f => Number(f.gasUsed)),
      txGas: receipt.gasUsed.toNumber(),
    };
    report.push(entry);
    console.log(JSON.stringify(entry));

    return { v21Quotes, executed, extensionCoreSwaps, receipt };
  }

  beforeAll(async () => {
    poolInfo = JSON.parse(readFileSync(POOL_FILE!, 'utf8'));
    provider = new JsonRpcProvider(RPC_URL);
    sdk = new LocalParaswapSDK(Network.MAINNET, DEX_KEY, RPC_URL!);
    dex = sdk.dexAdapterService.getDexByKey(DEX_KEY) as EkuboV3;
    poolManager = (dex as any).poolManager;
    // the pool states are kept current by `sync`, as the block manager would
    poolManager.isTracking = () => true;

    const config = (extension: string) =>
      new PoolConfig(
        BigInt(extension),
        BigInt(poolInfo.fee),
        new ConcentratedPoolTypeConfig(poolInfo.tickSpacing),
      );
    v21Id = new PoolKey(
      BigInt(poolInfo.token0),
      BigInt(poolInfo.token1),
      config(poolInfo.extension),
    ).stringId;
    twinId = new PoolKey(
      BigInt(poolInfo.token0),
      BigInt(poolInfo.token1),
      config('0x0'),
    ).stringId;
    token0 = { address: poolInfo.token0.toLowerCase(), decimals: 18 };
    token1 = { address: poolInfo.token1.toLowerCase(), decimals: 18 };

    // Load the pools the way the pool manager learns about new ones: from
    // the Core events of the blocks that created them.
    const initTx = await provider.getLogs({
      address: CORE_ADDRESS,
      topics: [
        new Interface(
          (
            await import('../../abi/ekubo-v3/core.json')
          ).default,
        ).getEventTopic('PoolInitialized'),
      ],
      // only blocks mined locally, after the fork
      fromBlock:
        Number(
          (
            await provider.send('anvil_nodeInfo', [])
          ).forkConfig.forkBlockNumber,
        ) + 1,
    });
    syncedBlock = Math.min(...initTx.map(l => l.blockNumber)) - 1;
    await sync();
    await waitForState(v21Id);
    await waitForState(twinId);
    // A concentrated pool built from its initialization and position events
    // misplaces its active tick index (independent of this extension), so
    // the twin is read from the chain instead.
    await poolManager.poolsByString
      .get(twinId)!
      .updateState(await provider.getBlockNumber());
    expect(poolManager.poolsByString.get(v21Id)).toBeInstanceOf(
      MevCaptureV21Pool,
    );

    for (const token of [token0, token1]) {
      await provider.send('eth_sendTransaction', [
        {
          from: USER,
          to: token.address,
          data: erc20Iface.encodeFunctionData('approve', [
            sdk.dexHelper.config.data.augustusV6Address,
            BigNumber.from(2).pow(255),
          ]),
        },
      ]);
    }
  });

  afterAll(() => {
    jest.restoreAllMocks();
    console.log(`FORK REPORT ${JSON.stringify(report)}`);
  });

  const E18 = 10n ** 18n;

  function expectExactV21(
    r: Awaited<ReturnType<typeof execute>>,
    side: SwapSide,
    amount: bigint,
  ) {
    const [q] = r.v21Quotes;
    const [e] = r.executed;
    expect(e).toBeDefined();
    // the router's calculated amount is positive output for exact input and
    // negative input for exact output
    if (side === SwapSide.SELL) {
      expect(e.specified).toBe(amount);
      expect(e.calculated).toBe(q.calculatedAmount);
    } else {
      expect(e.specified).toBe(-amount);
      expect(-e.calculated).toBe(q.calculatedAmount);
    }
    expect(r.extensionCoreSwaps).toBe(q.resources.coreCalls);
  }

  it('sells token0 far away from the anchor (multi-segment)', async () => {
    const amount = 30n * E18;
    const r = await execute('sell token0 away', token0, token1, SwapSide.SELL, [
      { poolId: v21Id, amount },
    ]);
    expectExactV21(r, SwapSide.SELL, amount);
    expect(r.v21Quotes[0].resources.accumulateAsFees).toBeGreaterThan(5);
  });

  it('sells token1 back toward the anchor and beyond', async () => {
    const amount = 50n * E18;
    const r = await execute(
      'sell token1 toward+away',
      token1,
      token0,
      SwapSide.SELL,
      [{ poolId: v21Id, amount }],
    );
    expectExactV21(r, SwapSide.SELL, amount);
  });

  it('buys token0 (exact output)', async () => {
    const amount = 15n * E18;
    const r = await execute('buy token0', token1, token0, SwapSide.BUY, [
      { poolId: v21Id, amount },
    ]);
    expectExactV21(r, SwapSide.BUY, amount);
  });

  it('buys token1 (exact output)', async () => {
    const amount = 20n * E18;
    const r = await execute('buy token1', token0, token1, SwapSide.BUY, [
      { poolId: v21Id, amount },
    ]);
    expectExactV21(r, SwapSide.BUY, amount);
  });

  it('sells a small amount', async () => {
    const amount = 10n ** 15n;
    const r = await execute(
      'sell token0 small',
      token0,
      token1,
      SwapSide.SELL,
      [{ poolId: v21Id, amount }],
    );
    expectExactV21(r, SwapSide.SELL, amount);
  });

  it('splits a sell between the v2.1 pool and a plain pool (Executor02)', async () => {
    const amount = 10n * E18;
    const r = await execute(
      'split sell token1',
      token1,
      token0,
      SwapSide.SELL,
      [
        { poolId: v21Id, amount },
        { poolId: twinId, amount },
      ],
      undefined,
      // the plain concentrated pool's quote can be off by a few wei
      1000n,
    );
    expect(r.executed.length).toBe(1);
    expectExactV21(r, SwapSide.SELL, amount);
  });

  it('swaps the plain twin pool through the existing router', async () => {
    const amount = 30n * E18;
    const r = await execute(
      'plain twin sell token0',
      token0,
      token1,
      SwapSide.SELL,
      [{ poolId: twinId, amount }],
    );
    expect(r.executed.length).toBe(0);
  });

  it('swaps a small amount on the plain twin pool', async () => {
    const amount = 10n ** 15n;
    const r = await execute(
      'plain twin sell token0 small',
      token0,
      token1,
      SwapSide.SELL,
      [{ poolId: twinId, amount }],
    );
    expect(r.executed.length).toBe(0);
  });

  it('uses the amount Augustus inserts at execution time', async () => {
    const amount = 5n * E18;
    const tweaked = (amount * 101n) / 100n;
    const r = await execute(
      'sell token0 with inserted amount',
      token0,
      token1,
      SwapSide.SELL,
      [{ poolId: v21Id, amount }],
      () => BigNumber.from(tweaked),
    );
    expect(r.executed[0].specified).toBe(tweaked);
    expect(r.executed[0].calculated > r.v21Quotes[0].calculatedAmount).toBe(
      true,
    );
  });
});
