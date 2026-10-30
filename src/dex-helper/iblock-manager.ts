import { Address, Log, BlockHeader } from '../types';
import { AsyncOrSync } from 'ts-essentials';

export interface EventSubscriber {
  //Contains a descriptive name for this subscriber, to be shown in logs etc.
  readonly parentName: string;

  readonly name: string;

  //This field is set by BlockManager when you call subscribeToLogs() on it.
  //If isTracking() returns false (which should be a temporary condition),
  //implementers must not present states older than the latest/requested block
  //number to any query.
  //If isTracking() returns true, it is assumed that all logs up to the latest
  //block has been processed, hence it is fine to return the last calculated
  //state.
  isTracking: () => boolean;

  //Indicates that all events up to the given block number will be skipped.
  //When this is called, all states with block number less than the given block
  //number must be discarded.
  restart(blockNumber: number): void;

  //Called to roll forward the state from log events and clear the invalid flag
  //if it has been set.  It is assumed that the logs are presented in
  //chronological order.  If there are no logs in the array, just clear the
  //invalid flag.
  //N.B. multiple blocks worth of logs may be passed into the same call.
  update(
    logs: Readonly<Log>[],
    blockHeaders: Readonly<{ [blockNumber: number]: Readonly<BlockHeader> }>,
    blockNumberForMissingStateRegen?: number,
  ): AsyncOrSync<void>;

  //Will be called on a chain reorganization prior to updating with new logs.
  //All state corresponding to blocks after the given number must be discarded,
  //except for the most recent state, if the invalid flag isn't still set.
  rollback(blockNumber: number): void;

  //This will be called to set an invalid flag, when the block manager cannot
  //guarantee that all previously derived states are valid.  When this flag is
  //set, it is not permitted to present any pre-existing state to any query.
  //This invalid flag can be cleared when a new state is derived without using
  //logs, or otherwise when update() is called.
  invalidate(): void;
}

export interface IBlockManager {
  subscribeToLogs(
    subscriber: EventSubscriber,
    contractAddress: Address | Address[],
    afterBlockNumber: number,
  ): void;

  //This return the latest blockNumber that the blockManager has processed
  getLatestBlockNumber(): number;

  //This return the latest active BlockHeader
  getActiveChainHead(): Readonly<BlockHeader> | undefined;
}
