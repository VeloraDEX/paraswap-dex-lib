import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { DeepReadonly } from 'ts-essentials';
import { Address, Log, Logger } from '../../types';
import { IDexHelper } from '../../dex-helper';
import { Interface } from '@ethersproject/abi';
import FluidDexPoolABI from '../../abi/fluid-dex/fluid-dex.abi.json';
import { catchParseLogError } from '../../utils';
import { ethers } from 'ethers';
import { uint256ToBigInt } from '../../lib/decoders';
import { DecodedStateMultiCallResultWithRelativeBitmaps } from '../uniswap-v3/types';

const {
  utils: { hexlify, hexZeroPad },
} = ethers;

type PoolState = {
  isSwapAndArbitragePaused: boolean;
};

export class FluidDexEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;
  addressesSubscribed: Address[];
  protected poolIface = new Interface(FluidDexPoolABI);

  constructor(
    readonly parentName: string,
    readonly poolAddress: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, 'pool', dexHelper, logger);

    this.logDecoder = (log: Log) => this.poolIface.parseLog(log);
    this.addressesSubscribed = [poolAddress];

    // Add handlers
    this.handlers['LogPauseSwapAndArbitrage'] =
      this.handleLogPauseSwapAndArbitrage.bind(this);
    this.handlers['LogUnpauseSwapAndArbitrage'] =
      this.handleLogUnpauseSwapAndArbitrage.bind(this);
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
  async processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<PoolState> | null> {
    try {
      let event;
      try {
        event = this.logDecoder(log);
      } catch (e) {
        return null;
      }

      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  handleLogPauseSwapAndArbitrage(): PoolState {
    return { isSwapAndArbitragePaused: true };
  }

  handleLogUnpauseSwapAndArbitrage(): PoolState {
    return { isSwapAndArbitragePaused: false };
  }

  async getStateOrGenerate(
    blockNumber: number,
    readonly: boolean = false,
  ): Promise<DeepReadonly<PoolState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
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
    const multicallData = [
      {
        target: this.addressesSubscribed[0],
        callData: this.poolIface.encodeFunctionData('readFromStorage', [
          hexZeroPad(hexlify(1), 32),
        ]),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const storageResults = await this.dexHelper.multiWrapper.tryAggregate<
      bigint | DecodedStateMultiCallResultWithRelativeBitmaps
    >(
      false,
      multicallData,
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
      false,
    );

    const isSwapAndArbitragePaused =
      BigInt(storageResults[0].returnData.toString()) >> 255n === 1n;

    return { isSwapAndArbitragePaused };
  }
}
