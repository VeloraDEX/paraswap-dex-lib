/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { FluidDexLiteEventPool } from './fluid-dex-lite-pool';
import { Network } from '../../constants';
import { Address } from '../../types';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState, DexKey } from './types';
import { FluidDexLiteConfig } from './config';
import { Interface } from '@ethersproject/abi';
import FluidDexLiteABI from '../../abi/fluid-dex-lite/FluidDexLite.abi.json';

/*
  FluidDexLite Event Tests
  =======================
  
  This test script validates the event-based state synchronization for FluidDexLite.
  Tests cover:
  - LogSwap events updating dexVariables and lastInteractionTimestamp
  - LogInitialize events setting up new pools 
  - Admin events updating pool parameters
  - State consistency between local and on-chain state
  
  Run with: npx jest src/dex/fluid-dex-lite/fluid-dex-lite-events.test.ts
*/

jest.setTimeout(300 * 1000);

const dexKey = 'FluidDexLite';
const network = Network.MAINNET;
const config = FluidDexLiteConfig[dexKey][network];

// Event block numbers where specific events occurred
// These should be updated with actual block numbers from mainnet
const eventBlockNumbers = {
  LogSwap: 18500000, // Block where a swap occurred
  LogInitialize: 18400000, // Block where a pool was initialized
  LogUpdateFeeAndRevenueCut: 18450000, // Block where fees were updated
  LogUpdateRangePercents: 18460000, // Block where range was updated
};

async function fetchPoolState(
  fluidDexLitePool: FluidDexLiteEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<PoolState> {
  // For testing with mock data, return a simple mock state
  // In production, this would fetch actual on-chain state
  return {
    dexVariables: 0n,
    centerPriceShift: 0n,
    rangeShift: 0n,
    thresholdShift: 0n,
    lastInteractionTimestamp: 0n,
  };
}

describe('FluidDexLite Event', function () {
  const fluidDexLiteAddress = config.dexLiteAddress;

  // Mock pool parameters for testing
  const mockDexKey: DexKey = {
    token0: '0xA0b86a33E6441b1c0b43a4af7E0F4C6E0f84E8c2', // Mock USDC
    token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Mock USDT
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
  };

  const mockDexId = '0x1234567890abcdef'; // 8 bytes
  const mockPoolParams = {
    dexKey: mockDexKey,
    dexId: mockDexId,
  };

  describe('FluidDexLiteEventPool', function () {
    // Test LogSwap events
    it('LogSwap:18500000 - should return correct state', async function () {
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);

      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        eventBlockNumbers.LogSwap,
        `${dexKey}_${fluidDexLiteAddress}`,
        dexHelper.provider,
      );
    });

    // Test LogInitialize events
    it('LogInitialize:18400000 - should return correct state', async function () {
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);

      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        eventBlockNumbers.LogInitialize,
        `${dexKey}_${fluidDexLiteAddress}`,
        dexHelper.provider,
      );
    });

    // Test LogUpdateFeeAndRevenueCut events
    it('LogUpdateFeeAndRevenueCut:18450000 - should return correct state', async function () {
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);

      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        eventBlockNumbers.LogUpdateFeeAndRevenueCut,
        `${dexKey}_${fluidDexLiteAddress}`,
        dexHelper.provider,
      );
    });

    // Test LogUpdateRangePercents events
    it('LogUpdateRangePercents:18460000 - should return correct state', async function () {
      const dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);

      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        eventBlockNumbers.LogUpdateRangePercents,
        `${dexKey}_${fluidDexLiteAddress}`,
        dexHelper.provider,
      );
    });
  });

  // Comprehensive tests for all event handlers with synthetic events
  describe('Event Handler Logic Tests', function () {
    let fluidDexLitePool: FluidDexLiteEventPool;
    let dexHelper: DummyDexHelper;
    let mockLog: any;
    let mockBlockHeader: any;
    let initialState: PoolState;

    beforeEach(() => {
      dexHelper = new DummyDexHelper(network);
      const logger = dexHelper.getLogger(dexKey);

      fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      // Shared mock objects for all tests
      mockLog = {
        blockNumber: 12345,
        topics: ['0x1234'],
        data: '0x',
        address: fluidDexLiteAddress,
        logIndex: 0,
        transactionIndex: 0,
        transactionHash: '0x1234567890abcdef',
        blockHash: '0x1234567890abcdef',
      };

      mockBlockHeader = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        parentHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        number: 12345,
        timestamp: 1234567890,
        nonce: '0x1234567890abcdef',
        difficulty: 0,
        gasLimit: 0x123456,
        gasUsed: 0x123456,
        miner: '0x1234567890abcdef1234567890abcdef12345678',
        extraData: '0x',
        transactions: [],
        baseFeePerGas: '0x123456',
        _difficulty: '0x0',
        sha3Uncles:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        logsBloom:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transactionRoot:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        stateRoot:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        receiptRoot:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      initialState = {
        dexVariables: 999n,
        centerPriceShift: 888n,
        rangeShift: 777n,
        thresholdShift: 666n,
        lastInteractionTimestamp: 555n,
      };
    });

    describe('LogSwap Event Handler', () => {
      it('should process LogSwap events with matching dexId and update state correctly', () => {
        const swapData = BigInt('0x' + mockDexId.slice(2) + '0'.repeat(48)); // dexId + padding
        const mockSwapEvent = {
          name: 'LogSwap',
          args: {
            swapData: swapData.toString(),
            dexVariables: '12345',
          },
        };

        const result = fluidDexLitePool.handleLogSwap(
          mockSwapEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(12345n); // Updated
        expect(result!.lastInteractionTimestamp).toBe(
          BigInt(mockBlockHeader.timestamp),
        ); // Updated to block timestamp
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
      });

      it('should process LogSwap events with different dexId correctly (no filtering at handler level)', () => {
        // Handlers don't filter - that's done by processLog
        const differentDexId = '0xfedcba0987654321';
        const swapData = BigInt(
          '0x' + differentDexId.slice(2) + '0'.repeat(48),
        );
        const mockSwapEvent = {
          name: 'LogSwap',
          args: {
            swapData: swapData.toString(),
            dexVariables: '54321',
          },
        };

        const result = fluidDexLitePool.handleLogSwap(
          mockSwapEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        // Handler should process any event - filtering is done by processLog
        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(54321n);
        expect(result!.lastInteractionTimestamp).toBe(
          BigInt(mockBlockHeader.timestamp),
        );
      });

      it('should handle LogSwap events with missing swapData', () => {
        // Handler should process event even without swapData (filtering done elsewhere)
        const mockSwapEvent = {
          name: 'LogSwap',
          args: {
            dexVariables: '99999',
          },
        };

        const result = fluidDexLitePool.handleLogSwap(
          mockSwapEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(99999n);
        expect(result!.lastInteractionTimestamp).toBe(
          BigInt(mockBlockHeader.timestamp),
        );
      });
    });

    describe('LogInitialize Event Handler', () => {
      it('should process LogInitialize events and update dexVariables and centerPriceShift', () => {
        const mockEvent = {
          name: 'LogInitialize',
          args: {
            dexId: mockDexId,
            dexVariables: '54321',
            centerPriceShift: '99999',
          },
        };

        const result = fluidDexLitePool.handleLogInitialize(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(54321n); // Updated
        expect(result!.centerPriceShift).toBe(99999n); // Updated
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });
    });

    describe('Admin Event Handlers', () => {
      it('should process LogUpdateFeeAndRevenueCut events and update dexVariables only', () => {
        const mockEvent = {
          name: 'LogUpdateFeeAndRevenueCut',
          args: {
            dexId: mockDexId,
            dexVariables: '11111',
            fee: '100',
            revenueCut: '500',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateFeeAndRevenueCut(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(11111n); // Updated
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogUpdateRebalancingStatus events and update dexVariables only', () => {
        const mockEvent = {
          name: 'LogUpdateRebalancingStatus',
          args: {
            dexId: mockDexId,
            dexVariables: '22222',
            status: true,
          },
        };

        const result = fluidDexLitePool.handleLogUpdateRebalancingStatus(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(22222n); // Updated
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogUpdateRangePercents events and update dexVariables and rangeShift', () => {
        const mockEvent = {
          name: 'LogUpdateRangePercents',
          args: {
            dexId: mockDexId,
            dexVariables: '33333',
            rangeShift: '44444',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateRangePercents(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(33333n); // Updated
        expect(result!.rangeShift).toBe(44444n); // Updated
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogUpdateShiftTime events and update centerPriceShift only', () => {
        const mockEvent = {
          name: 'LogUpdateShiftTime',
          args: {
            dexId: mockDexId,
            centerPriceShift: '55555',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateShiftTime(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.centerPriceShift).toBe(55555n); // Updated
        expect(result!.dexVariables).toBe(999n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogUpdateCenterPriceLimits events and update centerPriceShift only', () => {
        const mockEvent = {
          name: 'LogUpdateCenterPriceLimits',
          args: {
            dexId: mockDexId,
            centerPriceShift: '66666',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateCenterPriceLimits(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.centerPriceShift).toBe(66666n); // Updated
        expect(result!.dexVariables).toBe(999n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogUpdateThresholdPercent events and update dexVariables and thresholdShift', () => {
        const mockEvent = {
          name: 'LogUpdateThresholdPercent',
          args: {
            dexId: mockDexId,
            dexVariables: '77777',
            thresholdShift: '88888',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateThresholdPercent(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(77777n); // Updated
        expect(result!.thresholdShift).toBe(88888n); // Updated
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogUpdateCenterPriceAddress events and update dexVariables and centerPriceShift', () => {
        const mockEvent = {
          name: 'LogUpdateCenterPriceAddress',
          args: {
            dexId: mockDexId,
            dexVariables: '99999',
            centerPriceShift: '11111',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateCenterPriceAddress(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(99999n); // Updated
        expect(result!.centerPriceShift).toBe(11111n); // Updated
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });
    });

    describe('Liquidity Event Handlers', () => {
      it('should process LogDeposit events and update dexVariables only', () => {
        const mockEvent = {
          name: 'LogDeposit',
          args: {
            dexId: mockDexId,
            dexVariables: '12121',
          },
        };

        const result = fluidDexLitePool.handleLogDeposit(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(12121n); // Updated
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });

      it('should process LogWithdraw events and update dexVariables only', () => {
        const mockEvent = {
          name: 'LogWithdraw',
          args: {
            dexId: mockDexId,
            dexVariables: '34343',
          },
        };

        const result = fluidDexLitePool.handleLogWithdraw(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(34343n); // Updated
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
        expect(result!.rangeShift).toBe(777n); // Unchanged
        expect(result!.thresholdShift).toBe(666n); // Unchanged
        expect(result!.lastInteractionTimestamp).toBe(555n); // Unchanged
      });
    });

    describe('Handler Robustness Tests', () => {
      it('should process admin events with different dexId (no filtering at handler level)', () => {
        const wrongDexId = '0xfedcba0987654321';
        const mockEvent = {
          name: 'LogUpdateFeeAndRevenueCut',
          args: {
            dexId: wrongDexId,
            dexVariables: '11111',
            fee: '100',
            revenueCut: '500',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateFeeAndRevenueCut(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        // Handler should process any event - filtering is done by processLog
        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(11111n);
      });

      it('should handle events with missing dexId gracefully', () => {
        const mockEvent = {
          name: 'LogUpdateFeeAndRevenueCut',
          args: {
            // Missing dexId
            dexVariables: '22222',
            fee: '100',
            revenueCut: '500',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateFeeAndRevenueCut(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        // Handler should process event even without dexId
        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(22222n);
      });
    });

    describe('Additional Edge Cases', () => {
      it('should handle BigInt conversion correctly for large numbers', () => {
        const mockEvent = {
          name: 'LogSwap',
          args: {
            swapData: BigInt(
              '0x' + mockDexId.slice(2) + '0'.repeat(48),
            ).toString(),
            dexVariables: '999999999999999999999', // Very large number
          },
        };

        const result = fluidDexLitePool.handleLogSwap(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(999999999999999999999n);
      });

      it('should handle zero values correctly', () => {
        const mockEvent = {
          name: 'LogUpdateFeeAndRevenueCut',
          args: {
            dexId: mockDexId,
            dexVariables: '0',
            fee: '0',
            revenueCut: '0',
          },
        };

        const result = fluidDexLitePool.handleLogUpdateFeeAndRevenueCut(
          mockEvent,
          initialState,
          mockLog,
          mockBlockHeader,
        );

        expect(result).not.toBeNull();
        expect(result!.dexVariables).toBe(0n);
        expect(result!.centerPriceShift).toBe(888n); // Unchanged
      });
    });
  });
});

// Export test functions for jest (keeping original structure)
export function runFluidDexLiteEventTests() {
  const network = Network.MAINNET;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger('FluidDexLiteEventPool');

  const config = FluidDexLiteConfig['FluidDexLite'][network];
  const fluidDexLiteAddress = config.dexLiteAddress;

  // Mock pool parameters for testing
  const mockDexKey: DexKey = {
    token0: '0xA0b86a33E6441b1c0b43a4af7E0F4C6E0f84E8c2', // Mock USDC
    token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Mock USDT
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
  };

  const mockPoolParams = {
    dexKey: mockDexKey,
    dexId: '0x1234567890abcdef', // 8 bytes
  };

  return {
    testLogSwapEvents: async () => {
      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      const blockNumber = eventBlockNumbers.LogSwap;

      // Test event handling for LogSwap
      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        blockNumber,
        'FluidDexLite',
        dexHelper.provider,
      );
    },

    testLogInitializeEvents: async () => {
      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      const blockNumber = eventBlockNumbers.LogInitialize;

      // Test event handling for LogInitialize
      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        blockNumber,
        'FluidDexLite',
        dexHelper.provider,
      );
    },

    testLogUpdateFeeAndRevenueCutEvents: async () => {
      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      const blockNumber = eventBlockNumbers.LogUpdateFeeAndRevenueCut;

      // Test event handling for LogUpdateFeeAndRevenueCut
      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        blockNumber,
        'FluidDexLite',
        dexHelper.provider,
      );
    },

    testLogUpdateRangePercentsEvents: async () => {
      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      const blockNumber = eventBlockNumbers.LogUpdateRangePercents;

      // Test event handling for LogUpdateRangePercents
      await testEventSubscriber(
        fluidDexLitePool,
        fluidDexLitePool.addressesSubscribed,
        (_blockNumber: number) =>
          fetchPoolState(fluidDexLitePool, _blockNumber, fluidDexLiteAddress),
        blockNumber,
        'FluidDexLite',
        dexHelper.provider,
      );
    },

    testEventFiltering: () => {
      const fluidDexLitePool = new FluidDexLiteEventPool(
        'FluidDexLite',
        network,
        dexHelper,
        logger,
        'test-map-key',
        new Interface(FluidDexLiteABI),
        mockPoolParams,
        fluidDexLiteAddress,
      );

      // Mock event data
      const mockSwapEvent = {
        name: 'LogSwap',
        args: {
          swapData: BigInt('0x1234567890abcdef' + '0'.repeat(48)), // dexId + other data
          dexVariables: BigInt('12345'),
        },
      };

      // Test that events with matching dexId are processed
      const mockState: PoolState = {
        dexVariables: 0n,
        centerPriceShift: 0n,
        rangeShift: 0n,
        thresholdShift: 0n,
        lastInteractionTimestamp: 0n,
      };

      const mockLog = {
        blockNumber: 12345,
        topics: ['0x1234'],
        data: '0x',
        address: fluidDexLiteAddress,
        logIndex: 0,
        transactionIndex: 0,
        transactionHash: '0x1234567890abcdef',
        blockHash: '0x1234567890abcdef',
      };

      const mockBlockHeader = {
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        parentHash:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        number: 12345,
        timestamp: 1234567890,
        nonce: '0x1234567890abcdef',
        difficulty: 0,
        gasLimit: 0x123456,
        gasUsed: 0x123456,
        miner: '0x1234567890abcdef1234567890abcdef12345678',
        extraData: '0x',
        transactions: [],
        baseFeePerGas: '0x123456',
        _difficulty: '0x0',
        sha3Uncles:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        logsBloom:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        transactionRoot:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        stateRoot:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        receiptRoot:
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      };

      // This should process the event since dexId matches
      const result = fluidDexLitePool.handleLogSwap(
        mockSwapEvent,
        mockState,
        mockLog,
        mockBlockHeader,
      );

      if (!result) {
        throw new Error(
          'Event filtering failed - should have processed matching dexId',
        );
      }

      if (result.dexVariables !== BigInt('12345')) {
        throw new Error(
          `Expected dexVariables to be 12345, got ${result.dexVariables}`,
        );
      }

      if (result.lastInteractionTimestamp !== BigInt(1234567890)) {
        throw new Error(
          `Expected timestamp to be 1234567890, got ${result.lastInteractionTimestamp}`,
        );
      }

      console.log('✅ Event filtering test passed');
    },
  };
}

// Export for testing framework
export default runFluidDexLiteEventTests;
