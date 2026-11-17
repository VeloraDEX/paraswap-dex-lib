/* eslint-disable no-console */
// dex-lib's standard integration test for MhocDesk, in two modes:
//
//  - Base mainnet (HTTP_PROVIDER_8453, read-only), with the pools of config.ts (and of the registry, if one is
//    configured there). Skipped while config.ts lists neither a pool nor a registry.
//  - a local anvil chain with a real pool, driven by the desk's anvil_live.py (MHOCDESK_ANVIL_RPC, _POOL,
//    _REGISTRY; started with --chain-id 8453 and the multicall helper installed at dex-lib's Base multicall
//    address). The dex gets no pool in its config: it finds every pool through the registry, polls it, and its
//    next-block prices are compared with the pool's own quote() in the next block.
//
// In both modes a pool without liquidity (paused, not configured, expired card) must give no prices while its
// own quote() is 0. The exactness of the maths itself is covered offline by mhoc-desk-math.test.ts.
import dotenv from 'dotenv';
dotenv.config();
// on anvil every read goes to the local chain; dex-lib's config reads this variable when it is first imported
if (process.env.MHOCDESK_ANVIL_RPC)
  process.env.HTTP_PROVIDER_8453 = process.env.MHOCDESK_ANVIL_RPC;

import { StaticJsonRpcProvider } from '@ethersproject/providers';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { Token } from '../../types';
import { MhocDesk } from './mhoc-desk';
import { propAMMIface } from './mhoc-desk-state';
import { constantsFor, quote } from './mhoc-desk-math';
import { checkPoolPrices, checkPoolsLiquidity } from '../../../tests/utils';
import { MhocDeskConfig } from './config';
import { DexParams, PoolConfig } from './types';

const network = Network.BASE;
const dexKey = 'MhocDesk';

const ANVIL_RPC = process.env.MHOCDESK_ANVIL_RPC;
const ANVIL_POOL = process.env.MHOCDESK_ANVIL_POOL?.toLowerCase();
const ANVIL_REGISTRY = process.env.MHOCDESK_ANVIL_REGISTRY;
const onAnvil = !!(ANVIL_RPC && ANVIL_POOL && ANVIL_REGISTRY);

const baseConfig = MhocDeskConfig[dexKey][network];
const config: DexParams = onAnvil
  ? { pools: [], registry: ANVIL_REGISTRY }
  : baseConfig;
const enabled = onAnvil || baseConfig.pools.length > 0 || !!baseConfig.registry;

async function onChainQuotes(
  dex: MhocDesk,
  pool: string,
  tokenIn: string,
  amounts: bigint[],
  blockNumber: number,
): Promise<bigint[]> {
  const calls = amounts.slice(1).map(a => ({
    target: pool,
    callData: propAMMIface.encodeFunctionData('quote', [tokenIn, a]),
  }));
  const res = (
    await dex.dexHelper.multiContract.methods
      .aggregate(calls)
      .call({}, blockNumber)
  ).returnData as string[];
  return [0n].concat(
    res.map(r => BigInt(propAMMIface.decodeFunctionResult('quote', r)[0])),
  );
}

// evenly spaced, starting with 0 (what checkPoolPrices expects): 0.01 BASE or 10 QUOTE per step
const amountsFor = (t: { decimals: number }, isBase: boolean) =>
  [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n].map(k =>
    isBase ? (k * BI_POWS[t.decimals]) / 100n : k * 10n * BI_POWS[t.decimals],
  );

(enabled ? describe : describe.skip)(
  `MhocDesk (${onAnvil ? 'anvil' : 'Base'})`,
  () => {
    let dexHelper: DummyDexHelper;
    let blockNumber: number;
    let dex: MhocDesk;
    let pools: PoolConfig[];

    beforeAll(async () => {
      dexHelper = new DummyDexHelper(network, onAnvil ? ANVIL_RPC : undefined);
      blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
      dex = new MhocDesk(network, dexKey, dexHelper, config);
      await dex.initializePricing(blockNumber);
      pools = (dex as any).pools.map((p: { cfg: PoolConfig }) => p.cfg);
    });

    it('knows its pools (config and registry) with their on-chain immutables', async () => {
      expect(pools.length).toBeGreaterThan(0);
      if (onAnvil)
        expect(pools.map(p => p.address).includes(ANVIL_POOL!)).toBe(true);
      const read = async (pool: string, m: string) =>
        propAMMIface.decodeFunctionResult(
          m,
          await dexHelper.provider.call({
            to: pool,
            data: propAMMIface.encodeFunctionData(m, []),
          }),
        )[0];
      for (const p of onAnvil
        ? pools.filter(x => x.address === ANVIL_POOL)
        : pools) {
        expect((await read(p.address, 'BASE')).toLowerCase()).toEqual(
          p.base.address,
        );
        expect((await read(p.address, 'QUOTE')).toLowerCase()).toEqual(
          p.quote.address,
        );
        expect(BigInt(await read(p.address, 'PRICE_SCALE'))).toEqual(
          p.priceScale,
        );
        expect(BigInt(await read(p.address, 'K_SCALE'))).toEqual(p.kScale);
      }
    });

    it('getPoolIdentifiers, getPricesVolume SELL both ways, and the polled state against quote()', async () => {
      for (const p of onAnvil
        ? pools.filter(x => x.address === ANVIL_POOL)
        : pools) {
        const id = dex.poolIdentifier(p.address);
        const poller = (dex as any).pools.find(
          (x: { cfg: PoolConfig }) => x.cfg.address === p.address,
        ).poller;
        const state = await poller.getState();
        expect(state).not.toBeNull();
        const c = constantsFor(
          p.base.decimals,
          p.quote.decimals,
          p.priceScale,
          p.kScale,
        );
        // dex-lib's own results first (they are priced for the block after the polled one)
        const results = [];
        for (const [src, dest, side] of [
          [p.base, p.quote, 'base'],
          [p.quote, p.base, 'quote'],
        ] as const) {
          const amounts = amountsFor(src, side === 'base');
          const ids = await dex.getPoolIdentifiers(
            src as Token,
            dest as Token,
            SwapSide.SELL,
            blockNumber,
          );
          expect(ids.includes(id)).toBe(true);
          const prices = await dex.getPricesVolume(
            src as Token,
            dest as Token,
            amounts,
            SwapSide.SELL,
            blockNumber,
            [id],
          );
          if (prices !== null)
            // marginal prices fall with size, unless a size cap zeroes part of the ladder
            checkPoolPrices(
              prices,
              amounts,
              SwapSide.SELL,
              dexKey,
              prices[0].prices.slice(1).every(x => x > 0n),
            );
          results.push({ src, side, amounts, prices });

          // the polled state priced at its own block (the per-block counter included) equals quote() there
          const onChain = await onChainQuotes(
            dex,
            p.address,
            src.address,
            amounts,
            state.blockNumber,
          );
          const sim = amounts.map(a => {
            if (a === 0n) return 0n;
            const r = quote(
              c,
              state.value,
              side,
              a,
              BigInt(state.blockNumber),
              state.value.readTimestamp,
            );
            return r.ok ? r.amountOut : 0n;
          });
          expect(sim).toEqual(onChain);
          if (prices === null)
            console.log(`${p.address} ${side}: no liquidity`, onChain);
          else console.log(`${p.address} ${side}`, prices[0].prices);
        }

        if (onAnvil) {
          // one empty block later, same second: getPricesVolume's prices are the pool's quotes in that block
          const ts = '0x' + state.value.readTimestamp.toString(16);
          const rpc = dexHelper.provider as StaticJsonRpcProvider;
          await rpc.send('evm_setNextBlockTimestamp', [ts]);
          await rpc.send('evm_mine', []);
          for (const r of results) {
            const next = await onChainQuotes(
              dex,
              p.address,
              r.src.address,
              r.amounts,
              state.blockNumber + 1,
            );
            expect(
              r.prices === null ? r.amounts.map(() => 0n) : r.prices[0].prices,
            ).toEqual(next);
          }
        } else {
          // Base: without prices the pool itself must quote 0 (no liquidity) at the polled block
          for (const r of results.filter(x => x.prices === null)) {
            const now = await onChainQuotes(
              dex,
              p.address,
              r.src.address,
              r.amounts,
              state.blockNumber,
            );
            expect(now.every(x => x === 0n)).toBe(true);
          }
        }
      }
    });

    it('BUY is not supported (exact-in pool)', async () => {
      const p = pools[0];
      expect(
        await dex.getPoolIdentifiers(
          p.base as Token,
          p.quote as Token,
          SwapSide.BUY,
          blockNumber,
        ),
      ).toEqual([]);
    });

    it('getTopPoolsForToken', async () => {
      await dex.updatePoolState();
      const p = pools[0];
      const liq = await dex.getTopPoolsForToken(p.base.address, 10);
      console.log('top pools', liq);
      checkPoolsLiquidity(liq, p.base.address, dexKey);
    });
  },
);
