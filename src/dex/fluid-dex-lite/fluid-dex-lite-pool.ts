import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, BlockHeader, Logger } from '../../types';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  PoolState,
  DexKey,
  PoolParams,
  BITS_DEX_LITE_CENTER_PRICE_SHIFT_LAST_INTERACTION_TIMESTAMP,
  X33,
  X64,
} from './types';
import FluidDexLiteABI from '../../abi/fluid-dex-lite/FluidDexLite.abi.json';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { keccak256 } from 'web3-utils';
import { uint256ToBigInt } from '../../lib/decoders';

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
      blockHeader: Readonly<BlockHeader>,
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
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        // Normalize our pool's dexId once
        const normalizedPoolDexId = this.normalizeDexId(this.poolParams.dexId);

        let eventDexId = '';

        // Extract dexId from event based on event type
        if (event.name === 'LogSwap') {
          if (!event.args.swapData) {
            return null;
          }

          try {
            const swapData = BigInt(event.args.swapData.toString());
            // Extract first 64 bits (8 bytes) as dexId
            const extractedDexId = (swapData & X64).toString(16);
            eventDexId = this.normalizeDexId(extractedDexId);
          } catch (error) {
            return null;
          }
        } else {
          // For other events, check if dexId field exists
          if (!event.args.dexId) {
            return null;
          }

          eventDexId = this.normalizeDexId(event.args.dexId.toString());
        }

        // Compare normalized dexIds
        if (eventDexId !== normalizedPoolDexId) {
          // Not for this pool, skip silently
          return null;
        }

        return this.handlers[event.name](event, state, log, blockHeader);
      }
    } catch (e) {
      this.logger.error('Error processing log', e);
    }
    return null;
  }

  /**
   * The function generates state using on-chain calls.
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const dexIdBytes = this.poolParams.dexId;

    // Calculate storage slots for mappings
    const dexVariablesSlot = this.calculateMappingStorageSlot(
      DEX_LITE_DEX_VARIABLES_SLOT,
      dexIdBytes,
    );
    const centerPriceShiftSlot = this.calculateMappingStorageSlot(
      DEX_LITE_CENTER_PRICE_SHIFT_SLOT,
      dexIdBytes,
    );
    const rangeShiftSlot = this.calculateMappingStorageSlot(
      DEX_LITE_RANGE_SHIFT_SLOT,
      dexIdBytes,
    );
    const thresholdShiftSlot = this.calculateMappingStorageSlot(
      DEX_LITE_THRESHOLD_SHIFT_SLOT,
      dexIdBytes,
    );

    const multicallData = [
      {
        target: this.fluidDexLiteAddress,
        callData: this.fluidDexLiteIface.encodeFunctionData('readFromStorage', [
          dexVariablesSlot,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.fluidDexLiteAddress,
        callData: this.fluidDexLiteIface.encodeFunctionData('readFromStorage', [
          centerPriceShiftSlot,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.fluidDexLiteAddress,
        callData: this.fluidDexLiteIface.encodeFunctionData('readFromStorage', [
          rangeShiftSlot,
        ]),
        decodeFunction: uint256ToBigInt,
      },
      {
        target: this.fluidDexLiteAddress,
        callData: this.fluidDexLiteIface.encodeFunctionData('readFromStorage', [
          thresholdShiftSlot,
        ]),
        decodeFunction: uint256ToBigInt,
      },
    ];

    const storageResults =
      await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        multicallData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

    const dexVariables = storageResults[0].returnData;
    const centerPriceShift = storageResults[1].returnData;
    const rangeShift = storageResults[2].returnData;
    const thresholdShift = storageResults[3].returnData;

    // Extract lastInteractionTimestamp from centerPriceShift data
    // Use consistent bit shifting pattern (even though bit position is 0)
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

  // Helper function to calculate mapping storage slot
  private calculateMappingStorageSlot(slot: number, key: string): string {
    // For bytes8 keys in Solidity mappings, we need to pad to bytes32
    // The dexId is bytes8 but storage slot calculation expects bytes32
    const paddedKey = key.padEnd(66, '0'); // Pad to 32 bytes (0x + 64 hex chars)

    // Solidity mapping storage slot calculation: keccak256(abi.encode(key, slot))
    const encoded = defaultAbiCoder.encode(
      ['bytes32', 'uint256'],
      [paddedKey, slot],
    );
    return keccak256(encoded);
  }

  // Helper function to normalize dexId consistently
  private normalizeDexId(dexId: string): string {
    if (!dexId) {
      return '';
    }

    // Convert to lowercase and ensure it's a string
    const idStr = dexId.toString().toLowerCase();

    // If it starts with 0x, ensure we have exactly 18 characters total (0x + 16 hex chars)
    if (idStr.startsWith('0x')) {
      return '0x' + idStr.slice(2).padStart(16, '0');
    } else {
      // Add 0x prefix and pad to 16 hex characters
      return '0x' + idStr.padStart(16, '0');
    }
  }

  // Event handlers
  handleLogSwap(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    // Update timestamp to current block timestamp for swap events
    const newTimestamp = BigInt(blockHeader.timestamp);
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: newTimestamp,
    };
  }

  handleLogInitialize(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    const newCenterPriceShift = BigInt(event.args.centerPriceShift.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: newCenterPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateFeeAndRevenueCut(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateRebalancingStatus(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateRangePercents(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    const newRangeShift = BigInt(event.args.rangeShift.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: newRangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateShiftTime(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newCenterPriceShift = BigInt(event.args.centerPriceShift.toString());
    return {
      dexVariables: state.dexVariables,
      centerPriceShift: newCenterPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateCenterPriceLimits(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newCenterPriceShift = BigInt(event.args.centerPriceShift.toString());
    return {
      dexVariables: state.dexVariables,
      centerPriceShift: newCenterPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateThresholdPercent(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    const newThresholdShift = BigInt(event.args.thresholdShift.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: newThresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogUpdateCenterPriceAddress(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    const newCenterPriceShift = BigInt(event.args.centerPriceShift.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: newCenterPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogDeposit(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }

  handleLogWithdraw(
    event: any,
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
    blockHeader: Readonly<BlockHeader>,
  ): DeepReadonly<PoolState> | null {
    const newDexVariables = BigInt(event.args.dexVariables.toString());
    return {
      dexVariables: newDexVariables,
      centerPriceShift: state.centerPriceShift,
      rangeShift: state.rangeShift,
      thresholdShift: state.thresholdShift,
      lastInteractionTimestamp: state.lastInteractionTimestamp,
    };
  }
}
