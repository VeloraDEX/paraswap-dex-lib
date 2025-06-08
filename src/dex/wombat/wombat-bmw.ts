import { Interface } from '@ethersproject/abi';
import { BytesLike } from 'ethers';
import { LogDescription } from 'ethers';
import { Contract } from 'web3-eth-contract';
import { DeepReadonly } from 'ts-essentials';
import { Address, Log, Logger, MultiCallInput } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper';
import { BmwState } from './types';
import BmwABI from '../../abi/wombat/bmw.json';
import AssetABI from '../../abi/wombat/asset.json';
import PoolABI from '../../abi/wombat/pool-v2.json';

export class WombatBmw extends StatefulEventSubscriber<BmwState> {
  static readonly bmwInterface = new Interface(BmwABI);
  static readonly assetInterface = new Interface(AssetABI);
  static readonly poolInterface = new Interface(PoolABI);

  private readonly logDecoder: (log: Log) => any;
  private bmwContract: Contract;
  private handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<BmwState>,
      log: Readonly<Log>,
    ) => Promise<DeepReadonly<BmwState> | null>;
  } = {};

  constructor(
    dexKey: string,
    name: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    protected bmwAddress: Address,
    protected onAssetAdded: (
      pool: Address,
      blockNumber: number,
    ) => Promise<void>,
  ) {
    super(
      `${dexKey}-${name}`,
      `${dexKey}-${network}-${name}`,
      dexHelper,
      logger,
    );

    this.logDecoder = (log: Log) => WombatBmw.bmwInterface.parseLog(log);
    this.addressesSubscribed = [this.bmwAddress];
    this.bmwContract = new this.dexHelper.web3Provider.eth.Contract(
      BmwABI as any,
      this.bmwAddress,
    );

    // users-actions handlers
    this.handlers['Add'] = this.handleAdd.bind(this);
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected async processLog(
    state: DeepReadonly<BmwState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<BmwState> | null> {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return await this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<BmwState>> {
    const bmwState: BmwState = { pools: [] };
    let inputs: MultiCallInput[] = [];

    const poolLength = await this.bmwContract.methods
      .poolLength()
      .call({}, blockNumber);
    for (let i = 0; i < poolLength; i++) {
      inputs.push({
        target: this.bmwAddress,
        callData: WombatBmw.bmwInterface.encodeFunctionData('poolInfo', [i]),
      });
    }
    let returnData = (
      await this.dexHelper.multiContract.methods
        .aggregate(inputs)
        .call({}, blockNumber)
    ).returnData;

    const lpTokens = returnData.map((data: BytesLike) =>
      WombatBmw.bmwInterface
        .decodeFunctionResult('poolInfo', data)[0]
        .toLowerCase(),
    );

    inputs = [];
    for (const lpToken of lpTokens) {
      inputs.push({
        target: lpToken,
        callData: WombatBmw.assetInterface.encodeFunctionData('pool'),
      });
    }

    returnData = (
      await this.dexHelper.multiContract.methods
        .aggregate(inputs)
        .call({}, blockNumber)
    ).returnData;

    const poolAddressSet = new Set<Address>();
    let i = 0;
    for (const lpToken of lpTokens) {
      const pool = WombatBmw.assetInterface
        .decodeFunctionResult('pool', returnData[i++])[0]
        .toLowerCase();

      poolAddressSet.add(pool);
    }

    const promises: Promise<void>[] = [];
    poolAddressSet.forEach(pool => {
      bmwState.pools.push(pool);
      promises.push(this.onAssetAdded(pool, blockNumber));
    });
    await Promise.all(promises);

    return bmwState;
  }

  async handleAdd(
    event: LogDescription,
    state: DeepReadonly<BmwState>,
    log: Readonly<Log>,
  ): Promise<DeepReadonly<BmwState> | null> {
    const lpToken = event.args.lpToken.toString().toLowerCase();
    let multiCallInputs: MultiCallInput[] = [];

    multiCallInputs.push({
      target: lpToken,
      callData: WombatBmw.assetInterface.encodeFunctionData('pool'),
    });

    const returnData = (
      await this.dexHelper.multiContract.methods
        .aggregate(multiCallInputs)
        .call({}, log.blockNumber)
    ).returnData;

    const pool = WombatBmw.assetInterface
      .decodeFunctionResult('pool', returnData[0])[0]
      .toLowerCase();

    await this.onAssetAdded(pool, log.blockNumber);
    if (!state.pools.includes(pool)) {
      return {
        pools: [...state.pools, pool],
      };
    } else {
      return {
        pools: state.pools,
      };
    }
  }
}
