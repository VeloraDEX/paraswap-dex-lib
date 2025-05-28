import { Interface, AbiCoder } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { KelpPoolState, lrtOracleFunctions } from './types';
import { Contract } from 'web3-eth-contract';
import { Address } from '@paraswap/sdk';
import { BI_POWS } from '../../bigint-constants';

export class KelpEventPool extends StatefulEventSubscriber<KelpPoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<KelpPoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<KelpPoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    private lrtOracleAddress: Address,
    private lrtOracleInterface: Interface,
  ) {
    super(parentName, 'rsETH', dexHelper, logger);

    this.logDecoder = (log: Log) => this.lrtOracleInterface.parseLog(log);
    this.addressesSubscribed = [this.lrtOracleAddress];
  }

  protected processLog(
    state: DeepReadonly<KelpPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<KelpPoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name === 'RsETHPriceUpdate') {
        const newRsETHPrice = BigInt(event.args.newPrice);
        return {
          rsETHToETHRate: newRsETHPrice,
        };
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getOrGenerateState(
    blockNumber: number,
  ): Promise<DeepReadonly<KelpPoolState>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      this.setState(state, blockNumber);
    }
    return state;
  }

  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<KelpPoolState>> {
    const state = await this.getOnChainState(
      this.dexHelper.multiContract,
      this.lrtOracleAddress,
      this.lrtOracleInterface,
      blockNumber,
    );

    return state;
  }

  async getOnChainState(
    multiContract: Contract,
    lrtOracleAddress: Address,
    lrtOracleInterface: Interface,
    blockNumber: number | 'latest',
  ): Promise<KelpPoolState> {
    const coder = new AbiCoder();
    const data: { returnData: any[] } = await multiContract.methods
      .aggregate([
        {
          target: lrtOracleAddress,
          callData: lrtOracleInterface.encodeFunctionData(
            lrtOracleFunctions.rsETHPrice,
            [],
          ),
        },
      ])
      .call({}, blockNumber);

    const decodedData = coder.decode(['uint256'], data.returnData[0]);

    const rsETHToETHRate = BigInt(decodedData[0].toString());

    return {
      rsETHToETHRate,
    };
  }

  getPrice(blockNumber: number, ethAmount: bigint): bigint {
    const state = this.getState(blockNumber);
    if (!state) throw new Error('Cannot compute price');
    const { rsETHToETHRate } = state;

    return (ethAmount * BI_POWS[18]) / rsETHToETHRate;
  }
}
