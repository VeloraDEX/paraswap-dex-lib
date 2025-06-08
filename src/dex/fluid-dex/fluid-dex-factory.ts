import { BytesLike, Interface } from 'ethers';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import ResolverABI from '../../abi/fluid-dex/resolver.abi.json';
import DexFactoryABI from '../../abi/fluid-dex/dexFactory.abi.json';
import { CommonAddresses, Pool } from './types';
import { MultiResult } from '../../lib/multi-wrapper';
import { Address } from '../../types';
import { generalDecoder } from '../../lib/decoders';
import { Contract } from 'ethers';

type OnPoolCreatedCallback = (pools: readonly Pool[]) => void;

export class FluidDexFactory extends StatefulEventSubscriber<Pool[]> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<Pool[]>,
      log: Readonly<Log>,
    ) => Promise<DeepReadonly<Pool[]> | null>;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: Address[];
  protected dexFactoryIface = new Interface(DexFactoryABI);
  protected resolverIface = new Interface(ResolverABI);

  constructor(
    readonly parentName: string,
    readonly commonAddresses: CommonAddresses,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected readonly onPoolCreated: OnPoolCreatedCallback,
  ) {
    super(parentName, 'factory', dexHelper, logger);

    this.logDecoder = (log: Log) => this.dexFactoryIface.parseLog(log);
    this.addressesSubscribed = [commonAddresses.dexFactory];

    // Add handlers
    this.handlers['LogDexDeployed'] = this.handleDexDeployed.bind(this);
  }

  /**
   * Handle a trade rate change on the pool.
   */
  async handleDexDeployed(
    event: any,
    state: DeepReadonly<Pool[]>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<Pool[]> | null> {
    const blockNumber_ = await this.dexHelper.provider.getBlockNumber();

    const pools = await this.getStateOrGenerate(blockNumber_, false);

    this.onPoolCreated(pools);

    return pools;
  }

  decodePool = (result: MultiResult<BytesLike> | BytesLike): Pool => {
    return generalDecoder(
      result,
      ['tuple(address pool, address token0, address token1, uint256 fee)'],
      undefined,
      decoded => {
        return {
          address: decoded[0].toLowerCase(),
          token0: decoded[1].toLowerCase(),
          token1: decoded[2].toLowerCase(),
        };
      },
    );
  };

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  async processLog(
    state: DeepReadonly<Pool[]>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<Pool[]> | null> {
    try {
      let event;
      try {
        event = this.logDecoder(log);
      } catch (e) {
        return null;
      }
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getStateOrGenerate(
    blockNumber: number,
    readonly: boolean = false,
  ): Promise<DeepReadonly<Pool[]>> {
    let state = this.getState(blockNumber);
    if (!state) {
      state = await this.generateState(blockNumber);
      if (!readonly) this.setState(state, blockNumber);
    }
    return state;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<Pool[]>> {
    const resolverContract = new Contract(
      this.commonAddresses.resolver,
      ResolverABI,
      this.dexHelper.provider,
    );
    const rawResult = await resolverContract.getAllPools({
      blockTag: blockNumber,
    });

    const pools: Pool[] = rawResult.map((result: any) => ({
      address: result[0],
      token0: result[1],
      token1: result[2],
    }));

    return pools;
  }
}
