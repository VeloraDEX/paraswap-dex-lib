import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import ApexDefiFactoryABI from '../../abi/apex-defi/ApexDefiFactory.abi.json';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { Address, Log, Logger } from '../../types';
import { LogDescription } from 'ethers/lib/utils';

export type FactoryState = Record<string, never>;

export type OnPoolCreatedCallback = ({
  pairAddress,
  blockNumber,
}: {
  pairAddress: string;
  blockNumber: number;
}) => Promise<void>;

/*
 * "Stateless" event subscriber in order to capture "PoolCreated" event on new pools created.
 * State is present, but it's a placeholder to actually make the events reach handlers (if there's no previous state - `processBlockLogs` is not called)
 */
export class ApexDefiFactory extends StatefulEventSubscriber<FactoryState> {
  handlers: {
    [event: string]: (event: any, log: Readonly<Log>) => Promise<void>;
  } = {};

  logDecoder: (log: Log) => any;

  public readonly factoryIface = new Interface(ApexDefiFactoryABI);

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

    this.handlers['TokenCreated'] = this.handleTokenCreated.bind(this);
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
      await this.handlers[event.name](event, log);
    }

    return {};
  }

  async handleTokenCreated(event: LogDescription, log: Readonly<Log>) {
    const pairAddress = event.args.ammAddress.toLowerCase();

    await this.onPoolCreated({ pairAddress, blockNumber: log.blockNumber });
  }

  // Add this method
  releaseResources(): void {
    // Clear handlers
    this.handlers = {};

    // Clear addresses subscribed
    this.addressesSubscribed = [];
  }
}
