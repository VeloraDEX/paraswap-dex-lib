import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { BlockHeader, Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { generalDecoder } from '../../lib/decoders';
import { getTopicLogDecoder } from '../../lib/topic-log-decoder';
import { BytesLike } from 'ethers';
import { OrbitalPoolInfo, PoolState } from './types';
import { quoteExactInput, quoteExactOutput } from './contract-math/quote';
import { initializedTicks, TickRecord } from './contract-math/tick';

// Events that change a quote input. Collect pays fees from custody and changes none.
const SWAP_EVENTS = new Set(['Swap', 'SwapExactOutput']);
// Mint and Burn certify their state with a repair this integration does not port; Shutdown closes swaps.
const REFETCH_EVENTS = new Set(['Mint', 'Burn', 'Shutdown']);

export class OrbitalEventPool extends StatefulEventSubscriber<PoolState> {
  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    readonly poolInfo: OrbitalPoolInfo,
    protected poolIface: Interface,
  ) {
    super(parentName, poolInfo.address.toLowerCase(), dexHelper, logger);
    this.logDecoder = (log: Log) =>
      getTopicLogDecoder(this.poolIface).decode(log);
    this.addressesSubscribed = [poolInfo.address];
  }

  /**
   * A Swap or SwapExactOutput log is replayed through the exact quote path and checked against the logged amounts;
   * a Mint, Burn or Shutdown regenerates the state at the end of the log's block.
   */
  protected async processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const event = this.decode(log);
    if (!event) return null;
    if (REFETCH_EVENTS.has(event.name))
      return this.generateState(log.blockNumber);
    if (!SWAP_EVENTS.has(event.name)) return null;
    try {
      return this.replaySwap(state, event);
    } catch (e) {
      this.logger.warn(
        `${this.parentName}: ${this.name} replay failed at block ${log.blockNumber}, regenerating state`,
        e,
      );
      return this.generateState(log.blockNumber);
    }
  }

  /**
   * One block at a time. A state generated at a block already holds every log of that block, so a block with a Mint,
   * Burn or Shutdown is regenerated once instead of replaying its other logs on top of the fresh state (a Swap after a
   * Mint in the same block would otherwise be applied twice).
   */
  protected async processBlockLogs(
    state: DeepReadonly<PoolState>,
    logs: Readonly<Log>[],
    blockHeader: Readonly<BlockHeader>,
  ): Promise<DeepReadonly<PoolState> | null> {
    const events = logs.map(log => this.decode(log));
    if (events.some(event => event && REFETCH_EVENTS.has(event.name)))
      return this.generateState(logs[0].blockNumber);
    let next: DeepReadonly<PoolState> | null = null;
    for (const log of logs) {
      const replayed = await this.processLog(next ?? state, log);
      if (replayed) next = replayed;
    }
    return next;
  }

  private decode(log: Readonly<Log>): any | null {
    try {
      return this.logDecoder(log);
    } catch (e) {
      catchParseLogError(e, this.logger);
      return null;
    }
  }

  private replaySwap(
    state: DeepReadonly<PoolState>,
    event: any,
  ): DeepReadonly<PoolState> {
    const assetIn = Number(event.args.assetIn);
    const assetOut = Number(event.args.assetOut);
    const amountIn = BigInt(event.args.amountIn.toString());
    const amountOut = BigInt(event.args.amountOut.toString());
    const current = state as PoolState;
    if (event.name === 'Swap') {
      const quote = quoteExactInput(current, assetIn, assetOut, amountIn);
      if (quote.amountOut !== amountOut)
        throw new Error(
          `Swap replay mismatch: engine ${quote.amountOut}, log ${amountOut}`,
        );
      return { ...current, ...quote.nextState };
    }
    const quote = quoteExactOutput(current, assetIn, assetOut, amountOut);
    if (quote.amountIn !== amountIn)
      throw new Error(
        `SwapExactOutput replay mismatch: engine ${quote.amountIn}, log ${amountIn}`,
      );
    return { ...current, ...quote.nextState };
  }

  /** Reads the quote state at the end of `blockNumber`: hot state and bitmap, then every initialized tick. */
  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<PoolState>> {
    const pool = this.poolInfo.address;
    const call = (
      functionName: string,
      types: string[],
      parser?: (v: any) => any,
    ): MultiCallParams<any> => ({
      target: pool,
      callData: this.poolIface.encodeFunctionData(functionName),
      decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
        generalDecoder(result, types, undefined, parser),
    });
    const block = blockNumber === 'latest' ? undefined : blockNumber;

    const [isShutdown, reserves, geometry, bitmap] =
      await this.dexHelper.multiWrapper.aggregate<any>(
        [
          call('isShutdown', ['bool']),
          call('getInvariantReserves', ['uint256[3]'], v =>
            v[0].map((x: any) => BigInt(x.toString())),
          ),
          call(
            'geometry',
            [
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'uint256',
              'int24',
              'uint16',
            ],
            v => v.map((x: any) => BigInt(x.toString())),
          ),
          call('tickBitmap', ['uint256'], v => BigInt(v[0].toString())),
        ],
        block,
      );

    const tickIndices = initializedTicks(bitmap);
    const records = await this.dexHelper.multiWrapper.aggregate<TickRecord>(
      tickIndices.map(tick => ({
        target: pool,
        callData: this.poolIface.encodeFunctionData('ticks', [tick]),
        decodeFunction: (result: MultiResult<BytesLike> | BytesLike) =>
          generalDecoder(
            result,
            ['uint128', 'uint128', 'uint128', 'uint128', 'uint64'],
            undefined,
            v => ({
              r: BigInt(v[0].toString()),
              k: BigInt(v[1].toString()),
              s: BigInt(v[2].toString()),
              kNorm: BigInt(v[4].toString()),
            }),
          ),
      })),
      block,
    );
    const ticks: Record<number, TickRecord> = {};
    tickIndices.forEach((tick, i) => {
      ticks[tick] = records[i];
    });

    const [rInt, kBound, sBound, totalRadius, floor, top, count] = geometry;
    const scale = (decimals: number) => 10n ** BigInt(18 - decimals);
    return {
      reserves: [reserves[0], reserves[1], reserves[2]],
      rInt,
      kBound,
      sBound,
      totalRadius,
      floor,
      topBoundary: Number(top),
      boundaryTickCount: Number(count),
      bitmap,
      ticks,
      fee: this.poolInfo.fee,
      scales: [
        scale(this.poolInfo.decimals[0]),
        scale(this.poolInfo.decimals[1]),
        scale(this.poolInfo.decimals[2]),
      ],
      isShutdown: Boolean(isShutdown),
    };
  }
}
