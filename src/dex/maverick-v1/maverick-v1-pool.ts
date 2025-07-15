import { AbiCoder, Interface } from '@ethersproject/abi';
import { assert, DeepReadonly } from 'ts-essentials';
import { Log, Logger, Address } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { Bin, MaverickV1Data, PoolState } from './types';
import { Token } from '../../types';

import { MaverickV1Config } from './config';
import PoolABI from '../../abi/maverick-v1/pool.json';
import PoolInspectorABI from '../../abi/maverick-v1/pool-inspector.json';

import { Contract } from 'web3-eth-contract';
import { AbiItem } from 'web3-utils';
import { MaverickBinMap } from './maverick-math/maverick-bin-map';
import { MaverickPoolMath } from './maverick-math/maverick-pool-math';
import { MMath } from './maverick-math/maverick-basic-math';

import * as _ from 'lodash';
import { BI_POWS } from '../../bigint-constants';
import { getBigIntPow } from '../../utils';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

export class MaverickV1EventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (event: any, pool: PoolState, log: Log) => PoolState;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];
  poolContract: Contract;
  poolInspectorContract: Contract;
  poolMath: MaverickPoolMath;

  constructor(
    parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    public tokenA: Token,
    public tokenB: Token,
    public fee: number,
    public tickSpacing: number,
    public protocolFeeRatio: number,
    public lookback: number,
    public address: Address,
    public inspectorAddress: Address,
    logger: Logger,
    mapKey: string = '',
    protected poolInterface = new Interface(PoolABI),
  ) {
    super(
      parentName,
      `${tokenA.address}_${tokenB.address}_${fee}_${tickSpacing}_${lookback}_${address}`,
      dexHelper,
      logger,
      false,
      mapKey,
    );

    // TODO: make logDecoder decode logs that
    this.logDecoder = (log: Log) => {
      return this.poolInterface.parseLog(log);
    };

    this.addressesSubscribed = [address];

    this.poolInspectorContract = new this.dexHelper.web3Provider.eth.Contract(
      PoolInspectorABI as AbiItem[],
      this.inspectorAddress,
    );

    this.poolContract = new this.dexHelper.web3Provider.eth.Contract(
      PoolABI as AbiItem[],
      this.address,
    );

    this.poolMath = new MaverickPoolMath(
      parentName,
      BigInt((fee * 1e18).toFixed(0)),
      BigInt(tickSpacing),
      BigInt(protocolFeeRatio),
    );

    // Add handlers
    this.handlers['AddLiquidity'] = this.handleAddLiquidityEvent.bind(this);
    this.handlers['RemoveLiquidity'] =
      this.handleRemoveLiquidityEvent.bind(this);
    this.handlers['BinMerged'] = this.handleBinMergedEvent.bind(this);
    this.handlers['BinMoved'] = this.handleBinMovedEvent.bind(this);
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      let output = _.cloneDeep(state) as PoolState;
      if (event.name in this.handlers) {
        output = _.cloneDeep(this.handlers[event.name](event, state, log));
      }
      return output;
    } catch (e) {
      return null;
    }
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(blockNumber: number): Promise<Readonly<PoolState>> {
    const rawBins = await this.poolInspectorContract.methods['getActiveBins'](
      this.address,
      0,
      0,
    ).call({}, blockNumber);
    const rawState = await this.poolContract.methods['getState']().call(
      {},
      blockNumber,
    );
    let binPositions: { [tick: string]: { [kind: string]: bigint } } = {};
    let bins: { [id: string]: Bin } = {};
    let binMap: { [id: string]: bigint } = {};

    rawBins.forEach((bin: any) => {
      bins[bin.id] = {
        reserveA: BigInt(bin.reserveA),
        reserveB: BigInt(bin.reserveB),
        kind: BigInt(bin.kind),
        lowerTick: BigInt(bin.lowerTick),
        mergeId: BigInt(bin.mergeId),
      };
      if (bin.mergeId == 0) {
        MaverickBinMap.putTypeAtTick(
          binMap,
          BigInt(bin.kind),
          BigInt(bin.lowerTick),
        );
        if (!binPositions[bin.lowerTick]) {
          binPositions[bin.lowerTick] = {};
        }
        binPositions[bin.lowerTick][bin.kind] = BigInt(bin.id);
      }
    });

    return {
      activeTick: BigInt(rawState.activeTick),
      binCounter: BigInt(rawState.binCounter),
      bins: bins,
      binPositions: binPositions,
      binMap: binMap,
    };
  }

  handleAddLiquidityEvent(event: any, state: PoolState, log: Log) {
    event.args.binDeltas.forEach((bin: any) => {
      if (!state.bins[bin.binId.toString()]) {
        state.binCounter += 1n;
        state.bins[bin.binId.toString()] = {
          reserveA: BigInt(bin.deltaA) > 0n ? BigInt(bin.deltaA) : 0n,
          reserveB: BigInt(bin.deltaB) > 0n ? BigInt(bin.deltaB) : 0n,
          kind: BigInt(bin.kind),
          lowerTick: BigInt(bin.lowerTick),
          mergeId: 0n,
        };
        if (!state.binPositions[bin.lowerTick.toString()]) {
          state.binPositions[bin.lowerTick.toString()] = {};
        }
        state.binPositions[bin.lowerTick.toString()][bin.kind.toString()] =
          BigInt(bin.binId);
        MaverickBinMap.putTypeAtTick(
          state.binMap,
          BigInt(bin.kind),
          BigInt(bin.lowerTick),
        );
      } else {
        state.bins[bin.binId.toString()].reserveA +=
          BigInt(bin.deltaA) > 0n ? BigInt(bin.deltaA) : 0n;
        state.bins[bin.binId.toString()].reserveB +=
          BigInt(bin.deltaB) > 0n ? BigInt(bin.deltaB) : 0n;
      }
    });
    return state;
  }

  handleRemoveLiquidityEvent(event: any, state: PoolState, log: Log) {
    event.args.binDeltas.forEach((bin: any) => {
      if (state.bins[bin.binId.toString()].mergeId == 0n) {
        state.bins[bin.binId.toString()].reserveA -=
          BigInt(bin.deltaA) > 0n ? BigInt(bin.deltaA) + 1n : 0n;
        state.bins[bin.binId.toString()].reserveB -=
          BigInt(bin.deltaB) > 0n ? BigInt(bin.deltaB) + 1n : 0n;
      } else {
        let currentMergeId = 0n;
        let mergeId = state.bins[bin.binId.toString()].mergeId;
        while (mergeId != 0n) {
          currentMergeId = mergeId;
          mergeId = state.bins[currentMergeId.toString()].mergeId;
        }

        state.bins[currentMergeId.toString()].reserveA = MMath.max(
          0n,
          state.bins[currentMergeId.toString()].reserveA -
            (BigInt(bin.deltaA) > 0
              ? BigInt(bin.deltaA) + 1n
              : BigInt(bin.deltaA)),
        );

        state.bins[currentMergeId.toString()].reserveB = MMath.max(
          0n,
          state.bins[currentMergeId.toString()].reserveB -
            (BigInt(bin.deltaB) > 0
              ? BigInt(bin.deltaB) + 1n
              : BigInt(bin.deltaB)),
        );
      }

      // remove bin
      if (!bin.isActive && state.bins[bin.binId.toString()].mergeId == 0n) {
        delete state.bins[bin.binId.toString()];
        delete state.binPositions[bin.lowerTick.toString()][
          bin.kind.toString()
        ];
        if (
          Object.keys(state.binPositions[bin.lowerTick.toString()]).length == 0
        ) {
          delete state.binPositions[bin.lowerTick.toString()];
        }
        MaverickBinMap.removeTypeAtTick(
          state.binMap,
          BigInt(bin.kind),
          BigInt(bin.lowerTick),
        );
      }
    });

    return state;
  }

  handleBinMergedEvent(event: any, state: PoolState, log: Log) {
    const bin = state.bins[event.args.binId.toString()];
    const mergeBin = state.bins[event.args.mergeId.toString()];
    bin.mergeId = BigInt(event.args.mergeId);
    MaverickBinMap.removeTypeAtTick(
      state.binMap,
      BigInt(bin.kind),
      BigInt(bin.lowerTick),
    );
    delete state.binPositions[bin.lowerTick.toString()][bin.kind.toString()];
    if (Object.keys(state.binPositions[bin.lowerTick.toString()]).length == 0) {
      delete state.binPositions[bin.lowerTick.toString()];
    }
    mergeBin.reserveA += MMath.max(BigInt(event.args.reserveA), 0n);
    mergeBin.reserveB += MMath.max(BigInt(event.args.reserveB), 0n);
    return state;
  }

  handleBinMovedEvent(event: any, state: PoolState, log: Log) {
    const bin = state.bins[event.args.binId.toString()];
    const previousTick = event.args.previousTick;
    MaverickBinMap.removeTypeAtTick(
      state.binMap,
      BigInt(bin.kind),
      BigInt(bin.lowerTick),
    );
    delete state.binPositions[previousTick.toString()][bin.kind.toString()];
    if (Object.keys(state.binPositions[previousTick.toString()]).length == 0) {
      delete state.binPositions[previousTick.toString()];
    }
    bin.lowerTick = BigInt(event.args.newTick);
    if (!state.binPositions[bin.lowerTick.toString()]) {
      state.binPositions[bin.lowerTick.toString()] = {};
    }
    state.binPositions[bin.lowerTick.toString()][bin.kind.toString()] = BigInt(
      event.args.binId,
    );
    MaverickBinMap.putTypeAtTick(
      state.binMap,
      BigInt(bin.kind),
      BigInt(bin.lowerTick),
    );
    return state;
  }

  handleSwapEvent(event: any, state: PoolState, log: Log) {
    const scaledAmount = this.scaleFromAmount(
      event.args.exactOutput
        ? event.args.amountOut.toBigInt()
        : event.args.amountIn.toBigInt(),
      (!event.args.exactOutput && event.args.tokenAIn) ||
        (event.args.exactOutput && !event.args.tokenAIn)
        ? this.tokenA
        : this.tokenB,
    );

    this.poolMath.swap(
      state,
      scaledAmount,
      event.args.tokenAIn,
      event.args.exactOutput,
    );
    return state;
  }

  swap(
    amount: bigint,
    from: Token,
    to: Token,
    side: boolean,
  ): [bigint, number] {
    try {
      const scaledAmount = side
        ? this.scaleFromAmount(amount, to)
        : this.scaleFromAmount(amount, from);
      const tempState = _.cloneDeep(this.state!);
      const preActiveTick = tempState.activeTick;
      const output = this.poolMath.swap(
        tempState,
        scaledAmount,
        from.address.toLowerCase() == this.tokenA.address.toLowerCase(),
        side,
        true,
      );

      if (output[0] == 0n && output[1] == 0n) {
        this.logger.trace(
          `Reached max swap iteration calculation for address=${this.address} amount=${amount}, from=${from.address}, to=${to.address}, side=${side}`,
        );
        return [0n, 0];
      }

      const postActiveTick = tempState.activeTick;
      const tickDiff = Math.abs(Number(postActiveTick) - Number(preActiveTick));
      return [
        side
          ? this.scaleToAmount(output[0], from)
          : this.scaleToAmount(output[1], to),
        // Tick calculation must be started from 1 to account at least one tick
        tickDiff + 1,
      ];
    } catch (e) {
      this.logger.debug(
        `Failed to calculate swap for address=${this.address} amount=${amount}, from=${from.address}, to=${to.address}, side=${side} math: ${e}`,
      );
      return [0n, 0];
    }
  }

  scaleFromAmount(amount: bigint, token: Token) {
    if (token.decimals == 18) return amount;
    if (token.decimals > 18) {
      const scalingFactor: bigint =
        BI_POWS[18] * getBigIntPow(token.decimals - 18);
      return MMath.sDivDownFixed(amount, scalingFactor);
    } else {
      const scalingFactor: bigint =
        BI_POWS[18] * getBigIntPow(18 - token.decimals);
      return MMath.sMulUpFixed(amount, scalingFactor);
    }
  }

  scaleToAmount(amount: bigint, token: Token) {
    if (token.decimals == 18) return amount;
    if (token.decimals > 18) {
      const scalingFactor: bigint =
        BI_POWS[18] * getBigIntPow(token.decimals - 18);
      return MMath.sMulUpFixed(amount, scalingFactor);
    } else {
      const scalingFactor: bigint =
        BI_POWS[18] * getBigIntPow(18 - token.decimals);
      return MMath.sDivDownFixed(amount, scalingFactor);
    }
  }
}
