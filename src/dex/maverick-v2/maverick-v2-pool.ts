import { Interface, defaultAbiCoder } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Address, BlockHeader, Log, Logger, Token } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import MaverickV2PoolABI from '../../abi/maverick-v2/MaverickV2Pool.json';
import MaverickV2PoolLensABI from '../../abi/maverick-v2/MaverickV2PoolLens.json';
import { AbiItem } from 'web3-utils';
import { Contract } from 'web3-eth-contract';
import { MaverickPoolMath } from './maverick-math/maverick-pool-math';
import _ from 'lodash';
import { MultiResult } from '../../lib/multi-wrapper';
import { BytesLike } from 'ethers';
import { extractSuccessAndValue } from '../../lib/decoders';

export const decodeMaverickFullState = (
  result: MultiResult<BytesLike> | BytesLike,
) => {
  const [isSuccess, toDecode] = extractSuccessAndValue(result);

  if (!isSuccess || toDecode === '0x') {
    throw new Error('Could not extract value from struct TODO.');
  }

  const decoded = defaultAbiCoder.decode(
    [
      `
      tuple(
        tuple(
          uint128 reserveA,
          uint128 reserveB,
          uint128 totalSupply,
          uint32[4] binIdsByTick
        )[] tickStateMapping,
        tuple(
          uint128 mergeBinBalance,
          uint128 tickBalance,
          uint128 totalSupply,
          uint8 kind,
          int32 tick,
          uint32 mergeId
        )[] binStateMapping,
        tuple(
          uint128[4] values
        )[] binIdByTickKindMapping,
        tuple(
          uint128 reserveA,
          uint128 reserveB,
          int64 lastTwaD8,
          int64 lastLogPriceD8,
          uint40 lastTimestamp,
          int32 activeTick,
          bool isLocked,
          uint32 binCounter,
          uint8 protocolFeeRatioD3
        ) state,
        tuple(uint256 amountA, uint256 amountB) protocolFees
      ) poolState
    `,
    ],
    toDecode,
  );
  return decoded[0];
};

export class MaverickV2EventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
      blockHeader: BlockHeader,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  poolContract: Contract;
  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  poolMath: MaverickPoolMath;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    public tokenA: Token,
    public tokenB: Token,
    public feeAIn: bigint,
    public feeBIn: bigint,
    public tickSpacing: bigint,
    public protocolFeeRatio: bigint,
    public lookback: bigint,
    public activeTick: bigint,
    public address: Address,
    public poolLensAddress: Address,
    protected maverickV2Iface = new Interface(MaverickV2PoolABI),
    protected maverickV2LensIface = new Interface(MaverickV2PoolLensABI),
  ) {
    const name = `${parentName.toLowerCase()}-${tokenA.symbol}-${
      tokenB.symbol
    }-${address.toLowerCase()}-${feeAIn}-${feeBIn}-${tickSpacing}-${lookback}`;

    super(parentName, name, dexHelper, logger);

    // TODO: make logDecoder decode logs that
    this.logDecoder = (log: Log) => this.maverickV2Iface.parseLog(log);
    this.addressesSubscribed = [address];

    // Add handlers
    this.handlers['PoolAddLiquidity'] = this.handleAddLiquidityEvent.bind(this);
    this.handlers['PoolRemoveLiquidity'] =
      this.handleRemoveLiquidityEvent.bind(this);
    this.handlers['PoolSwap'] = this.handleSwapEvent.bind(this);

    this.poolMath = new MaverickPoolMath(
      BigInt(feeAIn),
      BigInt(feeBIn),
      BigInt(lookback),
      BigInt(tickSpacing),
      BigInt(protocolFeeRatio),
      BigInt(activeTick),
      BigInt(tokenA.decimals),
      BigInt(tokenB.decimals),
    );

    this.poolContract = new this.dexHelper.web3Provider.eth.Contract(
      MaverickV2PoolABI as AbiItem[],
      this.address,
    );
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
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log, blockHeader);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
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

  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    try {
      const poolContractState = await this.poolContract.methods
        .getState()
        .call({}, blockNumber);

      const poolState: PoolState = {
        activeTick: BigInt(poolContractState.activeTick),
        binCounter: BigInt(poolContractState.binCounter),
        reserveA: BigInt(poolContractState.reserveA),
        reserveB: BigInt(poolContractState.reserveB),
        lastTwaD8: BigInt(poolContractState.lastTwaD8),
        lastLogPriceD8: BigInt(poolContractState.lastLogPriceD8),
        lastTimestamp: BigInt(poolContractState.lastTimestamp),
        bins: {},
        ticks: {},
      };

      const calls = [];

      for (let i = 0n; i < poolState.binCounter / 5000n + 1n; i++) {
        calls.push({
          target: this.poolLensAddress,
          callData: this.maverickV2LensIface.encodeFunctionData(
            'getFullPoolState',
            [this.address, i * 5000n, (i + 1n) * 5000n],
          ),
          decodeFunction: (data: any) => data.toString(),
        });
      }

      const poolLensStates = await this.dexHelper.multiWrapper
        .aggregate<string>(calls, blockNumber)
        .then(data => {
          return data.map(item => decodeMaverickFullState(item));
        });

      poolLensStates.forEach(poolLensState => {
        poolLensState.binStateMapping.forEach((bin: any, i: number) => {
          if (i === 0) return;

          const tick = poolLensState.tickStateMapping[i];

          poolState.bins[i.toString()] = {
            mergeBinBalance: BigInt(bin.mergeBinBalance),
            mergeId: BigInt(bin.mergeId),
            totalSupply: BigInt(bin.totalSupply),
            kind: BigInt(bin.kind),
            tick: BigInt(bin.tick),
            tickBalance: BigInt(bin.tickBalance),
          };

          poolState.ticks[bin.tick.toString()] = {
            reserveA: BigInt(tick.reserveA),
            reserveB: BigInt(tick.reserveB),
            totalSupply: BigInt(tick.totalSupply),
            binIdsByTick: {},
          };

          tick.binIdsByTick.forEach((id: any, i: number) => {
            if (id != 0n) {
              poolState.ticks[bin.tick.toString()].binIdsByTick[i.toString()] =
                BigInt(id);
            }
          });
        });
      });

      return poolState;
    } catch {
      return {
        activeTick: BigInt(0),
        binCounter: BigInt(0),
        reserveA: BigInt(0),
        reserveB: BigInt(0),
        lastTwaD8: BigInt(0),
        lastLogPriceD8: BigInt(0),
        lastTimestamp: BigInt(0),
        bins: {},
        ticks: {},
      };
    }
  }

  handleRemoveLiquidityEvent(
    event: any,
    state: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const blockTimestamp = BigInt(blockHeader.timestamp);
    this.poolMath.removeLiquidity(state, blockTimestamp, {
      binIds: event.args.params.binIds.map((id: any) => BigInt(id)),
      amounts: event.args.params.amounts.map((amount: any) => BigInt(amount)),
    });
    return state;
  }

  handleAddLiquidityEvent(
    event: any,
    state: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const blockTimestamp = BigInt(blockHeader.timestamp);
    this.poolMath.addLiquidity(state, blockTimestamp, {
      ticks: event.args.params.ticks.map((amount: any) => BigInt(amount)),
      amounts: event.args.params.amounts.map((amount: any) => BigInt(amount)),
      kind: BigInt(event.args.params.kind),
    });
    return state;
  }

  handleSwapEvent(
    event: any,
    state: PoolState,
    log: Log,
    blockHeader: BlockHeader,
  ) {
    const blockTimestamp = BigInt(blockHeader.timestamp);
    this.poolMath.swap(
      state,
      blockTimestamp,
      BigInt(event.args.params.amount),
      event.args.params.tokenAIn,
      event.args.params.exactOutput,
      BigInt(event.args.params.tickLimit),
    );
    return state;
  }

  swap(
    amount: bigint,
    from: Token,
    to: Token,
    exactOutput: boolean,
  ): [bigint, bigint] {
    try {
      const tempState = _.cloneDeep(this.state!);

      const preActiveTick = tempState.activeTick;

      const output = this.poolMath.estimateSwap(
        tempState,
        amount,
        from.address.toLowerCase() === this.tokenA.address.toLowerCase(),
        exactOutput,
        from.address.toLowerCase() === this.tokenA.address.toLowerCase()
          ? tempState.activeTick + 100n
          : tempState.activeTick - 100n,
      );

      if (output[0] === 0n && output[1] === 0n) {
        this.logger.trace(
          `Reached max swap iteration calculation for address=${this.address} amount=${amount}, from=${from.address}, to=${to.address}, exactOutput=${exactOutput}`,
        );
        return [0n, 0n];
      }

      const postActiveTick = tempState.activeTick;
      const tickDiff = Math.abs(Number(postActiveTick) - Number(preActiveTick));

      return [
        exactOutput ? output[0] : output[1],
        // Tick calculation must be started from 1 to account at least one tick
        BigInt(tickDiff + 1),
      ];
    } catch (e) {
      this.logger.debug(
        `Failed to calculate swap for address=${this.address} amount=${amount}, from=${from.address}, to=${to.address}, exactOutput=${exactOutput} math: ${e}`,
      );
      return [0n, 0n];
    }
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<PoolState> | null> {
    const state = this.getState(blockNumber);
    if (state) {
      return state;
    }

    this.logger.error(
      `No state found for ${this.name} ${this.addressesSubscribed[0]}, generating new one`,
    );
    const newState = await this.generateState(blockNumber);

    if (!newState) {
      this.logger.error(
        `Could not generate state for ${this.name} ${this.addressesSubscribed[0]}`,
      );
      return null;
    }
    this.setState(newState, blockNumber);
    return newState;
  }
}
