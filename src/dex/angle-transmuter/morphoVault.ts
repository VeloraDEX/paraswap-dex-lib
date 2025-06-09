import { Interface } from '@ethersproject/abi';
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
import { ethers } from 'ethers';

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
      switch (parsed.name) {
        case 'UpdateLastTotalAssets':
          return this.handleUpdateLastTotalAssets(parsed, state);
        case 'AccrueInterest':
          return this.handleAccrueFee(parsed, state);
        case 'Deposit':
          return this.handleDeposit(parsed, state);
        case 'Withdraw':
          return this.handleWithdraw(parsed, state);
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
    event: ethers.utils.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    const totalAssets = bigIntify(event.args.updatedTotalAssets);
    return {
      ...state,
      totalAssets,
    };
  }

  handleAccrueFee(
    event: ethers.utils.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    return {
      ...state,
      totalSupply: state.totalSupply + bigIntify(event.args.feeShares),
    };
  }

  handleDeposit(
    event: ethers.utils.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    return {
      ...state,
      totalSupply: state.totalSupply + bigIntify(event.args.shares),
    };
  }

  handleWithdraw(
    event: ethers.utils.LogDescription,
    state: MorphoVaultState,
  ): DeepReadonly<MorphoVaultState> | null {
    return {
      ...state,
      totalSupply: state.totalSupply - bigIntify(event.args.shares),
    };
  }
}
