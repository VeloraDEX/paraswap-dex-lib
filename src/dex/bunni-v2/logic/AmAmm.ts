import { NULL_ADDRESS } from '../../../constants';
import { MIN_BID_MULTIPLIER, ZERO_BYTES_6 } from '../lib/Constants';
import { max, min, mulWad } from '../lib/Math';
import { Bid, PoolState } from '../types';

export function getTopBid(
  state: PoolState,
  blockNumber: bigint,
  deploymentBlockNumber: bigint,
  K: bigint,
): Bid {
  const { topBid } = _updateAmAmmView(
    state,
    blockNumber,
    deploymentBlockNumber,
    K,
  );

  return topBid;
}

export function getTopBidWrite(
  state: PoolState,
  blockNumber: bigint,
  deploymentBlockNumber: bigint,
  K: bigint,
): Bid {
  _updateAmAmmWrite(state, blockNumber, deploymentBlockNumber, K);

  return state.topBid;
}

export function _updateAmAmmWrite(
  state: PoolState,
  blockNumber: bigint,
  deploymentBlockNumber: bigint,
  K: bigint,
): { manager: string; payload: string } {
  const currentBlockIdx = blockNumber - deploymentBlockNumber;

  let topBid = state.topBid;
  let nextBid = state.nextBid;
  let updatedTopBid: boolean = false;
  let updatedNextBid: boolean = false;
  let rentCharged: bigint = 0n;

  let stepHasUpdatedTopBid: boolean = false;
  let stepHasUpdatedNextBid: boolean = false;
  let stepRentCharged: bigint = 0n;

  while (true) {
    ({
      topBid,
      nextBid,
      updatedTopBid: stepHasUpdatedTopBid,
      updatedNextBid: stepHasUpdatedNextBid,
    } = _stateTransition(currentBlockIdx, topBid, nextBid, K));

    if (!stepHasUpdatedTopBid && !stepHasUpdatedNextBid) {
      break;
    }

    updatedTopBid = updatedTopBid || stepHasUpdatedTopBid;
    updatedNextBid = updatedNextBid || stepHasUpdatedNextBid;
    rentCharged += stepRentCharged;
  }

  if (updatedTopBid) state.topBid = topBid;
  if (updatedNextBid) state.nextBid = nextBid;

  return { manager: topBid.manager, payload: topBid.payload };
}

export function _updateAmAmmView(
  state: PoolState,
  blockNumber: bigint,
  deploymentBlockNumber: bigint,
  K: bigint,
): { topBid: Bid; nextBid: Bid } {
  const currentBlockIdx = blockNumber - deploymentBlockNumber;

  let topBid = state.topBid;
  let nextBid = state.nextBid;

  let stepHasUpdatedTopBid: boolean = false;
  let stepHasUpdatedNextBid: boolean = false;

  while (true) {
    ({
      topBid,
      nextBid,
      updatedTopBid: stepHasUpdatedTopBid,
      updatedNextBid: stepHasUpdatedNextBid,
    } = _stateTransition(currentBlockIdx, topBid, nextBid, K));

    if (!stepHasUpdatedTopBid && !stepHasUpdatedNextBid) {
      break;
    }
  }

  return { topBid, nextBid };
}

function _stateTransition(
  currentBlockIdx: bigint,
  topBid: Bid,
  nextBid: Bid,
  K: bigint,
): {
  topBid: Bid;
  nextBid: Bid;
  updatedTopBid: boolean;
  updatedNextBid: boolean;
  rentCharged: bigint;
  refundManager: string;
  refundAmount: bigint;
} {
  let updatedTopBid: boolean = false;
  let updatedNextBid: boolean = false;
  let rentCharged: bigint = 0n;
  let refundManager: string = NULL_ADDRESS;
  let refundAmount: bigint = 0n;

  if (nextBid.manager === NULL_ADDRESS) {
    if (topBid.manager !== NULL_ADDRESS) {
      const blocksPassed = currentBlockIdx - topBid.blockIdx;
      const rentOwed = blocksPassed * topBid.rent;
      if (rentOwed >= topBid.deposit) {
        rentCharged = topBid.deposit;
        topBid = _resetBid();
        updatedTopBid = true;
      } else if (rentOwed !== 0n) {
        rentCharged = rentOwed;
        topBid.deposit -= rentOwed;
        topBid.blockIdx = currentBlockIdx;
        updatedTopBid = true;
      }
    }
  } else {
    if (topBid.manager === NULL_ADDRESS) {
      const nextBidStartBlockIdx = nextBid.blockIdx + K;
      if (currentBlockIdx >= nextBidStartBlockIdx) {
        topBid = nextBid;
        topBid.blockIdx = nextBidStartBlockIdx;
        nextBid = _resetBid();

        updatedTopBid = true;
        updatedNextBid = true;
      }
    } else {
      const nextBidIsBetter =
        nextBid.rent > mulWad(topBid.rent, MIN_BID_MULTIPLIER);
      const blocksPassed = nextBidIsBetter
        ? min(
            currentBlockIdx - topBid.blockIdx,
            nextBid.blockIdx + K - topBid.blockIdx,
          )
        : currentBlockIdx - topBid.blockIdx;
      const rentOwed = blocksPassed * topBid.rent;

      if (rentOwed >= topBid.deposit) {
        rentCharged = topBid.deposit;
        topBid = _resetBid();
        const latestProcessedBlockIdx = nextBidIsBetter
          ? min(currentBlockIdx, nextBid.blockIdx + K)
          : currentBlockIdx;
        nextBid.blockIdx = max(nextBid.blockIdx, latestProcessedBlockIdx - K);

        updatedTopBid = true;
        updatedNextBid = true;
      } else {
        if (rentOwed !== 0n) {
          rentCharged = rentOwed;

          topBid.deposit -= rentOwed;
          topBid.blockIdx = currentBlockIdx;

          updatedTopBid = true;
        }

        const nextBidStartBlockIdx = nextBid.blockIdx + K;
        if (currentBlockIdx >= nextBidStartBlockIdx && nextBidIsBetter) {
          refundManager = topBid.manager;
          refundAmount = topBid.deposit;

          topBid = nextBid;
          topBid.blockIdx = nextBidStartBlockIdx;
          nextBid = _resetBid();

          updatedTopBid = true;
          updatedNextBid = true;
        }
      }
    }
  }

  return {
    topBid,
    nextBid,
    updatedTopBid,
    updatedNextBid,
    rentCharged,
    refundManager,
    refundAmount,
  };
}

function _resetBid(): Bid {
  return {
    manager: NULL_ADDRESS,
    blockIdx: 0n,
    payload: ZERO_BYTES_6,
    rent: 0n,
    deposit: 0n,
  };
}
