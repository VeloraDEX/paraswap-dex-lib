import dotenv from 'dotenv';

dotenv.config();

import { ERC4626EventPool } from './erc-4626-pool';
import { ERC4626Config } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import ERC4626_ABI from '../../abi/ERC4626.json';
import {
  DEPOSIT_TOPIC,
  LOG_DERIVABLE_STATE_VAULTS,
  TRANSFER_TOPIC,
  WITHDRAW_TOPIC,
} from './constants';
import { Address, BlockHeader, Log } from '../../types';

import { Interface } from '@ethersproject/abi';

jest.setTimeout(5 * 60 * 1000);

const LOGS_RANGE = 10000;

// Windows are pinned so the replay is reproducible, and each one has to cover both the
// plain deposit/withdraw calls and the relayer-driven ones, whose fees are what made the
// tracked `totalAssets` drift away from the vault's own accounting.
const replayWindows: {
  [dexKey: string]: { [network: number]: { from: number; to: number } };
} = {
  sftUSD: {
    [Network.MAINNET]: { from: 25850000, to: 25888000 },
  },
};

async function fetchLogs(
  dexHelper: DummyDexHelper,
  addresses: Address[],
  from: number,
  to: number,
): Promise<Log[]> {
  const logs: Log[] = [];

  for (const address of addresses) {
    for (let start = from; start <= to; start += LOGS_RANGE) {
      const chunk = await dexHelper.provider.getLogs({
        address,
        fromBlock: start,
        toBlock: Math.min(start + LOGS_RANGE - 1, to),
      });
      logs.push(...(chunk as unknown as Log[]));
    }
  }

  return logs.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );
}

async function fetchBlockHeaders(
  dexHelper: DummyDexHelper,
  blockNumbers: number[],
): Promise<{ [blockNumber: number]: BlockHeader }> {
  const headers = await Promise.all(
    blockNumbers.map(blockNumber => dexHelper.provider.getBlock(blockNumber)),
  );

  return Object.fromEntries(
    headers.map((header, i) => [
      blockNumbers[i],
      <BlockHeader>(<unknown>header),
    ]),
  );
}

describe('ERC4626 Replay Tests', function () {
  for (const dexKey of Object.keys(ERC4626Config)) {
    // only vaults whose state is fully derivable from logs can be replayed
    if (!LOG_DERIVABLE_STATE_VAULTS.has(dexKey)) continue;

    describe(`${dexKey}`, function () {
      for (const net of Object.keys(ERC4626Config[dexKey])) {
        const network = Number(net) as Network;
        const window = replayWindows[dexKey]?.[network];

        if (!window) {
          it.skip(`No replay window defined for ${dexKey} on ${Network[network]}`, () => {});
          continue;
        }

        const { vault, asset, backingToken } = ERC4626Config[dexKey][network];

        it(`Should hold state over ${
          window.to - window.from
        } blocks of events`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const pool = new ERC4626EventPool(
            dexKey,
            network,
            `${dexKey}-replay`,
            dexHelper,
            vault,
            asset,
            new Interface(ERC4626_ABI),
            dexHelper.getLogger(dexKey),
            DEPOSIT_TOPIC,
            WITHDRAW_TOPIC,
            TRANSFER_TOPIC,
            false,
            backingToken,
          );

          // seed once, then let the logs carry the state the whole way
          pool.setState(await pool.generateState(window.from), window.from);
          pool.isTracking = () => true;

          const logs = await fetchLogs(
            dexHelper,
            pool.addressesSubscribed,
            window.from + 1,
            window.to,
          );
          expect(logs.length).toBeGreaterThan(0);

          const logsByBlock = logs.reduce<{ [blockNumber: number]: Log[] }>(
            (acc, log) => {
              (acc[log.blockNumber] ??= []).push(log);
              return acc;
            },
            {},
          );
          const blockNumbers = Object.keys(logsByBlock)
            .map(Number)
            .sort((a, b) => a - b);
          const blockHeaders = await fetchBlockHeaders(dexHelper, blockNumbers);

          // a vault event is what moves the state, so that is where it is worth comparing
          const vaultEventBlocks = new Set(
            logs
              .filter(
                log =>
                  log.address.toLowerCase() === vault.toLowerCase() &&
                  [DEPOSIT_TOPIC, WITHDRAW_TOPIC].includes(log.topics[0]),
              )
              .map(log => log.blockNumber),
          );
          expect(vaultEventBlocks.size).toBeGreaterThan(5);

          for (const blockNumber of blockNumbers) {
            await pool.update(logsByBlock[blockNumber], {
              [blockNumber]: blockHeaders[blockNumber],
            });

            if (!vaultEventBlocks.has(blockNumber)) continue;

            expect(pool.getState(blockNumber)).toEqual(
              await pool.generateState(blockNumber),
            );
          }

          // and once more at the end of the window, to catch anything in between
          expect(pool.getState(window.to)).toEqual(
            await pool.generateState(window.to),
          );
        });
      }
    });
  }
});
