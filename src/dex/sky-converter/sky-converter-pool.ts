import { Contract } from 'ethers';
import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';

import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, BlockHeader, Log, Logger } from '../../types';
import { IDexHelper } from '../../dex-helper';
import { SkyConverterPoolState } from './types';

const FEE_BYTES32 =
  '0x6665650000000000000000000000000000000000000000000000000000000000';

export class SkyConverterEventPool extends StatefulEventSubscriber<SkyConverterPoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<SkyConverterPoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<SkyConverterPoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  readonly contract: Contract;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    private readonly converterAddress: Address,
    private readonly converterInterface: Interface,
  ) {
    super(parentName, 'fee', dexHelper, logger);

    this.logDecoder = (log: Log) => this.converterInterface.parseLog(log);
    this.contract = new Contract(
      this.converterAddress,
      this.converterInterface.fragments,
      this.dexHelper.provider,
    );
    this.addressesSubscribed = [this.converterAddress];

    this.handlers['File'] = this.handleFile.bind(this);
  }

  protected processLog(
    state: DeepReadonly<SkyConverterPoolState>,
    log: Readonly<Log>,
    _blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<SkyConverterPoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (error) {
      catchParseLogError(error, this.logger);
    }

    return null;
  }

  async generateState(
    blockNumber: number | 'latest' = 'latest',
  ): Promise<DeepReadonly<SkyConverterPoolState>> {
    try {
      const feeBn = await this.contract.fee({ blockTag: blockNumber });

      return { fee: feeBn.toBigInt() };
    } catch (error) {
      this.logger.warn(
        `${this.parentName}: failed to fetch fee state, falling back to 0`,
        error,
      );

      return { fee: 0n };
    }
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<SkyConverterPoolState> {
    const state = this.getState(blockNumber);
    if (state) {
      return { fee: state.fee };
    }

    const freshState = await this.generateState(blockNumber);
    this.setState(freshState, blockNumber);
    return { fee: freshState.fee };
  }

  handleFile(
    event: any,
    state: DeepReadonly<SkyConverterPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<SkyConverterPoolState> | null {
    if (event.args.what.toLowerCase() !== FEE_BYTES32) {
      return null;
    }

    return { fee: event.args.data.toBigInt() };
  }
}
