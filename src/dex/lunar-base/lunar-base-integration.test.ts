/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface, JsonFragment, defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { Token } from '../../types';
import PoolABI from '../../abi/lunar-base/pool.json';
import { LunarBase } from './lunar-base';
import { LunarBaseConfig } from './config';
import { quoteXToY, quoteYToX } from './math';
import { LunarBasePoolConfig, LunarBasePoolState } from './types';

jest.setTimeout(300 * 1000);

const poolIface = new Interface(PoolABI as JsonFragment[]);

// ERC-7201 namespaces of the pool storage (dark_pools PoolCoreStorage /
// PoolAccessStorage).
const CORE_SLOT = BigInt(
  '0x92339d95cd94d632b9667b12583a50328b2e30cda97756d6fb6fc57acba80800',
);
const ACCESS_SLOT =
  '0x9832e62c6c6e13b4465b385de9f563995a2974f4f839176dcccf0b12e5c11200';

const hex32 = (value: bigint) => '0x' + value.toString(16).padStart(64, '0');
const whitelistSlot = (account: string) =>
  keccak256(
    defaultAbiCoder.encode(['address', 'bytes32'], [account, ACCESS_SLOT]),
  );

type Overrides = Record<string, string>;

async function ethCall(
  dexHelper: DummyDexHelper,
  pool: string,
  from: string,
  data: string,
  blockTag: string,
  overrides: Overrides | null,
) {
  const params: any[] = [{ from, to: pool, data }, blockTag];
  if (overrides) params.push({ [pool]: { stateDiff: overrides } });
  return (dexHelper.provider as any).send('eth_call', params);
}

async function readGetter(
  dexHelper: DummyDexHelper,
  pool: string,
  method: string,
  blockTag: string,
  overrides: Overrides | null,
) {
  const raw = await ethCall(
    dexHelper,
    pool,
    pool,
    poolIface.encodeFunctionData(method, []),
    blockTag,
    overrides,
  );
  return poolIface.decodeFunctionResult(method, raw);
}

async function tryGetter(
  dexHelper: DummyDexHelper,
  pool: string,
  method: string,
  blockTag: string,
  overrides: Overrides | null,
) {
  try {
    return await readGetter(dexHelper, pool, method, blockTag, overrides);
  } catch {
    return null;
  }
}

// Pool state as the math expects it, read with the same storage overrides
// that the on-chain quote is called with.
async function readState(
  dexHelper: DummyDexHelper,
  pool: string,
  blockTag: string,
  overrides: Overrides | null,
): Promise<LunarBasePoolState> {
  const read = (m: string) =>
    readGetter(dexHelper, pool, m, blockTag, overrides);
  const [state, x, y, delay, mult, paused] = await Promise.all([
    read('state'),
    read('getXReserve'),
    read('getYReserve'),
    read('blockDelay'),
    read('blacklistFeeMultiplier'),
    read('paused'),
  ]);
  const mp = await tryGetter(
    dexHelper,
    pool,
    'maxPunishmentX24',
    blockTag,
    overrides,
  );
  const k = mp
    ? null
    : await tryGetter(dexHelper, pool, 'concentrationK', blockTag, overrides);
  return {
    model: mp ? 'punishment' : 'concentration',
    anchorPrice: BigInt(state[0].toString()),
    feeAskX24: Number(state[1]),
    feeBidX24: Number(state[2]),
    latestUpdateBlock: Number(state[3]),
    reserveX: BigInt(x[0].toString()),
    reserveY: BigInt(y[0].toString()),
    blockDelay: Number(delay[0]),
    maxPunishmentX24: mp ? Number(mp[0]) : 0,
    concentrationK: k ? Number(k[0]) : 0,
    blacklistFeeMultiplier: BigInt(mult[0].toString()),
    executorsWhitelist: {},
    paused: Boolean(paused[0]),
  };
}

async function onChainQuote(
  dexHelper: DummyDexHelper,
  pool: string,
  from: string,
  xToY: boolean,
  amount: bigint,
  blockTag: string,
  overrides: Overrides | null,
): Promise<bigint> {
  const method = xToY ? 'quoteXToY' : 'quoteYToX';
  try {
    const raw = await ethCall(
      dexHelper,
      pool,
      from,
      poolIface.encodeFunctionData(method, [amount]),
      blockTag,
      overrides,
    );
    return BigInt(poolIface.decodeFunctionResult(method, raw)[0].toString());
  } catch {
    // The contract reverts on arithmetic overflow; the adapter returns 0.
    return 0n;
  }
}

// Input sizes from dust to beyond the inventory (rejections included).
function amountGrid(inventoryInToken: bigint): bigint[] {
  const grid = new Set<bigint>([1n, 7n, 1_000n, 123_456_789n]);
  for (const ppm of [
    1n,
    10n,
    333n,
    1_000n,
    12_345n,
    100_000n,
    250_000n,
    500_000n,
    999_000n,
    1_000_000n,
    1_500_000n,
    3_000_000n,
  ]) {
    const a = (inventoryInToken * ppm) / 1_000_000n;
    if (a > 0n) {
      grid.add(a);
      grid.add(a + 1n);
    }
  }
  return [...grid];
}

const Q96 = 1n << 96n;

type PoolCase = {
  network: Network;
  pool: LunarBasePoolConfig;
};

const cases: PoolCase[] = [Network.BASE, Network.BSC].flatMap(network =>
  LunarBaseConfig.LunarBase[network].pools.map(pool => ({ network, pool })),
);

describe('LunarBase pool math matches the contracts to the wei', () => {
  cases.forEach(({ network, pool }) => {
    it(`${network} ${pool.tokenX.symbol}/${pool.tokenY.symbol} ${pool.address}`, async () => {
      const dexHelper = new DummyDexHelper(network);
      const executors = Object.values(
        dexHelper.config.data.executorsAddresses ?? {},
      ) as string[];
      const caller = executors[0];
      const blockNumber = await dexHelper.provider.getBlockNumber();
      const blockTag = '0x' + blockNumber.toString(16);

      // Whitelist the executors, and revive a paused / stale / empty pool so
      // that its quote functions can be compared: quotes are views, they do
      // not check `paused`, and they return 0 once the anchor is stale.
      const overrides: Overrides = {};
      for (const executor of executors) {
        overrides[whitelistSlot(executor)] = hex32(1n);
      }
      const live = await readState(dexHelper, pool.address, blockTag, null);
      if (blockNumber >= live.latestUpdateBlock + live.blockDelay) {
        const slot0 = BigInt(
          await dexHelper.provider.getStorageAt(
            pool.address,
            hex32(CORE_SLOT),
            blockNumber,
          ),
        );
        const mask = (1n << 208n) - 1n;
        overrides[hex32(CORE_SLOT)] = hex32(
          (slot0 & mask) | (BigInt(blockNumber) << 208n),
        );
      }
      if (live.reserveX === 0n || live.reserveY === 0n) {
        // ~$50k on each side at the anchor price.
        const slot1 = BigInt(
          await dexHelper.provider.getStorageAt(
            pool.address,
            hex32(CORE_SLOT + 1n),
            blockNumber,
          ),
        );
        const p2 = live.anchorPrice * live.anchorPrice; // Y per X, Q192
        let reserveX: bigint;
        let reserveY: bigint;
        if (pool.tokenX.symbol.startsWith('USD')) {
          reserveX = 50_000n * 10n ** BigInt(pool.tokenX.decimals);
          reserveY = (reserveX * p2) / (Q96 * Q96);
        } else {
          reserveY = 50_000n * 10n ** BigInt(pool.tokenY.decimals);
          reserveX = (reserveY * Q96 * Q96) / p2;
        }
        const keep = slot1 >> 224n; // deprecatedConcentrationK
        overrides[hex32(CORE_SLOT + 1n)] = hex32(
          (keep << 224n) | (reserveY << 112n) | reserveX,
        );
      }

      const state = await readState(
        dexHelper,
        pool.address,
        blockTag,
        overrides,
      );
      console.log(
        `${network} ${pool.address}: model=${state.model} paused=${live.paused} ` +
          `stale=${blockNumber >= live.latestUpdateBlock + live.blockDelay} ` +
          `reserves=${state.reserveX}/${state.reserveY}`,
      );

      const xInventory =
        state.reserveX +
        (state.reserveY * Q96 * Q96) / (state.anchorPrice * state.anchorPrice);
      const yInventory =
        state.reserveY +
        (state.reserveX * state.anchorPrice * state.anchorPrice) / (Q96 * Q96);

      let compared = 0;
      let nonZero = 0;
      for (const [xToY, inventory] of [
        [true, xInventory],
        [false, yInventory],
      ] as const) {
        const grid = amountGrid(inventory);
        const expected = await Promise.all(
          grid.map(amount =>
            onChainQuote(
              dexHelper,
              pool.address,
              caller,
              xToY,
              amount,
              blockTag,
              overrides,
            ),
          ),
        );
        grid.forEach((amount, i) => {
          const actual = (xToY ? quoteXToY : quoteYToX)(
            state,
            amount,
            1n,
          ).amountOut;
          expect({ xToY, amount, out: actual }).toEqual({
            xToY,
            amount,
            out: expected[i],
          });
          compared++;
          if (expected[i] > 0n) nonZero++;
        });
      }
      console.log(
        `${network} ${pool.address}: ${compared} quotes equal (${nonZero} non-zero)`,
      );
      expect(nonZero).toBeGreaterThan(10);
    });
  });
});

describe('LunarBase getPricesVolume matches the executor quote', () => {
  cases.forEach(({ network, pool }) => {
    [true, false].forEach(xToY => {
      const src = xToY ? pool.tokenX : pool.tokenY;
      const dst = xToY ? pool.tokenY : pool.tokenX;
      it(`${network} ${src.symbol} -> ${dst.symbol}`, async () => {
        const dexHelper = new DummyDexHelper(network);
        const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
        const dex = new LunarBase(network, 'LunarBase', dexHelper);
        await dex.initializePricing(blockNumber);

        const srcToken: Token = {
          address: src.address,
          decimals: src.decimals,
        };
        const destToken: Token = {
          address: dst.address,
          decimals: dst.decimals,
        };
        const one = 10n ** BigInt(src.decimals);
        const amounts = [0n, one / 1000n, one / 100n, one / 10n, one / 3n];

        const prices = await dex.getPricesVolume(
          srcToken,
          destToken,
          amounts,
          SwapSide.SELL,
          blockNumber,
        );
        const live = await readState(
          dexHelper,
          pool.address,
          '0x' + blockNumber.toString(16),
          null,
        );
        const usable =
          !live.paused &&
          blockNumber < live.latestUpdateBlock + live.blockDelay;
        console.log(
          `${network} ${src.symbol}->${dst.symbol} usable=${usable}`,
          prices?.[0]?.prices,
        );
        if (!usable) {
          expect(prices).toBeNull();
          return;
        }
        expect(prices).not.toBeNull();

        // The executor that would call the pool, without any override: the
        // adapter must apply the pool's fee multiplier exactly as the pool
        // does for that caller.
        const executor = dexHelper.config.data.executorsAddresses!.Executor01;
        for (const [i, amount] of amounts.entries()) {
          if (amount === 0n) continue;
          const expected = await onChainQuote(
            dexHelper,
            pool.address,
            executor,
            xToY,
            amount,
            '0x' + blockNumber.toString(16),
            null,
          );
          expect(prices![0].prices[i]).toEqual(expected);
        }
      });
    });
  });
});
