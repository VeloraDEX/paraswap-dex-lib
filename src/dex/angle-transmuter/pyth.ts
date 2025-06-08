import { DeepReadonly } from 'ts-essentials';
import { PartialEventSubscriber } from '../../composed-event-subscriber';
import {
  Address,
  BlockHeader,
  Log,
  Logger,
  MultiCallInput,
  MultiCallOutput,
} from '../../types';
import { Lens } from '../../lens';
import PythABI from '../../abi/angle-transmuter/Pyth.json';
import _ from 'lodash';
import { formatUnits, parseUnits, Interface } from 'ethers';
import { PythState } from './types';

export class PythSubscriber<State> extends PartialEventSubscriber<
  State,
  PythState
> {
  static readonly proxyInterface = new Interface(PythABI);
  static readonly ANSWER_UPDATED_TOPIC =
    PythSubscriber.proxyInterface.getEvent('PriceFeedUpdate')!.topicHash;

  constructor(
    private proxy: Address,
    private oracleIds: string[],
    lens: Lens<DeepReadonly<State>, DeepReadonly<PythState>>,
    logger: Logger,
  ) {
    super([proxy], lens, logger);
  }

  public processLog(
    state: DeepReadonly<PythState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PythState> | null {
    if (log.topics[0] !== PythSubscriber.ANSWER_UPDATED_TOPIC) return null; // Ignore other events
    const decoded = PythSubscriber.proxyInterface.decodeEventLog(
      'PriceFeedUpdate',
      log.data,
      log.topics,
    );
    if (this.oracleIds.indexOf(decoded.id) === -1) return null;
    const _state = _.cloneDeep(state) as PythState;
    const expo = _state[decoded.id].expo;
    _state[decoded.id] = {
      answer: this._processPrice(decoded.price, expo),
      expo: expo,
      timestamp: Number(decoded.publishTime),
    };
    return _state;
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    const oraclesMultiCalls = this.oracleIds.map(id => {
      return {
        target: this.proxy,
        callData: PythSubscriber.proxyInterface.encodeFunctionData(
          'getPriceUnsafe',
          [id],
        ),
      };
    });
    return oraclesMultiCalls;
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<PythState> {
    const decodedOracle = multicallOutputs.map(call => {
      return PythSubscriber.proxyInterface.decodeFunctionResult(
        'getPriceUnsafe',
        call,
      )[0];
    });
    const _state = {} as PythState;
    this.oracleIds.map((id, index) => {
      const expo = decodedOracle[index].expo;
      _state[id] = {
        answer: this._processPrice(decodedOracle[index].price, expo),
        expo: expo,
        timestamp: Number(decodedOracle[index].publishTime),
      };
    });
    return _state;
  }

  public getLatestRoundData(
    state: DeepReadonly<State>,
    oracleId: string,
  ): number {
    return this.lens.get()(state)[oracleId].answer;
  }

  public _processPrice(price: bigint, expo: number): number {
    const isNormalizerExpoNeg = expo < 0;
    if (isNormalizerExpoNeg) return Number(formatUnits(price, -expo));
    return Number(parseUnits(price.toString(), expo));
  }
}
