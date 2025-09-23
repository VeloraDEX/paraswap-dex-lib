import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState, PoolParams } from './types';
import FluidDexLiteABI from '../../abi/fluid-dex-lite/FluidDexLite.abi.json';
import {
  BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP,
  X33,
  X64,
} from './fluid-dex-lite-math';
import {
  calculateMappingStorageSlot,
  normalizeDexId,
  readFromStorageCall,
} from './utils';
import { catchParseLogError } from '../../utils';

// Storage slot constants from DexLiteSlotsLink
const DEX_LITE_DEXES_LIST_SLOT = 1;
const DEX_LITE_DEX_VARIABLES_SLOT = 2;
const DEX_LITE_CENTER_PRICE_SHIFT_SLOT = 3;
const DEX_LITE_RANGE_SHIFT_SLOT = 4;
const DEX_LITE_THRESHOLD_SHIFT_SLOT = 5;

export class FluidDexLiteEventPool extends StatefulEventSubscriber<PoolState> {
  decoder = (log: Log) => this.fluidDexLiteIface.parseLog(log);

  private handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;
  addressesSubscribed: string[];
  poolParams: PoolParams;

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    mapKey: string,
    protected fluidDexLiteIface = new Interface(FluidDexLiteABI),
    poolParams: PoolParams,
    protected fluidDexLiteAddress: string,
  ) {
    super(parentName, `${mapKey}`, dexHelper, logger);

    this.poolParams = poolParams;
    this.logDecoder = (log: Log) => this.fluidDexLiteIface.parseLog(log);
    this.addressesSubscribed = [fluidDexLiteAddress];

    // Add handlers for all events that update state
    this.handlers['LogSwap'] = this.handleLogSwap.bind(this);
    this.handlers['LogInitialize'] = this.handleLogInitialize.bind(this);
    this.handlers['LogUpdateFeeAndRevenueCut'] =
      this.handleLogUpdateFeeAndRevenueCut.bind(this);
    this.handlers['LogUpdateRebalancingStatus'] =
      this.handleLogUpdateRebalancingStatus.bind(this);
    this.handlers['LogUpdateRangePercents'] =
      this.handleLogUpdateRangePercents.bind(this);
    this.handlers['LogUpdateShiftTime'] =
      this.handleLogUpdateShiftTime.bind(this);
    this.handlers['LogUpdateCenterPriceLimits'] =
      this.handleLogUpdateCenterPriceLimits.bind(this);
    this.handlers['LogUpdateThresholdPercent'] =
      this.handleLogUpdateThresholdPercent.bind(this);
    this.handlers['LogUpdateCenterPriceAddress'] =
      this.handleLogUpdateCenterPriceAddress.bind(this);
    this.handlers['LogDeposit'] = this.handleLogDeposit.bind(this);
    this.handlers['LogWithdraw'] = this.handleLogWithdraw.bind(this);
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
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

  /**
   * The function generates state using on-chain calls.
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const dexIdBytes = this.poolParams.dexId;

    const slots = [
      DEX_LITE_DEX_VARIABLES_SLOT,
      DEX_LITE_CENTER_PRICE_SHIFT_SLOT,
      DEX_LITE_RANGE_SHIFT_SLOT,
      DEX_LITE_THRESHOLD_SHIFT_SLOT,
    ].map(slot => calculateMappingStorageSlot(slot, dexIdBytes));

    const calls = slots.map(slot =>
      readFromStorageCall(
        this.fluidDexLiteAddress,
        this.fluidDexLiteIface,
        slot,
      ),
    );

    const [
      { returnData: dexVariables },
      { returnData: centerPriceShift },
      { returnData: rangeShift },
      { returnData: thresholdShift },
    ] = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
      false,
      calls,
      blockNumber,
    );

    const lastInteractionTimestamp =
      (centerPriceShift >>
        BigInt(BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP)) &
      X33;

    return {
      dexVariables,
      centerPriceShift,
      rangeShift,
      thresholdShift,
      lastInteractionTimestamp,
    };
  }

  // Event handlers
  handleLogSwap(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    if (!this.isCurrentDexId(event, 'swapData')) return state;

    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
    };
  }

  handleLogInitialize(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    if (!this.isCurrentDexId(event, 'dexId')) return state;

    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
      centerPriceShift: BigInt(event.args.centerPriceShift),
    };
  }

  handleLogUpdateFeeAndRevenueCut(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
    };
  }

  handleLogUpdateRebalancingStatus(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
    };
  }

  handleLogUpdateRangePercents(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
      rangeShift: BigInt(event.args.rangeShift),
    };
  }

  handleLogUpdateShiftTime(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      centerPriceShift: BigInt(event.args.centerPriceShift),
    };
  }

  handleLogUpdateCenterPriceLimits(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      centerPriceShift: BigInt(event.args.centerPriceShift),
    };
  }

  handleLogUpdateThresholdPercent(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
      thresholdShift: BigInt(event.args.thresholdShift),
    };
  }

  handleLogUpdateCenterPriceAddress(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
      centerPriceShift: BigInt(event.args.centerPriceShift),
    };
  }

  handleLogDeposit(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    if (!this.isCurrentDexId(event, 'dexId')) return state;

    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
    };
  }

  handleLogWithdraw(
    event: any,
    state: DeepReadonly<PoolState>,
  ): DeepReadonly<PoolState> {
    return {
      ...state,
      dexVariables: BigInt(event.args.dexVariables),
    };
  }

  private isCurrentDexId(event: any, fieldName: string): boolean {
    const dexId = normalizeDexId(this.poolParams.dexId);

    const swapData = event.args[fieldName];
    if (!swapData) return false;
    // Extract first 64 bits (8 bytes) as dexId
    const extractedDexId = (BigInt(swapData) & X64).toString(16);
    const eventDexId = normalizeDexId(extractedDexId);

    return eventDexId === dexId;
  }
}
