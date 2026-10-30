/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Contract } from 'ethers';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide, ETHER_ADDRESS } from '../../constants';
import { Token } from '../../types';
import { FlowState } from './flowstate';

/*
  Live integration test — hits our Hasura + a public RPC (read-only, no
  Tenderly, no simulated swaps). It anchors on whatever active pool currently
  has the most on-chain, 1inch-priceable inventory on the network, so it
  exercises real pricing instead of a hardcoded (ephemeral) pool.

  What it proves:
   - Discovery: getPoolIdentifiers finds the live pool for ETH -> TOKEN.
   - Pricing parity: the module's multicall reads (oracle rate + pool balance)
     and its price curve are byte-identical to an INDEPENDENT direct-RPC
     recompute of the exact contract formula (price*1e18/weiPerToken, capped by
     inventory).
   - Inventory cap: amounts above the pool's balance price to 0 (never overfill).
   - getTopPoolsForToken surfaces the pool with a native-ETH connector.

  If no priceable inventory exists at run time, the pricing assertions skip
  (with a clear log) rather than failing — pools are ephemeral.

  Run: npx jest src/dex/flowstate/flowstate-integration.test.ts
*/

jest.setTimeout(180000);

const DEX_KEY = 'FlowState';
const ORACLE = '0x00000000000D6FFc74A8feb35aF5827bf57f6786';
const GRAPHQL_URL = 'https://gql.poolparty.market/v1/graphql';
const E18 = 10n ** 18n;

const ORACLE_ABI = [
  'function getRateToEth(address srcToken, bool useWrappers) view returns (uint256)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

type LivePool = {
  poolAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  rate: bigint; // 1inch weiPerToken @ blockNumber
  balance: bigint; // on-chain token balance of the pool @ blockNumber
};

// Find the active pool with the largest on-chain, oracle-priceable inventory.
async function pickLivePool(
  dexHelper: DummyDexHelper,
  network: number,
  blockNumber: number,
): Promise<LivePool | null> {
  const query = `{ Pool(where: { poolStatus: {_eq: "ACTIVE"}, poolType: {_in: ["2","3"]}, publicAmountAvailable: {_gt: "0"}, chainID: {_eq: ${network}} }, limit: 40) { poolAddress tokenAddress tokenSymbol tokenDecimals publicAmountAvailable } }`;

  const resp = await dexHelper.httpRequest.post<{
    data?: { Pool?: any[] };
  }>(GRAPHQL_URL, { query });
  const candidates = resp?.data?.Pool ?? [];
  console.log(
    `[pickLivePool] ${candidates.length} inventory-bearing pools on chain ${network}`,
  );

  const oracle = new Contract(ORACLE, ORACLE_ABI, dexHelper.provider);
  let best: LivePool | null = null;

  for (const p of candidates) {
    try {
      const rate = BigInt(
        (
          await oracle.getRateToEth(p.tokenAddress, false, {
            blockTag: blockNumber,
          })
        ).toString(),
      );
      if (rate === 0n) continue; // not priceable by 1inch
      const erc20 = new Contract(p.tokenAddress, ERC20_ABI, dexHelper.provider);
      const balance = BigInt(
        (
          await erc20.balanceOf(p.poolAddress, { blockTag: blockNumber })
        ).toString(),
      );
      if (balance === 0n) continue;
      // Prefer the pool whose inventory is worth the most ETH (balance*rate).
      if (!best || balance * rate > best.balance * best.rate) {
        best = {
          poolAddress: p.poolAddress,
          tokenAddress: p.tokenAddress,
          tokenSymbol: p.tokenSymbol,
          tokenDecimals: p.tokenDecimals,
          rate,
          balance,
        };
      }
    } catch (e) {
      // token not routable by the oracle on this chain — skip quietly
    }
  }
  return best;
}

describe('FlowState (integration, live)', () => {
  // Arbitrum carries most active pools; the module + config are chain-agnostic.
  const network = Network.ARBITRUM;
  const dexHelper = new DummyDexHelper(network);
  const flowState = new FlowState(network, DEX_KEY, dexHelper);
  const ETH: Token = { address: ETHER_ADDRESS, decimals: 18 };

  let blockNumber: number;
  let live: LivePool | null;
  let identifier: string;

  beforeAll(async () => {
    blockNumber = await dexHelper.provider.getBlockNumber();
    live = await pickLivePool(dexHelper, network, blockNumber);
    if (!live) {
      console.warn(
        `[FlowState] No priceable inventory on chain ${network} @ block ${blockNumber} — pricing assertions will skip.`,
      );
      return;
    }
    identifier = `${DEX_KEY}_${live.poolAddress.toLowerCase()}`;
    const unitTokensPerEth = (E18 * E18) / live.rate; // tokens (smallest units) per 1 ETH
    const humanPerEth =
      Number(unitTokensPerEth) / 10 ** live.tokenDecimals;
    console.log(
      `[FlowState] Anchor ${live.tokenSymbol} pool=${live.poolAddress} ` +
        `balance=${live.balance} rate=${live.rate} ` +
        `=> ~${humanPerEth.toLocaleString()} ${live.tokenSymbol}/ETH`,
    );
  });

  it('discovers the live pool for ETH -> TOKEN SELL', async () => {
    if (!live) return;
    const token: Token = {
      address: live.tokenAddress,
      decimals: live.tokenDecimals,
    };
    const ids = await flowState.getPoolIdentifiers(
      ETH,
      token,
      SwapSide.SELL,
      blockNumber,
    );
    expect(ids).toContain(identifier);
  });

  it('prices ETH -> TOKEN identically to an independent on-chain recompute, capped by inventory', async () => {
    if (!live) return;
    const token: Token = {
      address: live.tokenAddress,
      decimals: live.tokenDecimals,
    };

    // capEth = ETH-wei needed to buy the entire pool balance at the oracle rate.
    const capEth = (live.balance * live.rate) / E18;
    if (capEth === 0n) {
      console.warn('[FlowState] Inventory rounds to <1 wei of ETH — skipping.');
      return;
    }

    const amounts = [
      0n,
      capEth / 5n,
      capEth / 2n,
      (capEth * 9n) / 10n,
      capEth,
      capEth + capEth / 2n, // deliberately over the cap
    ];

    const poolPrices = await flowState.getPricesVolume(
      ETH,
      token,
      amounts,
      SwapSide.SELL,
      blockNumber,
      [identifier],
    );
    expect(poolPrices).not.toBeNull();

    const entry = poolPrices!.find(
      pp => pp.poolAddresses![0].toLowerCase() === live!.poolAddress.toLowerCase(),
    );
    expect(entry).toBeDefined();

    // Independent recompute using the EXACT contract formula (publicPool.sol:444).
    const expected = amounts.map(a => {
      if (a === 0n) return 0n;
      const out = (a * E18) / live!.rate;
      return out > live!.balance ? 0n : out;
    });

    expect(entry!.prices).toEqual(expected);
    // At least one real, fillable quote…
    expect(entry!.prices.some(x => x > 0n)).toBe(true);
    // …and the over-cap request must be unfillable (0), never an overfill.
    expect(entry!.prices[entry!.prices.length - 1]).toBe(0n);
  });

  it('surfaces the pool via getTopPoolsForToken with a native-ETH connector', async () => {
    if (!live) return;
    const top = await flowState.getTopPoolsForToken(live.tokenAddress, 10);
    const entry = top.find(
      p => p.address.toLowerCase() === live!.poolAddress.toLowerCase(),
    );
    expect(entry).toBeDefined();
    expect(entry!.connectorTokens[0].address.toLowerCase()).toBe(
      ETHER_ADDRESS.toLowerCase(),
    );
  });
});
