import { Address, Logger } from '../../types';
import { IDexHelper } from '../../dex-helper';

import { StableSwapState, MetapoolState } from './math/stable-swap';
import { curveStableNgIface as curveIface } from './clear-ifaces';

type RawPoolSnapshot = {
  initialA: bigint;
  futureA: bigint;
  initialATime: bigint;
  futureATime: bigint;
  fee: bigint;
  offpegFeeMultiplier: bigint;
  storedRates: bigint[];
  balances: bigint[];
  totalSupply: bigint;
  virtualPrice: bigint;
};

// Holds Curve NG pool state used by the StableSwap math; refreshed periodically via multicall.
export class ClearCurvePoolState {
  state?: StableSwapState;
  nCoins: number;

  constructor(
    public readonly poolAddress: Address,
    nCoins: number,
    protected dexHelper: IDexHelper,
    protected logger: Logger,
  ) {
    this.nCoins = nCoins;
  }

  // Multicall snapshot of all the values needed by the StableSwap math.
  async refresh(blockNumber: number): Promise<void> {
    const snapshot = await this.fetchSnapshot(blockNumber);
    if (!snapshot) return;

    // NG rate multipliers come from contract immutables (10**(36-decimals)). For our purposes,
    // storedRates already encodes the live rate (incl. virtual price for metapool index 1),
    // so we use it for both rates and storedRates.
    this.state = {
      balances: snapshot.balances,
      a_initial: snapshot.initialA,
      a_final: snapshot.futureA,
      a_initial_time: snapshot.initialATime,
      a_final_time: snapshot.futureATime,
      fee: snapshot.fee,
      offpegFeeMultiplier: snapshot.offpegFeeMultiplier,
      rates: snapshot.storedRates,
      storedRates: snapshot.storedRates,
      lpTotalSupply: snapshot.totalSupply,
    };
  }

  // Uses tryAggregate so a single revert (e.g. get_virtual_price on an empty pool) doesn't kill
  // the batch — we surface it as a null snapshot and the consumer skips the metapool gracefully.
  protected async fetchSnapshot(
    blockNumber: number,
  ): Promise<RawPoolSnapshot | null> {
    const decodeUint =
      (fnName: string) =>
      (raw: any): bigint =>
        BigInt(curveIface.decodeFunctionResult(fnName, raw)[0].toString());

    const calls = [
      { fn: 'initial_A' },
      { fn: 'future_A' },
      { fn: 'initial_A_time' },
      { fn: 'future_A_time' },
      { fn: 'fee' },
      { fn: 'offpeg_fee_multiplier' },
      { fn: 'totalSupply' },
      { fn: 'get_virtual_price' },
      { fn: 'stored_rates' },
      ...Array.from({ length: this.nCoins }, (_, i) => ({
        fn: 'balances',
        args: [i],
      })),
    ];

    const params = calls.map(c => ({
      target: this.poolAddress,
      callData: curveIface.encodeFunctionData(c.fn, (c as any).args ?? []),
      decodeFunction:
        c.fn === 'stored_rates'
          ? (raw: any): bigint[] => {
              const decoded = curveIface.decodeFunctionResult(
                'stored_rates',
                raw,
              );
              return (decoded[0] as any[]).map(v => BigInt(v.toString()));
            }
          : decodeUint(c.fn),
    }));

    const result = await this.dexHelper.multiWrapper.tryAggregate<
      bigint | bigint[]
    >(false, params as any, blockNumber);

    // If any required scalar reverted (e.g. empty pool), treat as inactive.
    if (result.slice(0, 9).some(r => !r.success)) {
      this.logger.debug(
        `${this.poolAddress}: curve snapshot unavailable (pool likely empty)`,
      );
      return null;
    }

    const balances: bigint[] = [];
    for (let i = 0; i < this.nCoins; i++) {
      const r = result[9 + i];
      if (!r.success) return null;
      balances.push(r.returnData as bigint);
    }

    return {
      initialA: result[0].returnData as bigint,
      futureA: result[1].returnData as bigint,
      initialATime: result[2].returnData as bigint,
      futureATime: result[3].returnData as bigint,
      fee: result[4].returnData as bigint,
      offpegFeeMultiplier: result[5].returnData as bigint,
      totalSupply: result[6].returnData as bigint,
      virtualPrice: result[7].returnData as bigint,
      balances,
      storedRates: result[8].returnData as bigint[],
    };
  }
}

// Composes a metapool's pricing snapshot (metapool + base pool) ready to feed `getDyUnderlying`.
export class ClearCurveMetapool {
  constructor(
    public readonly metapool: ClearCurvePoolState,
    public readonly basePool: ClearCurvePoolState,
  ) {}

  async refresh(blockNumber: number): Promise<void> {
    await Promise.all([
      this.metapool.refresh(blockNumber),
      this.basePool.refresh(blockNumber),
    ]);
  }

  // Builds the MetapoolState for math/stable-swap.ts; null when state is incomplete.
  getMetapoolState(): MetapoolState | null {
    const meta = this.metapool.state;
    const base = this.basePool.state;
    if (!meta || !base) return null;
    // The metapool's storedRates[1] is the live base-pool virtual price (NG convention).
    const basePoolVirtualPrice = meta.storedRates[1] ?? 0n;
    return { metapool: meta, basePool: base, basePoolVirtualPrice };
  }
}
