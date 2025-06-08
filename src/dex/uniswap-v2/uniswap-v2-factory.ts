import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import uniswapV2factoryABI from '../../abi/uniswap-v2/uniswap-v2-factory.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers';

export type FactoryState = Record<string, never>;

export type OnPoolCreatedCallback = ({
  token0,
  token1,
}: {
  token0: string;
  token1: string;
}) => Promise<void>;

/*
 * "Stateless" event subscriber in order to capture "PoolCreated" event on new pools created.
 * State is present, but it's a placeholder to actually make the events reach handlers (if there's no previous state - `processBlockLogs` is not called)
 */
export class UniswapV2Factory extends StatefulEventSubscriber<FactoryState> {
  handlers: {
    [event: string]: (event: any) => Promise<void>;
  } = {};

  logDecoder: (log: Log) => any;

  public readonly factoryIface = new Interface(uniswapV2factoryABI);

  constructor(
    readonly dexHelper: IDexHelper,
    parentName: string,
    protected readonly factoryAddress: Address,
    logger: Logger,
    protected readonly onPoolCreated: OnPoolCreatedCallback,
  ) {
    super(parentName, `${parentName} Factory`, dexHelper, logger);

    this.addressesSubscribed = [factoryAddress];

    this.logDecoder = (log: Log) => this.factoryIface.parseLog(log);

    this.handlers['PairCreated'] = this.handleNewPool.bind(this);
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

    await this.onPoolCreated({ token0, token1 });
  }
}
