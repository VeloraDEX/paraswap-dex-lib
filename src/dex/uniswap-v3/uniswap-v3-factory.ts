import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import FactoryABI from '../../abi/uniswap-v3/UniswapV3Factory.abi.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers';
import { FactoryState } from './types';

export type OnPoolCreatedCallback = ({
  token0,
  token1,
  fee,
}: {
  token0: string;
  token1: string;
  fee: bigint;
}) => Promise<void>;

/*
 * "Stateless" event subscriber in order to capture "PoolCreated" event on new pools created.
 * State is present, but it's a placeholder to actually make the events reach handlers (if there's no previous state - `processBlockLogs` is not called)
 */
export class UniswapV3Factory extends StatefulEventSubscriber<FactoryState> {
  handlers: {
    [event: string]: (event: any) => Promise<void>;
  } = {};

  logDecoder: (log: Log) => any;

  public readonly factoryIface = new Interface(FactoryABI);

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    protected readonly factoryAddress: Address,
    logger: Logger,
    protected readonly onPoolCreated: OnPoolCreatedCallback,
    mapKey: string = '',
  ) {
    super(
      parentName,
      `${parentName} Factory`,
      dexHelper,
      logger,
      false,
      mapKey,
    );

    this.addressesSubscribed = [factoryAddress];

    this.logDecoder = (log: Log) => this.factoryIface.parseLog(log);

    this.handlers['PoolCreated'] = this.handleNewPool.bind(this);
  }

  generateState(): FactoryState {
    return {};
  }

  protected async processLog(
    _: DeepReadonly<FactoryState>,
    log: Readonly<Log>,
  ): Promise<FactoryState> {
    const event = this.logDecoder(log);
    if (event.name in this.handlers) {
      await this.handlers[event.name](event);
    }

    return {};
  }

  async handleNewPool(event: LogDescription) {
    const token0 = event.args.token0.toLowerCase();
    const token1 = event.args.token1.toLowerCase();
    const fee = event.args.fee;

    await this.onPoolCreated({ token0, token1, fee });
  }
}
