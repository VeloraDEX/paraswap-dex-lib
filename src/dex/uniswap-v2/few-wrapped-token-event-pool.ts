import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger, Token } from '../../types';
import { IDexHelper } from '../../dex-helper';
import { Interface } from '@ethersproject/abi';
import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import erc20ABI from '../../abi/ERC20.abi.json';
import { ethers } from 'ethers';

const erc20iface = new Interface(erc20ABI);

export type FewWrappedToken = Token & {
  underlying: Address;
};

interface FewWrappedTokenState {
  balance: bigint;
}

export class FewWrappedTokenEventPool extends StatefulEventSubscriber<FewWrappedTokenState> {
  constructor(
    parentName: string,
    protected dexHelper: IDexHelper,
    private fwToken: FewWrappedToken,
    logger: Logger,
  ) {
    super(parentName, `${fwToken.address}`, dexHelper, logger);

    this.addressesSubscribed = [this.fwToken.underlying];
  }

  protected processLog(
    state: DeepReadonly<FewWrappedTokenState>,
    log: Readonly<Log>,
  ): AsyncOrSync<DeepReadonly<FewWrappedTokenState> | null> {
    const event = erc20iface.parseLog(log);

    if (event.name === 'Transfer') {
      if (event.args.to.toLowerCase() === this.fwToken.address.toLowerCase()) {
        return {
          balance: state.balance + BigInt(event.args.value),
        };
      }

      if (
        event.args.from.toLowerCase() === this.fwToken.address.toLowerCase()
      ) {
        return {
          balance: state.balance - BigInt(event.args.value),
        };
      }
    }
    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<FewWrappedTokenState>> {
    let calldata = [
      {
        target: this.fwToken.underlying,
        callData: erc20iface.encodeFunctionData('balanceOf', [
          this.fwToken.address,
        ]),
      },
    ];

    const data: { returnData: any[] } =
      await this.dexHelper.multiContract.methods
        .aggregate(calldata)
        .call({}, blockNumber);

    const balance = ethers.utils.defaultAbiCoder
      .decode(['uint'], data.returnData[0])[0]
      .toString();

    return {
      balance: BigInt(balance),
    };
  }

  async getOrGenerateState(blockNumber: number): Promise<FewWrappedTokenState> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }
}
