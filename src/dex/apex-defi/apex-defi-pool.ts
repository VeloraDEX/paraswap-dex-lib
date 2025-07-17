import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Address, Log, Logger } from '../../types';
import { bigIntify, catchParseLogError } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { ApexDefiPoolState } from './types';
import ApexDefiTokenABI from '../../abi/apex-defi/ApexDefiToken.abi.json';
import ApexDefiFactoryABI from '../../abi/apex-defi/ApexDefiFactory.abi.json';
import { AbiCoder } from '@ethersproject/abi';
import { fetchApexDefiOnChainPoolData, toBigInt } from './utils';
import { ETHER_ADDRESS } from '../../constants';

export class ApexDefiEventPool extends StatefulEventSubscriber<ApexDefiPoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<ApexDefiPoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<ApexDefiPoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;
  coder = new AbiCoder();

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
      if (this.token0.toLowerCase() === ETHER_ADDRESS.toLowerCase()) {
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
    state: DeepReadonly<ApexDefiPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<ApexDefiPoolState> | null {
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

  async getStateOrGenerate(
    blockNumber: number,
  ): Promise<Readonly<ApexDefiPoolState>> {
    const eventState = this.getState(blockNumber);
    if (eventState) return eventState;
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
  async generateState(
    blockNumber: number,
  ): Promise<DeepReadonly<ApexDefiPoolState>> {
    const poolData = await fetchApexDefiOnChainPoolData(
      this.poolAddress,
      this.network,
      blockNumber,
      this.dexHelper,
      this.apexDefiTokenIface,
      this.apexDefiFactoryIface,
    );

    if (!poolData) {
      throw new Error('No pool data found');
    }

    const state = {
      reserve0: toBigInt(poolData.reserve0),
      reserve1: toBigInt(poolData.reserve1),
      baseSwapRate: poolData.baseSwapRate,
      protocolFee: poolData.protocolFee,
      lpFee: poolData.lpFee,
      tradingFee: poolData.tradingFee,
      isLegacy: poolData.isLegacy,
    };

    return state;
  }

  // Handle swap events to update pool state
  handleSwap(
    event: any,
    state: DeepReadonly<ApexDefiPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<ApexDefiPoolState> | null {
    try {
      const { amountTokenIn, amountNativeIn, amountTokenOut, amountNativeOut } =
        event.args;

      // Use bigIntify for safety
      const tokenIn = bigIntify(amountTokenIn);
      const nativeIn = bigIntify(amountNativeIn);
      const tokenOut = bigIntify(amountTokenOut);
      const nativeOut = bigIntify(amountNativeOut);

      // Convert state reserves to BigInt
      const currentReserve0 = toBigInt(state.reserve0);
      const currentReserve1 = toBigInt(state.reserve1);

      // ✅ EXACT ON-CHAIN CALCULATION TRACE
      const inputAmount = tokenIn > 0n ? tokenIn : nativeIn;

      // Step 1: Calculate trading fee (exactly like contract)
      const tradingFees = (inputAmount * BigInt(state.tradingFee)) / 10000n;

      // Step 2: Calculate factory fee (different for V1 vs V2)
      let factoryFees: bigint;

      if (state.isLegacy) {
        // V1 token - calculate total fee and factory fee separately
        const totalFee = (inputAmount * BigInt(state.baseSwapRate)) / 10000n; // 30
        factoryFees = (inputAmount * BigInt(state.protocolFee)) / 10000n; // 25
        const lpFees = totalFee - factoryFees; // 5
      } else {
        // V2 token - use protocol fee breakdown
        const totalFactoryFee =
          (inputAmount * BigInt(state.baseSwapRate)) / 10000n;
        const protocolFee =
          (totalFactoryFee * BigInt(state.protocolFee)) / 10000n;
        const lpFee = (totalFactoryFee * BigInt(state.lpFee)) / 10000n;
        factoryFees = protocolFee;
      }

      // Step 3: Calculate total fees to set aside
      const totalFeesToSetAside = tradingFees + factoryFees;

      // Step 4: Calculate net amount for reserves
      const netAmountForReserves = inputAmount - totalFeesToSetAside;

      // Step 6: Update reserves (exactly like contract _swap function)
      let newReserve0 = currentReserve0;
      let newReserve1 = currentReserve1;

      if (nativeIn > 0n) {
        // Native to token swap
        newReserve0 = currentReserve0 + netAmountForReserves;
        newReserve1 = currentReserve1 - tokenOut;
      } else if (tokenIn > 0n) {
        // Token to native swap
        newReserve0 = currentReserve0 - nativeOut;
        newReserve1 = currentReserve1 + netAmountForReserves;
      }

      return {
        ...state,
        reserve0: newReserve0,
        reserve1: newReserve1,
      };
    } catch (error) {
      this.logger.error('Error in handleSwap:', error);
      this.logger.error('Error stack:', (error as Error).stack);
      return null;
    }
  }

  /**
   * Release any resources held by this event pool
   */
  releaseResources(): void {
    // Clean up any subscriptions or timers if needed
    this.addressesSubscribed = [];
  }
}
