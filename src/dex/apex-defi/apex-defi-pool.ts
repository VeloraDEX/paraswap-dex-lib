import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Address, Log, Logger } from '../../types';
import { catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import ApexDefiTokenABI from '../../abi/apex-defi/ApexDefiToken.abi.json';
import ApexDefiFactoryABI from '../../abi/apex-defi/ApexDefiFactory.abi.json';

export class ApexDefiEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  addressesSubscribed: string[];

  readonly token0: Address;

  readonly token1: Address;

  private _poolAddress?: Address;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    token0: Address,
    token1: Address,
    poolAddress: Address,
    logger: Logger,
    protected apexDefiFactoryAddress: Address,
    protected apexDefiFactoryIface = new Interface(ApexDefiFactoryABI),
    protected apexDefiTokenIface = new Interface(ApexDefiTokenABI),
  ) {
    super(parentName, poolAddress, dexHelper, logger);

    this.token0 = token0.toLowerCase();
    this.token1 = token1.toLowerCase();
    this._poolAddress = poolAddress.toLowerCase();
    this.logDecoder = (log: Log) => this.apexDefiTokenIface.parseLog(log);
    this.addressesSubscribed = new Array<Address>(1).fill(poolAddress);

    // Add handlers
    this.handlers['Swap'] = this.handleSwap.bind(this);
  }

  get poolAddress() {
    // If the pool address is not set, compute it
    // ApexDefi pools are always in the format of WETH/token
    // If the token0 is WETH, then the pool address is the token1 address
    // Otherwise, the pool address is the token0 address
    if (this._poolAddress === undefined) {
      if (this.dexHelper.config.isWETH(this.token0)) {
        this._poolAddress = this.token1;
      } else {
        this._poolAddress = this.token0;
      }
    }

    return this._poolAddress;
  }

  set poolAddress(address: Address) {
    this._poolAddress = address.toLowerCase();
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
  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  async getStateOrGenerate(blockNumber: number): Promise<Readonly<PoolState>> {
    const evenState = this.getState(blockNumber);
    if (evenState) return evenState;
    const onChainState = await this.generateState(blockNumber);
    this.setState(onChainState, blockNumber);
    return onChainState;
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
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    // Get reserves, trading fee rate, and base swap rate for the pool
    const poolData = await this.dexHelper.multiContract.methods
      .aggregate([
        {
          target: this.poolAddress,
          callData: this.apexDefiTokenIface.encodeFunctionData(
            'getReserves',
            [],
          ),
        },
        {
          target: this.poolAddress,
          callData:
            this.apexDefiTokenIface.encodeFunctionData('tradingFeeRate'),
        },
        {
          target: this.apexDefiFactoryAddress,
          callData: this.apexDefiFactoryIface.encodeFunctionData(
            'getBaseSwapRate',
            [this.poolAddress],
          ),
        },
      ])
      .call({}, blockNumber);

    const reserves = this.apexDefiTokenIface.decodeFunctionResult(
      'getReserves',
      poolData.returnData[0],
    );
    const tradingFeeRate = this.apexDefiTokenIface.decodeFunctionResult(
      'tradingFeeRate',
      poolData.returnData[1],
    )[0];
    const baseSwapRate = this.apexDefiFactoryIface.decodeFunctionResult(
      'getBaseSwapRate',
      poolData.returnData[2],
    )[0];

    return {
      fee: Number(baseSwapRate),
      tradingFee: Number(tradingFeeRate),
      reserve0: reserves[0],
      reserve1: reserves[1],
    };
  }

  // Handle swap events to update pool state
  handleSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    // Parse the Swap event which contains:
    // - amountTokenIn: amount of tokens swapped in
    // - amountNativeIn: amount of native tokens (AVAX) swapped in
    // - amountTokenOut: amount of tokens swapped out
    // - amountNativeOut: amount of native tokens (AVAX) swapped out
    const { amountTokenIn, amountNativeIn, amountTokenOut, amountNativeOut } =
      event.args;

    // Calculate new reserves
    // For ApexDefi, reserve0 is always native (AVAX) and reserve1 is always the token
    const newReserve0 =
      state.reserve0 + BigInt(amountNativeIn) - BigInt(amountNativeOut);
    const newReserve1 =
      state.reserve1 + BigInt(amountTokenIn) - BigInt(amountTokenOut);

    // Ensure reserves don't go negative (shouldn't happen in practice)
    if (newReserve0 < 0n || newReserve1 < 0n) {
      this.logger.warn(
        'Negative reserves detected in swap event, ignoring state update',
      );
      return null;
    }

    return {
      ...state,
      reserve0: newReserve0,
      reserve1: newReserve1,
    };
  }

  /**
   * Release any resources held by this event pool
   */
  releaseResources(): void {
    // Clean up any subscriptions or timers if needed
    this.addressesSubscribed = [];
  }
}
