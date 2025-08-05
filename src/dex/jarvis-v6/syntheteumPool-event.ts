import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { PartialEventSubscriber } from '../../composed-event-subscriber';
import {
  Address,
  MultiCallInput,
  MultiCallOutput,
  Logger,
  Log,
  BlockHeader,
} from '../../types';
import { Lens } from '../../lens';
import { SynthereumPoolState } from './types';
import { bigIntify } from '../nerve/utils';

export class SynthereumPoolEvent<State> extends PartialEventSubscriber<
  State,
  SynthereumPoolState
> {
  constructor(
    private poolAddress: Address,
    private poolInterface: Interface,
    lens: Lens<DeepReadonly<State>, DeepReadonly<SynthereumPoolState>>,
    logger: Logger,
  ) {
    super([poolAddress], lens, logger);
  }

  getFeesPercentage(state: DeepReadonly<State>) {
    return this.lens.get()(state).feesPercentage;
  }

  public processLog(
    state: DeepReadonly<SynthereumPoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<SynthereumPoolState> | null {
    try {
      const parsed = this.poolInterface.parseLog(log);

      switch (parsed.name) {
        case 'SetFeePercentage': {
          return {
            feesPercentage: parsed.args.newFee.toBigInt(),
          };
        }
        default:
          return null;
      }
    } catch (e) {
      this.logger.error('Failed to parse log', e);
      return null;
    }
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    return [];
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<SynthereumPoolState> {
    return {
      feesPercentage: 0n,
    };
  }
}
