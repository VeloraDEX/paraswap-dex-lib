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
import { USDQState } from './types';
import ERC20ABI from '../../abi/erc20.json';
import { Lens } from '../../lens';
import { NULL_ADDRESS } from '../../constants';

export class USDQ<State> extends PartialEventSubscriber<State, USDQState> {
  static readonly interface = new Interface(ERC20ABI);

  constructor(
    private usdqAddress: Address,
    lens: Lens<DeepReadonly<State>, DeepReadonly<USDQState>>,
    logger: Logger,
  ) {
    super([usdqAddress], lens, logger);
  }

  getTotalSupply(state: DeepReadonly<State>) {
    return this.lens.get()(state).totalSupply;
  }

  public processLog(
    state: DeepReadonly<USDQState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<USDQState> | null {
    try {
      const parsed = USDQ.interface.parseLog(log);

      switch (parsed.name) {
        case 'Transfer': {
          const fromAddress = parsed.args.src;
          const toAddress = parsed.args.dst;
          const amount = parsed.args.wad.toBigInt();

          if (fromAddress === NULL_ADDRESS) {
            return { totalSupply: state.totalSupply + amount };
          } else if (toAddress === NULL_ADDRESS) {
            return { totalSupply: state.totalSupply - amount };
          }

          return null;
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
    return [
      {
        target: this.usdqAddress,
        callData: USDQ.interface.encodeFunctionData('totalSupply'),
      },
    ];
  }

  public generateState(
    multicallOutputs: MultiCallOutput[],
    blockNumber?: number | 'latest',
  ): DeepReadonly<USDQState> {
    return {
      totalSupply: BigInt(
        USDQ.interface.decodeFunctionResult(
          'totalSupply',
          multicallOutputs[0],
        )[0],
      ),
    };
  }
}
