import { hexlify } from '@ethersproject/bytes';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulRpcPoller } from '../../lib/stateful-rpc-poller/stateful-rpc-poller';
import { pollingManagerCbExtractor } from '../../lib/stateful-rpc-poller/utils';
import { StatePollingManager } from '../../lib/stateful-rpc-poller/state-polling-manager';
import { MultiCallParams } from '../../lib/multi-wrapper';
import { extractSuccessAndValue } from '../../lib/decoders';
import { PoolConfig, PoolState } from './types';
import {
  decodeSnapshot,
  SNAPSHOT_WORDS,
  snapshotCalls,
  words,
} from './mhoc-desk-state';

// RPC polling rather than events: the pool's price updates are 32 bytes of calldata to its fallback and emit no
// event (by design, to keep each update at ~29k gas; only an update that halts the pool logs UpdateHalted), so an
// event subscriber would only see swaps. One multicall per block reads the whole state, including the raw counters
// and block.timestamp, which the expiry and the per-minute counter use. A card that is not refreshed expires on
// chain after at most MAX_TTL seconds, and the pricing then returns no liquidity rather than a stale price.
export class MhocDeskPollingPool extends StatefulRpcPoller<
  PoolState,
  bigint[]
> {
  constructor(
    dexKey: string,
    poolIdentifier: string,
    dexHelper: IDexHelper,
    readonly pool: PoolConfig,
  ) {
    const callbacks = pollingManagerCbExtractor(
      StatePollingManager.getInstance(dexHelper),
    );
    // liquidity is not tracked: always keep the state fresh
    super(dexKey, poolIdentifier, dexHelper, 0, 0, false, callbacks);
  }

  protected _getFetchStateMultiCalls(): MultiCallParams<bigint[]>[] {
    return snapshotCalls(
      this.pool.address,
      this.pool.base.address,
      this.pool.quote.address,
      this.dexHelper.multiContract.options.address,
    ).map((c, i) => ({
      ...c,
      decodeFunction: result => {
        const [ok, data] = extractSuccessAndValue(result);
        if (!ok) throw new Error(`mhoc-desk: read ${i} failed`);
        return words(hexlify(data), SNAPSHOT_WORDS[i]);
      },
    }));
  }

  // The base class prepends its own getBlockNumber call and strips it before calling this; the block number of the
  // state is tracked by the base class (setState). It is copied into the snapshot by the dex when pricing.
  protected _parseStateFromMultiResults(multiOutputs: bigint[][]): PoolState {
    return decodeSnapshot(multiOutputs, 0);
  }
}
