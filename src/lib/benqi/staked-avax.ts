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
import { Interface } from '@ethersproject/abi';
import StakedAvaxABI from '../../abi/benqi/staked-avax.json';
import { getTopicLogDecoder } from '../topic-log-decoder';

export type StakedAvaxState = {
  totalPooledAvax: bigint;
  totalShares: bigint;
};

export class StakedAvaxSubscriber<State> extends PartialEventSubscriber<
  State,
  StakedAvaxState
> {
  static readonly stakedAvaxInterface = new Interface(StakedAvaxABI);

  constructor(
    private address: Address,
    lens: Lens<DeepReadonly<State>, DeepReadonly<StakedAvaxState>>,
    logger: Logger,
  ) {
    super([address], lens, logger);
  }

  public processLog(
    state: DeepReadonly<StakedAvaxState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<StakedAvaxState> | null {
    try {
      const parsed = getTopicLogDecoder(
        StakedAvaxSubscriber.stakedAvaxInterface,
      ).decode(log);
      switch (parsed.name) {
        case 'Submitted':
          // The event doesn't contain the deposited amount but a recalculated
          // amount based on how many shares were minted.  Since the
          // totalPooledAvax is only slightly more than totalShares and the
          // values are large this is pretty much guaranteed to round down.
          // Adding 1 should therefore give the correct value!
          return {
            ...state,
            totalPooledAvax:
              state.totalPooledAvax +
              BigInt(parsed.args.avaxAmount.toString()) +
              1n,
            totalShares:
              state.totalShares + BigInt(parsed.args.shareAmount.toString()),
          };
        case 'Redeem':
          return {
            ...state,
            totalPooledAvax:
              state.totalPooledAvax - BigInt(parsed.args.avaxAmount.toString()),
            totalShares:
              state.totalShares - BigInt(parsed.args.shareAmount.toString()),
          };
        case 'AccrueRewards':
          return {
            ...state,
            totalPooledAvax:
              state.totalPooledAvax + BigInt(parsed.args.value.toString()),
          };
        default:
          return null;
      }
    } catch (e) {
      this.logger.error('Failed to parse log', e);
      return null;
    }
  }

  public getGenerateStateMultiCallInputs(): MultiCallInput[] {
    return [
      {
        target: this.address,
        callData:
          StakedAvaxSubscriber.stakedAvaxInterface.encodeFunctionData(
            'totalPooledAvax',
          ),
      },
      {
        target: this.address,
        callData:
          StakedAvaxSubscriber.stakedAvaxInterface.encodeFunctionData(
            'totalShares',
          ),
      },
    ];
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<StakedAvaxState> {
    return {
      totalPooledAvax: BigInt(
        StakedAvaxSubscriber.stakedAvaxInterface
          .decodeFunctionResult('totalPooledAvax', multicallOutputs[0])[0]
          .toString(),
      ),
      totalShares: BigInt(
        StakedAvaxSubscriber.stakedAvaxInterface
          .decodeFunctionResult('totalShares', multicallOutputs[1])[0]
          .toString(),
      ),
    };
  }

  public static getPooledAvaxByShares(
    shareAmount: bigint,
    state: DeepReadonly<StakedAvaxState>,
  ): bigint {
    return (shareAmount * state.totalPooledAvax) / state.totalShares;
  }
}
