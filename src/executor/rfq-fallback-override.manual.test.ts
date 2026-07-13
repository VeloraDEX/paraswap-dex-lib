import dotenv from 'dotenv';
dotenv.config();

/**
 * MANUAL (FORCE_REVERT_MANUAL=1): unified revertable-fallback A/B over real
 * prod RFQ routes. One approach for every venue:
 *
 *   1. Build targeting the OLD executor address the firm quote is baked to
 *      (taker/recipient) — set via executorsAddresses.
 *   2. Override that address's code with the deployed fallback bytecode in the
 *      Tenderly sim, so the group runs on fallback-capable code while the RFQ
 *      auth (msg.sender == taker) still matches.
 *   3. Simulate at the route's pinned block: baseline (RFQ fills) and
 *      forceRfqRevert (RFQ reverts -> fallback fills).
 *
 * This subsumes the old per-venue harnesses and the recipient-rewrite hack:
 * building on the baked executor makes the recipient match with no rewrite.
 */
import { OptimalRate } from '@paraswap/core';
import { LocalParaswapSDK } from '../implementations/local-paraswap-sdk';
import { TenderlySimulator, StateOverride } from '../tenderly-simulation';
import { TxObject } from '../types';

jest.setTimeout(600 * 1000);
const GROUP_STEP_RE = /0{40}[0-9a-f]{8}0000[0-9a-f]{4}[0-9a-f]{2}ff[0-9a-f]{4}/;
const enabled = process.env.FORCE_REVERT_MANUAL === '1';

// Executors the prod firm quotes are baked to, and their fallback-capable
// redeployments (same address across chains) whose code we inject.
const OLD = {
  Executor01: '0x8faa0000c10015610005ca010ee000d006e0e820',
  Executor02: '0x6f0538001f90d0a5f0000060d01d34c002030900',
};
const NEW = {
  Executor01: '0x3D546f0181b78b97c1a3C33CAb23AA443E26EAB4',
  Executor02: '0x30E7Fcd8700D023f9767745395C636142db52108',
};

type Case = { name: string; fixture: string; dexKeys: string[] };
const CASES: Case[] = [
  {
    name: 'Dexalot',
    fixture: 'route1-dexalot',
    dexKeys: ['Dexalot', 'CamelotV3', 'SushiSwap'],
  },
  {
    name: 'Metric',
    fixture: 'metric-force-revert-route',
    dexKeys: ['Metric', 'UniswapV3', 'CurveV1StableNg'],
  },
  {
    name: 'Native',
    fixture: 'route-native',
    dexKeys: ['Native', 'WooFiV2', 'UniswapV3', 'UniswapV4'],
  },
  {
    name: 'Hashflow',
    fixture: 'route-hashflow',
    dexKeys: ['Hashflow', 'UniswapV4', 'LitePsm'],
  },
  {
    name: 'ParaSwapPool',
    fixture: 'route-psp',
    dexKeys: ['ParaSwapLimitOrders', 'UniswapV4', 'UniswapV3', 'Ekubo'],
  },
];

const rpc = (net: number) => process.env['HTTP_PROVIDER_' + net];

async function fetchCode(net: number, addr: string): Promise<string> {
  const res = await fetch(rpc(net)!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getCode',
      params: [addr, 'latest'],
    }),
  });
  return ((await res.json()) as { result: string }).result;
}

function loadRoute(fixture: string): {
  pr: OptimalRate;
  userAddress: string;
  uuid: string;
  deadline: string;
} {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = require(`./fixtures/${fixture}.json`);
  const pr = JSON.parse(JSON.stringify(raw.priceRoute)) as OptimalRate;
  // ParaSwapPoolN -> ParaSwapLimitOrders (byte-identical getDexParam) so the
  // SDK resolves a builder without per-maker rfqConfigs.
  pr.bestRoute.forEach(r =>
    r.swaps.forEach(s =>
      s.swapExchanges.forEach((se: any) => {
        if ((se.exchange || '').toLowerCase().startsWith('paraswappool')) {
          se.exchange = 'ParaSwapLimitOrders';
        }
      }),
    ),
  );
  return {
    pr,
    userAddress: raw.userAddress,
    uuid: raw.uuid,
    deadline: String(raw.deadline ?? 2000000000),
  };
}

(enabled ? describe : describe.skip)(
  'RFQ fallback A/B (bytecode override)',
  () => {
    describe.each(CASES)('$name', ({ fixture, dexKeys }) => {
      const { pr, userAddress, uuid, deadline } = loadRoute(fixture);
      const net = pr.network;

      const build = async (forceRfqRevert: boolean) => {
        const sdk = new LocalParaswapSDK(net, dexKeys, '');
        sdk.skipPreProcess = true;
        sdk.dexHelper.config.data.executorsAddresses = { ...OLD };
        try {
          const minOut = ((BigInt(pr.destAmount) * 9000n) / 10000n).toString();
          return (await sdk.transactionBuilder.build({
            priceRoute: pr,
            minMaxAmount: minOut,
            userAddress,
            partnerAddress: userAddress,
            partnerFeePercent: '0',
            deadline,
            uuid,
            getDexParamOptions: { forceRfqRevert },
          })) as TxObject;
        } finally {
          await sdk.releaseResources?.();
        }
      };

      const simulate = async (data: string, label: string) => {
        const sim = TenderlySimulator.getInstance();
        const so: StateOverride = {};
        so[OLD.Executor01] = { code: await fetchCode(net, NEW.Executor01) };
        so[OLD.Executor02] = { code: await fetchCode(net, NEW.Executor02) };
        const fund = BigInt(pr.srcAmount) * 4n;
        await sim.addTokenBalanceOverride(
          so,
          net,
          pr.srcToken,
          userAddress,
          fund,
        );
        await sim.addAllowanceOverride(
          so,
          net,
          pr.srcToken,
          userAddress,
          pr.contractAddress,
          fund,
        );
        const { simulation } = await sim.simulateTransaction({
          chainId: net,
          from: userAddress,
          to: pr.contractAddress,
          data,
          value: '0',
          blockNumber: pr.blockNumber,
          stateOverride: so,
        });
        // eslint-disable-next-line no-console
        console.log(
          `${label}: status=${simulation.status} https://dashboard.tenderly.co/simulator/${simulation.id}`,
        );
        return simulation;
      };

      it('baseline: RFQ primary fills', async () => {
        const params = await build(false);
        expect(params.data!.replace('0x', '')).toMatch(GROUP_STEP_RE);
        const sim = await simulate(params.data!, `${fixture}-baseline`);
        expect(sim.status).toBe(true);
      });

      it('forceRfqRevert: RFQ reverts, fallback fills', async () => {
        const params = await build(true);
        const sim = await simulate(params.data!, `${fixture}-forceRevert`);
        expect(sim.status).toBe(true);
      });
    });
  },
);
