import {
  PoolState,
  MoveData,
  Tick,
  Bin,
  TickData,
  RemoveLiquidityParams,
  AddLiquidityParams,
  AddLiquidityInfo,
} from '../types';
import { BI_POWS } from '../../../bigint-constants';
import { _require } from '../../../utils';
import { MaverickBasicMath } from './maverick-basic-math';
import { MaverickMath } from './maverick-math';
import { Delta, MaverickDeltaMath } from './maverick-delta-math';
import { TwaMath } from './maverick-twa-math';
import { MaverickSwapMath } from './maverick-swap-math';
import { MaverickBinMath } from './maverick-bin-math';
import { MaverickPoolLib } from './maverick-pool-lib';
import { MaverickTickMath } from './maverick-tick-math';

export class MaverickPoolMath {
  state: PoolState;
  tokenAScale: bigint;
  tokenBScale: bigint;
  timestamp: bigint;

  constructor(
    private feeAIn: bigint,
    private feeBIn: bigint,
    private lookback: bigint,
    private tickSpacing: bigint,
    private protocolFeeRatioD3: bigint,
    private activeTick: bigint,
    private tokenADecimals: bigint,
    private tokenBDecimals: bigint,
  ) {
    this.state = {
      activeTick: this.activeTick,
      reserveA: 0n,
      reserveB: 0n,
      lastTwaD8: 0n,
      lastLogPriceD8: 0n,
      lastTimestamp: 0n,
      binCounter: 0n,
      bins: {},
      ticks: {},
    };
    this.tokenAScale = MaverickMath.scale(this.tokenADecimals);
    this.tokenBScale = MaverickMath.scale(this.tokenBDecimals);
    this.timestamp = 0n;
  }

  advanceTime(delta: bigint) {
    this.timestamp += delta;
  }

  combine(self: Delta, delta: Delta) {
    if (!self.skipCombine) {
      self.deltaInBinInternal += delta.deltaInBinInternal;
      self.deltaInErc += delta.deltaInErc;
      self.deltaOutErc += delta.deltaOutErc;
    }
    self.excess = delta.excess;
    self.swappedToMaxPrice = delta.swappedToMaxPrice;
    self.fractionalPart = delta.fractionalPart;
  }

  estimateSwap(
    state: PoolState,
    amount: bigint,
    tokenAIn: boolean,
    exactOutput: boolean,
    tickLimit: bigint,
  ): [bigint, bigint] {
    this.setState(state);
    let delta: Delta = {
      deltaInBinInternal: 0n,
      deltaInErc: 0n,
      deltaOutErc: 0n,
      excess: amount,
      tokenAIn: tokenAIn,
      exactOutput: exactOutput,
      swappedToMaxPrice: false,
      skipCombine: false,
      tickLimit: tickLimit,
      sqrtLowerTickPrice: 0n,
      sqrtUpperTickPrice: 0n,
      sqrtPrice: 0n,
      fractionalPart: 0n,
    };

    let startingTick = this.state.activeTick;
    if (
      (startingTick > tickLimit && tokenAIn) ||
      (startingTick < tickLimit && !tokenAIn)
    ) {
      throw 'Beyond Swap Limit';
    }

    const usedReserve = tokenAIn ? state.reserveB : state.reserveA;
    if (exactOutput && amount > usedReserve) {
      throw 'Not enough liquidity for exactOutput swap';
    }

    let inScale = tokenAIn ? this.tokenAScale : this.tokenBScale;
    let outScale = tokenAIn ? this.tokenBScale : this.tokenAScale;

    delta.excess = !exactOutput
      ? MaverickMath.tokenScaleToAmmScale(amount, inScale)
      : MaverickMath.tokenScaleToAmmScale(amount, outScale);

    delta.tokenAIn = tokenAIn;
    delta.exactOutput = exactOutput;
    delta.tickLimit = tickLimit;

    while (delta.excess != 0n) {
      let newDelta = this.swapTick(delta);
      this.combine(delta, newDelta);
    }

    let amountIn = MaverickMath.ammScaleToTokenScale(
      delta.deltaInErc,
      inScale,
      exactOutput || delta.swappedToMaxPrice,
    );

    let amountOut = MaverickMath.ammScaleToTokenScale(
      delta.deltaOutErc,
      outScale,
      false,
    );

    return [amountIn, amountOut];
  }

  swap(
    state: PoolState,
    timestamp: bigint,
    amount: bigint,
    tokenAIn: boolean,
    exactOutput: boolean,
    tickLimit: bigint,
  ): [bigint, bigint] {
    this.timestamp = timestamp;
    this.setState(state);
    let delta: Delta = {
      deltaInBinInternal: 0n,
      deltaInErc: 0n,
      deltaOutErc: 0n,
      excess: amount,
      tokenAIn: tokenAIn,
      exactOutput: exactOutput,
      swappedToMaxPrice: false,
      skipCombine: false,
      tickLimit: tickLimit,
      sqrtLowerTickPrice: 0n,
      sqrtUpperTickPrice: 0n,
      sqrtPrice: 0n,
      fractionalPart: 0n,
    };

    let startingTick = this.state.activeTick;
    if (
      (startingTick > tickLimit && tokenAIn) ||
      (startingTick < tickLimit && !tokenAIn)
    ) {
      throw 'Beyond Swap Limit';
    }

    let inScale = tokenAIn ? this.tokenAScale : this.tokenBScale;
    let outScale = tokenAIn ? this.tokenBScale : this.tokenAScale;

    delta.excess = !exactOutput
      ? MaverickMath.tokenScaleToAmmScale(amount, inScale)
      : MaverickMath.tokenScaleToAmmScale(amount, outScale);

    delta.tokenAIn = tokenAIn;
    delta.exactOutput = exactOutput;
    delta.tickLimit = tickLimit;

    while (delta.excess != 0n) {
      let newDelta = this.swapTick(delta);
      this.combine(delta, newDelta);
    }

    let amountIn = MaverickMath.ammScaleToTokenScale(
      delta.deltaInErc,
      inScale,
      exactOutput || delta.swappedToMaxPrice,
    );

    let amountOut = MaverickMath.ammScaleToTokenScale(
      delta.deltaOutErc,
      outScale,
      false,
    );

    let lastTwaD8 = this.state.lastTwaD8;

    TwaMath.updateValue(
      this.state,
      this.state.activeTick * BI_POWS[8] + delta.fractionalPart,
      this.lookback,
      this.timestamp,
    );

    this.moveBins(
      startingTick,
      this.state.activeTick,
      lastTwaD8,
      this.state.lastTwaD8,
      5n * BI_POWS[7],
    );

    let newInternalBalance = tokenAIn
      ? this.state.reserveA + amountIn
      : this.state.reserveB + amountIn;

    [this.state.reserveA, this.state.reserveB] = tokenAIn
      ? [newInternalBalance, this.state.reserveB - amountOut]
      : [this.state.reserveA - amountOut, newInternalBalance];

    return [amountIn, amountOut];
  }

  moveBins(
    startingActiveTick: bigint,
    activeTick: bigint,
    lastTwapD8: bigint,
    newTwapD8: bigint,
    boundary: bigint,
  ) {
    let newTwap = MaverickBasicMath.floorD8Unchecked(newTwapD8 - boundary);
    let lastTwap = MaverickBasicMath.floorD8Unchecked(lastTwapD8 - boundary);

    if (activeTick > startingActiveTick || newTwap > lastTwap) {
      let moveData: MoveData = {
        kind: 0n,
        tickSearchStart: 0n,
        tickSearchEnd: 0n,
        tickLimit: 0n,
        firstBinTick: 0n,
        firstBinId: 0n,
        mergeBinBalance: 0n,
        totalReserveA: 0n,
        totalReserveB: 0n,
        mergeBins: {},
        counter: 0n,
      };

      moveData.tickLimit = MaverickBasicMath.min(activeTick - 1n, newTwap);

      if (lastTwap - 1n < moveData.tickLimit) {
        moveData.tickSearchStart = lastTwap - 1n;
        moveData.tickSearchEnd = moveData.tickLimit;
        moveData.kind = 1n;
        this.moveDirection(moveData);
        moveData.kind = 3n;
        this.moveDirection(moveData);

        // will never move both directions in one swap
        return;
      }
    }

    newTwap = MaverickBasicMath.floorD8Unchecked(newTwapD8 + boundary);
    lastTwap = MaverickBasicMath.floorD8Unchecked(lastTwapD8 + boundary);

    if (activeTick < startingActiveTick || newTwap < lastTwap) {
      let moveData: MoveData = {
        kind: 0n,
        tickSearchStart: 0n,
        tickSearchEnd: 0n,
        tickLimit: 0n,
        firstBinTick: 0n,
        firstBinId: 0n,
        mergeBinBalance: 0n,
        totalReserveA: 0n,
        totalReserveB: 0n,
        mergeBins: {},
        counter: 0n,
      };

      moveData.tickLimit = MaverickBasicMath.max(newTwap, activeTick + 1n);

      if (moveData.tickLimit < lastTwap + 1n) {
        moveData.tickSearchStart = moveData.tickLimit;
        moveData.tickSearchEnd = lastTwap + 1n;
        moveData.kind = 2n;
        this.moveDirection(moveData);
        moveData.kind = 3n;
        this.moveDirection(moveData);
      }
    }
  }

  moveDirection(moveData: MoveData) {
    moveData.firstBinTick = 0n;
    moveData.firstBinId = 0n;
    moveData.mergeBinBalance = 0n;
    moveData.totalReserveA = 0n;
    moveData.totalReserveB = 0n;
    moveData.counter = 0n;

    this.getMovementBinsInRange(moveData);

    if (
      moveData.firstBinId === 0n ||
      (moveData.counter === 1n && moveData.tickLimit === moveData.firstBinTick)
    ) {
      return;
    }

    let firstBin = this.state.bins[moveData.firstBinId.toString()];
    let firstBinTickState = this.state.ticks[moveData.firstBinTick.toString()];
    this.mergeBinsInList(firstBin, firstBinTickState, moveData);
    if (moveData.tickLimit != moveData.firstBinTick) {
      this.moveBinToNewTick(
        firstBin,
        firstBinTickState,
        this.state.ticks[moveData.tickLimit.toString()],
        moveData,
      );
    }
  }

  getMovementBinsInRange(moveData: MoveData) {
    for (
      let tick = moveData.tickSearchStart;
      tick <= moveData.tickSearchEnd;
      tick++
    ) {
      if (moveData.counter === 3n) return;
      let binId = this.binIdByTickKind(tick, moveData.kind);
      if (binId === 0n) continue;
      moveData.mergeBins[moveData.counter.toString()] = binId;
      moveData.counter++;
      if (moveData.firstBinId === 0n || binId < moveData.firstBinId) {
        moveData.firstBinId = binId;
        moveData.firstBinTick = tick;
      }
    }
  }

  binIdByTickKind(tick: bigint, kind: bigint): bigint {
    return (
      this.state.ticks[tick.toString()]?.binIdsByTick[kind.toString()] || 0n
    );
  }

  moveBinToNewTick(
    firstBin: Bin,
    startingTickState: Tick,
    endingTickState: Tick,
    moveData: MoveData,
  ) {
    let [firstBinA, firstBinB] = MaverickPoolLib.binReserves(
      firstBin,
      startingTickState,
    );

    startingTickState.reserveA = MaverickBasicMath.clip(
      startingTickState.reserveA,
      firstBinA,
    );
    startingTickState.reserveB = MaverickBasicMath.clip(
      startingTickState.reserveB,
      firstBinB,
    );
    startingTickState.totalSupply = MaverickBasicMath.clip(
      startingTickState.totalSupply,
      firstBin.tickBalance,
    );
    startingTickState.binIdsByTick[moveData.kind.toString()] = 0n;
    if (this.state.ticks[firstBin.tick.toString()].totalSupply === 0n) {
      delete this.state.ticks[firstBin.tick.toString()];
    }
    endingTickState.binIdsByTick[moveData.kind.toString()] =
      moveData.firstBinId;
    firstBin.tick = moveData.tickLimit;
    let deltaTickBalance;
    if (firstBinA > firstBinB) {
      deltaTickBalance = MaverickBasicMath.mulDivDown(
        firstBinA,
        MaverickBasicMath.max(1n, endingTickState.totalSupply),
        endingTickState.reserveA,
      );
    } else {
      deltaTickBalance = MaverickBasicMath.mulDivDown(
        firstBinB,
        MaverickBasicMath.max(1n, endingTickState.totalSupply),
        endingTickState.reserveB,
      );
    }

    endingTickState.reserveA += firstBinA;
    endingTickState.reserveB += firstBinB;
    firstBin.tickBalance = deltaTickBalance;
    endingTickState.totalSupply += deltaTickBalance;
  }

  mergeBinsInList(firstBin: Bin, firstBinTickState: Tick, moveData: MoveData) {
    let mergeOccured;

    for (let i = 0; i < moveData.counter; i++) {
      let binId = moveData.mergeBins[i];
      if (binId === moveData.firstBinId) continue;
      mergeOccured = true;

      let [binA, binB, mergeBinBalance] = this.mergeAndDecommissionBin(
        binId,
        moveData.firstBinId,
        firstBin,
        firstBinTickState,
        moveData.kind,
      );

      moveData.totalReserveA += binA;
      moveData.totalReserveB += binB;
      moveData.mergeBinBalance += mergeBinBalance;
    }

    if (mergeOccured) {
      MaverickBinMath.addLiquidityByReserves(
        firstBin,
        firstBinTickState,
        moveData.totalReserveA,
        moveData.totalReserveB,
        moveData.mergeBinBalance,
      );
    }
  }

  mergeAndDecommissionBin(
    binIdToBeMerged: bigint,
    parentBinId: bigint,
    parentBin: Bin,
    parentBinTick: Tick,
    kind: bigint,
  ): [bigint, bigint, bigint] {
    let bin = this.state.bins[binIdToBeMerged.toString()];
    let tick = this.state.ticks[bin.tick.toString()];

    let [binA, binB] = MaverickPoolLib.binReserves(bin, tick);
    bin.mergeId = parentBinId;

    let mergeBinBalance = MaverickBinMath.lpBalancesFromDeltaReserve(
      parentBin,
      parentBinTick,
      binA,
      binB,
    );
    bin.mergeBinBalance = mergeBinBalance;

    tick.totalSupply = MaverickBasicMath.clip(
      tick.totalSupply,
      bin.tickBalance,
    );
    tick.reserveA = MaverickBasicMath.clip(tick.reserveA, binA);
    tick.reserveB = MaverickBasicMath.clip(tick.reserveB, binB);
    delete tick.binIdsByTick[kind.toString()];

    return [binA, binB, mergeBinBalance];
  }

  removeLiquidity(
    state: PoolState,
    timestamp: bigint,
    params: RemoveLiquidityParams,
  ) {
    this.timestamp = timestamp;
    this.setState(state);

    for (let i = 0; i < params.binIds.length; i++) {
      let bin = this.state.bins[params.binIds[i].toString()];
      let [deltaA, deltaB] = MaverickBinMath.removeLiquidity(
        bin,
        this.state.ticks,
        this.state.bins,
        params.amounts[i],
      );

      this.state.reserveA -= MaverickMath.ammScaleToTokenScale(
        deltaA,
        this.tokenAScale,
        false,
      );
      this.state.reserveB -= MaverickMath.ammScaleToTokenScale(
        deltaB,
        this.tokenBScale,
        false,
      );
    }
  }

  getOrCreateBin(kind: bigint, tick: bigint): [bigint, Bin] {
    let binId = this.binIdByTickKind(tick, kind);

    let bin;
    if (binId === 0n) {
      this.state.binCounter++;
      binId = this.state.binCounter;
      bin = {
        tick: tick,
        kind: kind,
        mergeBinBalance: 0n,
        mergeId: 0n,
        totalSupply: 0n,
        tickBalance: 0n,
      };
      this.state.bins[binId.toString()] = bin;
      if (!this.state.ticks[tick.toString()]) {
        this.state.ticks[tick.toString()] = {
          reserveA: 0n,
          reserveB: 0n,
          totalSupply: 0n,
          binIdsByTick: {},
        };
      }
      this.state.ticks[tick.toString()].binIdsByTick[kind.toString()] = binId;
    }

    if (!bin) bin = this.state.bins[binId.toString()];

    return [binId, bin];
  }

  migrateBinUpStack(binId: bigint, maxRecursion: bigint) {
    let bin = this.state.bins[binId.toString()];
    MaverickBinMath.migrateBinsUpStack(bin, this.state.bins, maxRecursion);
  }

  setState(state: PoolState) {
    let activeTick = this.state.activeTick;
    let value = this.state.activeTick * BI_POWS[8] + 5n * BI_POWS[7];
    this.state = state;

    if (this.state.lastTimestamp === 0n) {
      this.state.activeTick = activeTick;
      this.state.lastTwaD8 = value;
      this.state.lastLogPriceD8 = value;
      this.state.lastTimestamp = this.timestamp;
    }
  }

  addLiquidity(
    state: PoolState,
    timestamp: bigint,
    params: AddLiquidityParams,
  ) {
    this.timestamp = timestamp;
    this.setState(state);
    let addLiquidityInfo: AddLiquidityInfo = {
      deltaA: 0n,
      deltaB: 0n,
      tickLtActive: false,
      tickSpacing: this.tickSpacing,
      tick: 0n,
    };

    let tokenAAmount = 0n;
    let tokenBAmount = 0n;

    for (let i = 0; i < params.ticks.length; i++) {
      addLiquidityInfo.tick = params.ticks[i];
      let [binId, bin] = this.getOrCreateBin(params.kind, params.ticks[i]);
      addLiquidityInfo.tickLtActive =
        addLiquidityInfo.tick < this.state.activeTick;

      MaverickBinMath.addLiquidity(
        bin,
        this.state.ticks[bin.tick.toString()],
        params.amounts[i],
        addLiquidityInfo,
      );

      if (addLiquidityInfo.deltaA === 0n && addLiquidityInfo.deltaB === 0n) {
        throw 'zero liquidity added';
      }

      tokenAAmount += addLiquidityInfo.deltaA;
      tokenBAmount += addLiquidityInfo.deltaB;
    }

    this.state.reserveA += MaverickMath.ammScaleToTokenScale(
      tokenAAmount,
      this.tokenAScale,
      true,
    );
    this.state.reserveB += MaverickMath.ammScaleToTokenScale(
      tokenBAmount,
      this.tokenBScale,
      true,
    );
  }

  tickSqrtPriceAndLiquidity(tick: bigint): [bigint, bigint, bigint, TickData] {
    let tickState = this.state.ticks[tick.toString()];
    let output: TickData = {
      currentReserveA: tickState.reserveA,
      currentReserveB: tickState.reserveB,
      currentLiquidity: 0n,
    };

    let [sqrtLowerTickPrice, sqrtUpperTickPrice] =
      MaverickTickMath.tickSqrtPrices(this.tickSpacing, tick);

    let sqrtPrice;
    [sqrtPrice, output.currentLiquidity] =
      MaverickTickMath.getTickSqrtPriceAndL(
        output.currentReserveA,
        output.currentReserveB,
        sqrtLowerTickPrice,
        sqrtUpperTickPrice,
      );

    return [sqrtLowerTickPrice, sqrtUpperTickPrice, sqrtPrice, output];
  }

  swapTick(delta: Delta): Delta {
    let tickData: TickData;
    let newDelta;
    let activeTick = this.state.activeTick;
    if (MaverickDeltaMath.pastMaxTick(delta, activeTick)) {
      this.state.activeTick += delta.tokenAIn ? -1n : 1n;
      return delta;
    }

    while (
      (this.state.ticks[activeTick.toString()]?.reserveA || 0n) === 0n &&
      (this.state.ticks[activeTick.toString()]?.reserveB || 0n) === 0n
    ) {
      activeTick += delta.tokenAIn ? 1n : -1n;

      if (MaverickDeltaMath.pastMaxTick(delta, activeTick)) {
        this.state.activeTick += delta.tokenAIn ? -1n : 1n;
        return delta;
      }
    }

    [
      delta.sqrtLowerTickPrice,
      delta.sqrtUpperTickPrice,
      delta.sqrtPrice,
      tickData,
    ] = this.tickSqrtPriceAndLiquidity(activeTick);

    this.state.activeTick = activeTick;

    newDelta = delta.exactOutput
      ? MaverickSwapMath.computeSwapExactOut(
          delta.sqrtPrice,
          tickData,
          delta.excess,
          delta.tokenAIn,
          this.fee(delta.tokenAIn),
          this.protocolFeeRatioD3,
        )
      : MaverickSwapMath.computeSwapExactIn(
          delta.sqrtPrice,
          tickData,
          delta.excess,
          delta.tokenAIn,
          this.fee(delta.tokenAIn),
          this.protocolFeeRatioD3,
        );

    if (newDelta.excess === 0n) {
      MaverickSwapMath.computeEndPrice(delta, newDelta, tickData);
    }

    this.allocateSwapValuesToTick(
      newDelta,
      delta.tokenAIn,
      this.state.activeTick,
    );

    if (newDelta.excess != 0n) {
      this.state.activeTick = delta.tokenAIn
        ? this.state.activeTick + 1n
        : this.state.activeTick - 1n;
    }

    return newDelta;
  }

  fee(tokenAIn: boolean): bigint {
    return tokenAIn ? this.feeAIn : this.feeBIn;
  }

  allocateSwapValuesToTick(delta: Delta, tokenAIn: boolean, tick: bigint) {
    let tickState = this.state.ticks[tick.toString()];
    let reserveA = tickState.reserveA;
    let reserveB = tickState.reserveB;

    if (tokenAIn) {
      reserveA = reserveA + delta.deltaInBinInternal;
      reserveB =
        delta.excess > 0n
          ? 0n
          : MaverickBasicMath.clip(reserveB, delta.deltaOutErc);
    } else {
      reserveA =
        delta.excess > 0n
          ? 0n
          : MaverickBasicMath.clip(reserveA, delta.deltaOutErc);
      reserveB = reserveB + delta.deltaInBinInternal;
    }

    tickState.reserveA = reserveA;
    tickState.reserveB = reserveB;
  }
}
