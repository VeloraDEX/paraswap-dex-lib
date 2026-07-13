import dotenv from 'dotenv';
dotenv.config();

/**
 * MANUAL (FORCE_REVERT_MANUAL=1): end-to-end check against the DEPLOYED staging
 * API. Mirrors the subscription-service driver: build via staging /transactions
 * (skipPreProcess + forceRfqRevert + enableFallbackEncoding, HMAC disabled), then
 * Tenderly-simulate with the old-executor bytecode override.
 */
import axios from 'axios';
import { OptimalRate } from '@paraswap/core';
import { TenderlySimulator, StateOverride } from '../tenderly-simulation';

jest.setTimeout(600 * 1000);
const enabled = process.env.FORCE_REVERT_MANUAL === '1';
const STAGING = 'https://api.staging.paraswap.io';
const GROUP_STEP_RE = /0{40}[0-9a-f]{8}0000[0-9a-f]{4}[0-9a-f]{2}ff[0-9a-f]{4}/;

const OLD = {
  Executor01: '0x8faa0000c10015610005ca010ee000d006e0e820',
  Executor02: '0x6f0538001f90d0a5f0000060d01d34c002030900',
};
const NEW = {
  Executor01: '0x3D546f0181b78b97c1a3C33CAb23AA443E26EAB4',
  Executor02: '0x30E7Fcd8700D023f9767745395C636142db52108',
};
const ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// route-psp excluded: staging config service lacks the ParaSwapPool19 maker
// (generic-RFQ), so the build can't resolve it — a staging-env gap, not a bug.
const CASES = [
  'route1-dexalot',
  'route-hashflow',
  'route-native',
  'metric-force-revert-route',
];

const getCode = async (net: number, addr: string): Promise<string> => {
  const res = await fetch(process.env[`HTTP_PROVIDER_${net}`]!, {
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
};

const deepestRevert = (node: any): string | undefined => {
  let reason: string | undefined;
  const walk = (n: any) => {
    if (!n) return;
    if (n.error) reason = n.error;
    (n.calls || []).forEach(walk);
  };
  walk(node);
  return reason;
};

(enabled ? describe : describe.skip)('staging fallback A/B', () => {
  describe.each(CASES)('%s', fixture => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require(`./fixtures/${fixture}.json`);
    const pr = raw.priceRoute as OptimalRate;
    const net = pr.network;
    const userAddress = raw.userAddress;

    const buildViaStaging = async (forceRfqRevert: boolean) => {
      const minOut = ((BigInt(pr.destAmount) * 9000n) / 10000n).toString();
      const body = {
        srcToken: pr.srcToken,
        destToken: pr.destToken,
        srcAmount: pr.srcAmount,
        destAmount: pr.side === 'SELL' ? minOut : pr.destAmount,
        srcDecimals: pr.srcDecimals,
        destDecimals: pr.destDecimals,
        priceRoute: { ...pr, others: [] },
        userAddress,
      };
      const params = [
        'ignoreChecks=true',
        'enableFallbackEncoding=true',
        'skipPreProcess=true',
        `forceRfqRevert=${forceRfqRevert}`,
      ].join('&');
      const { data } = await axios.post(
        `${STAGING}/transactions/${net}?${params}`,
        body,
        { headers: { 'X-Service-Id': 'fallback-replayer' } },
      );
      return data as { from: string; to: string; data: string; value: string };
    };

    const simulate = async (tx: any, label: string) => {
      const sim = TenderlySimulator.getInstance();
      const so: StateOverride = {};
      so[OLD.Executor01] = { code: await getCode(net, NEW.Executor01) };
      so[OLD.Executor02] = { code: await getCode(net, NEW.Executor02) };
      const fund = BigInt(pr.srcAmount) * 4n;
      if (pr.srcToken.toLowerCase() === ETH) {
        sim.addBalanceOverride(so, userAddress, fund);
      } else {
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
          tx.to,
          fund,
        );
      }
      const { simulation, transaction } = await sim.simulateTransaction({
        chainId: net,
        from: userAddress,
        to: tx.to,
        data: tx.data,
        value: tx.value ?? '0',
        blockNumber: pr.blockNumber,
        stateOverride: so,
      });
      const reason = simulation.status
        ? deepestRevert(transaction.transaction_info?.call_trace)
        : (simulation as any).error_message;
      // eslint-disable-next-line no-console
      console.log(
        `${fixture}-${label}: status=${simulation.status} reason=${
          reason ?? '-'
        } https://dashboard.tenderly.co/simulator/${simulation.id}`,
      );
      return { status: simulation.status, reason };
    };

    it('baseline: RFQ primary fills', async () => {
      const tx = await buildViaStaging(false);
      expect(tx.data.replace('0x', '')).toMatch(GROUP_STEP_RE);
      const { status } = await simulate(tx, 'baseline');
      expect(status).toBe(true);
    });

    it('forceRfqRevert: RFQ reverts, fallback fills', async () => {
      const tx = await buildViaStaging(true);
      // Success here = the fallback filled after the forced primary revert.
      // (The baseline test proves the primary fills without the flag, so a
      // forceRevert success can only mean the fallback path ran.) The revert
      // reason is logged for inspection — it varies by venue (ECDSA / RF-IS /
      // impossible min-out with no string) so it isn't asserted.
      const { status } = await simulate(tx, 'forceRevert');
      expect(status).toBe(true);
    });
  });
});
