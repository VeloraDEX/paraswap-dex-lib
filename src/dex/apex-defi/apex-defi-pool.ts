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
import { calculateFees, toBigInt } from './utils';
import { AddressZero } from '@ethersproject/constants';

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
    this.logger.info('=== GENERATESTATE DEBUG ===');
    this.logger.info('Pool address:', this.poolAddress);
    this.logger.info('Block number:', blockNumber);

    // Use tryAggregate like other DEXes do
    const poolData = await this.dexHelper.multiContract.methods
      .tryAggregate(false, [
        // false = don't require all calls to succeed
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
          callData: this.apexDefiFactoryIface.encodeFunctionData('feeRate'),
        },
        {
          target: this.apexDefiFactoryAddress,
          callData: this.apexDefiFactoryIface.encodeFunctionData(
            'getFeeHookDetails',
            [this.poolAddress],
          ),
        },
      ])
      .call({}, blockNumber);

    this.logger.info('tryAggregate result:', poolData);

    // Check which calls succeeded
    const [reservesSuccess, reservesData] = poolData[0];
    const [tradingFeeSuccess, tradingFeeData] = poolData[1];
    const [feeRateSuccess, feeRateData] = poolData[2];
    const [feeHookSuccess, feeHookData] = poolData[3];

    this.logger.info('Call results:');
    this.logger.info('getReserves success:', reservesSuccess);
    this.logger.info('tradingFeeRate success:', tradingFeeSuccess);
    this.logger.info('feeRate success:', feeRateSuccess);
    this.logger.info('getFeeHookDetails success:', feeHookSuccess);

    if (!reservesSuccess || !tradingFeeSuccess || !feeRateSuccess) {
      throw new Error('Required calls failed');
    }

    // Decode the successful calls
    const reserves = this.apexDefiTokenIface.decodeFunctionResult(
      'getReserves',
      reservesData,
    ) as [bigint, bigint];

    const tradingFeeRate: bigint = this.apexDefiTokenIface.decodeFunctionResult(
      'tradingFeeRate',
      tradingFeeData,
    )[0];

    const feeRate: bigint = this.apexDefiFactoryIface.decodeFunctionResult(
      'feeRate',
      feeRateData,
    )[0];

    let feeHookDetails: [Address, bigint, bigint, bigint] = [
      AddressZero,
      0n,
      0n,
      0n,
    ];
    if (feeHookSuccess) {
      feeHookDetails = this.apexDefiFactoryIface.decodeFunctionResult(
        'getFeeHookDetails',
        feeHookData,
      ) as [Address, bigint, bigint, bigint];
    }

    const feeResult = calculateFees(feeHookDetails, feeRate);
    const baseSwapRate = feeResult.baseSwapRate;
    const protocolFee = feeResult.protocolFee;
    const lpFee = feeResult.lpFee;

    const state = {
      reserve0: toBigInt(reserves[0]),
      reserve1: toBigInt(reserves[1]),
      baseSwapRate: Number(baseSwapRate),
      protocolFee: Number(protocolFee),
      lpFee: Number(lpFee),
      tradingFee: Number(tradingFeeRate),
    };

    this.logger.info('Generated state:', state);
    return state;
  }

  // Add this helper function for rounding up division (like on-chain contracts)
  private mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
    const result = (a * b + denominator - 1n) / denominator;
    return result;
  }

  // Handle swap events to update pool state
  handleSwap(
    event: any,
    state: DeepReadonly<ApexDefiPoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<ApexDefiPoolState> | null {
    try {
      this.logger.info('=== HANDLESWAP DEBUG ===');
      this.logger.info(
        'Event args:',
        JSON.stringify(event.args, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      );

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

      this.logger.info('=== EXACT ON-CHAIN TRACE ===');
      this.logger.info('inputAmount:', inputAmount.toString());
      this.logger.info('state.baseSwapRate:', state.baseSwapRate);
      this.logger.info('state.tradingFee:', state.tradingFee);
      this.logger.info('state.protocolFee:', state.protocolFee);
      this.logger.info('state.lpFee:', state.lpFee);

      // Step 1: Calculate trading fee (exactly like contract)
      const tradingFees = (inputAmount * BigInt(state.tradingFee)) / 10000n;
      this.logger.info('Step 1 - tradingFees:', tradingFees.toString());

      // Step 2: Calculate factory fee (different for V1 vs V2)
      let factoryFees: bigint;

      if (state.protocolFee === 25 && state.lpFee === 5) {
        // V1 token - calculate total fee and factory fee separately
        const totalFee = (inputAmount * BigInt(state.baseSwapRate)) / 10000n; // 30
        factoryFees = (inputAmount * BigInt(state.protocolFee)) / 10000n; // 25
        const lpFees = totalFee - factoryFees; // 5

        this.logger.info('Step 2 - V1 totalFee:', totalFee.toString());
        this.logger.info('Step 2 - V1 factoryFees:', factoryFees.toString());
        this.logger.info('Step 2 - V1 lpFees:', lpFees.toString());
      } else {
        // V2 token - use protocol fee breakdown
        const totalFactoryFee =
          (inputAmount * BigInt(state.baseSwapRate)) / 10000n;
        const protocolFee =
          (totalFactoryFee * BigInt(state.protocolFee)) / 10000n;
        const lpFee = (totalFactoryFee * BigInt(state.lpFee)) / 10000n;
        factoryFees = protocolFee;
        this.logger.info(
          'Step 2 - V2 totalFactoryFee:',
          totalFactoryFee.toString(),
        );
        this.logger.info('Step 2 - V2 protocolFee:', protocolFee.toString());
        this.logger.info('Step 2 - V2 lpFee:', lpFee.toString());
        this.logger.info('Step 2 - V2 factoryFees:', factoryFees.toString());
      }

      // Step 3: Calculate total fees to set aside
      const totalFeesToSetAside = tradingFees + factoryFees;
      this.logger.info(
        'Step 3 - totalFeesToSetAside:',
        totalFeesToSetAside.toString(),
      );

      // Step 4: Calculate net amount for reserves
      const netAmountForReserves = inputAmount - totalFeesToSetAside;
      this.logger.info(
        'Step 4 - netAmountForReserves:',
        netAmountForReserves.toString(),
      );

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

      this.logger.info('=== RESERVE CALCULATION ===');
      this.logger.info('currentReserve0:', currentReserve0.toString());
      this.logger.info('currentReserve1:', currentReserve1.toString());
      this.logger.info('newReserve0:', newReserve0.toString());
      this.logger.info('newReserve1:', newReserve1.toString());

      // Step 7: Verify K value doesn't decrease (like contract)
      const oldK = currentReserve0 * currentReserve1;
      const newK = newReserve0 * newReserve1;
      this.logger.info('oldK:', oldK.toString());
      this.logger.info('newK:', newK.toString());
      this.logger.info('K increased:', newK > oldK);

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
