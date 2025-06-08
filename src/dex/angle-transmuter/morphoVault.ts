import type { DeepReadonly } from 'ts-essentials';
import type {
  BlockHeader,
  Log,
  Logger,
  MultiCallInput,
  MultiCallOutput,
} from '../../types';
import { bigIntify } from '../../utils';
import type { MorphoVaultState } from './types';
import MorphoVaultABI from '../../abi/angle-transmuter/MorphoVault.json';
import { PartialEventSubscriber } from '../../composed-event-subscriber';
import { Lens } from '../../lens';
import _ from 'lodash';
import { ethers, Interface } from 'ethers';

export class MorphoVaultSubscriber<State> extends PartialEventSubscriber<
  State,
  MorphoVaultState
> {
  static interface = new Interface(MorphoVaultABI);

  constructor(
    public morphoVault: string,
    lens: Lens<DeepReadonly<State>, DeepReadonly<MorphoVaultState>>,
    logger: Logger,
  ) {
    super([morphoVault], lens, logger);
  }

  public processLog(
    state: DeepReadonly<MorphoVaultState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<MorphoVaultState> | null {
    try {
      const parsed = MorphoVaultSubscriber.interface.parseLog(log);

      if (!parsed) return null;

      const _state: MorphoVaultState = _.cloneDeep(state) as MorphoVaultState;
      switch (parsed.name) {
        case 'UpdateLastTotalAssets':
          return this.handleUpdateLastTotalAssets(parsed, _state);
        case 'AccrueInterest':
          return this.handleAccrueFee(parsed, _state);
        case 'Deposit':
          return this.handleDeposit(parsed, _state);
        case 'Withdraw':
          return this.handleWithdraw(parsed, _state);
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
        target: this.morphoVault,
        callData:
          MorphoVaultSubscriber.interface.encodeFunctionData('totalAssets'),
      },
      {
        target: this.morphoVault,
        callData:
          MorphoVaultSubscriber.interface.encodeFunctionData('totalSupply'),
      },
    ];
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<MorphoVaultState> {
    const morphoVaultState = {} as MorphoVaultState;

    // Decode
    morphoVaultState.totalAssets = bigIntify(
      MorphoVaultSubscriber.interface.decodeFunctionResult(
        'totalAssets',
        multicallOutputs[0],
      )[0],
    );
    morphoVaultState.totalSupply = bigIntify(
      MorphoVaultSubscriber.interface.decodeFunctionResult(
        'totalSupply',
        multicallOutputs[1],
      )[0],
    );
    return morphoVaultState;
  }

  getRate(amount: bigint, state: MorphoVaultState): bigint {
    return amount === 0n || state.totalSupply === 0n
      ? amount
      : (amount * state.totalSupply) / state.totalAssets;
  }

  handleUpdateLastTotalAssets(
    event: ethers.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    state.totalAssets = bigIntify(event.args.updatedTotalAssets);
    return state;
  }

  handleAccrueFee(
    event: ethers.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    state.totalSupply += bigIntify(event.args.feeShares);
    return state;
  }

  handleDeposit(
    event: ethers.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    const shares = bigIntify(event.args.shares);
    state.totalSupply += shares;
    return state;
  }

  handleWithdraw(
    event: ethers.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    const shares = bigIntify(event.args.shares);
    state.totalSupply -= shares;
    return state;
  }
}
