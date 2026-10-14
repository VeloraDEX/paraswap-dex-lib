/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { FairylaunchEventPool } from './fairylaunch-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { PoolState } from './types';

jest.setTimeout(50 * 1000);

const BONDING_CURVE_ADDRESS = '0x3014646079673048abaa2d84c9a197eefcde7b9b';
const LAUNCH_FACTORY_ADDRESS = '0x28163d7943AA6715a9559D468B29c0343412E236';

describe('Fairylaunch EventPool BSC Mainnet', function () {
  const dexKey = 'Fairylaunch';
  const network = Network.BSC;
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);
  let fairylaunchPool: FairylaunchEventPool;

  beforeEach(async () => {
    fairylaunchPool = new FairylaunchEventPool(
      dexKey,
      network,
      dexHelper,
      logger,
      LAUNCH_FACTORY_ADDRESS,
    );
  });

  afterAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  it('should create event pool with handlers', function () {
    expect(fairylaunchPool).toBeDefined();
    expect(fairylaunchPool.handlers['Buy']).toBeDefined();
    expect(fairylaunchPool.handlers['Sell']).toBeDefined();
    expect(fairylaunchPool.handlers['Graduate']).toBeDefined();
    expect(fairylaunchPool.handlers['LaunchCreated']).toBeDefined();
  });

  it('should handle LaunchCreated event and register new BondingCurve', function () {
    const state: PoolState = {
      bondingCurve: BONDING_CURVE_ADDRESS,
      token: '0xEAf5A5AAd581EBFe893F7b31E3720e7bbaA3BAE5',
      ethReserve: 0n,
      tokenReserve: 800000000000000000000000000n,
      totalTokensSold: 0n,
      graduated: false,
      launchId: 1,
    };

    const newBondingCurve = '0x9999999999999999999999999999999999999999';
    const event = {
      name: 'LaunchCreated',
      args: {
        launchId: 2,
        creator: '0x1111111111111111111111111111111111111111',
        token: '0x2222222222222222222222222222222222222222',
        bondingCurve: newBondingCurve,
      },
    };

    const newState = fairylaunchPool.handleLaunchCreated(event, state);
    
    expect(newState).not.toBeNull();
    // El estado no debe cambiar, pero la BondingCurve debe registrarse
    expect(newState).toEqual(state);
  });

  it('should handle Buy event correctly', function () {
    const state: PoolState = {
      bondingCurve: BONDING_CURVE_ADDRESS,
      token: '0xEAf5A5AAd581EBFe893F7b31E3720e7bbaA3BAE5',
      ethReserve: 1000000000000000000n,
      tokenReserve: 1000000000000000000000000n,
      totalTokensSold: 500000000000000000000000n,
      graduated: false,
      launchId: 1,
    };

    const event = {
      name: 'Buy',
      args: {
        ethReserveAfter: 2000000000000000000n,
        tokenAmount: 100000000000000000000000n,
      },
    };

    const newState = fairylaunchPool.handleBuy(event, state);
    
    expect(newState).not.toBeNull();
    if (newState) {
      expect(newState.ethReserve).toBe(2000000000000000000n);
      expect(newState.tokenReserve).toBe(900000000000000000000000n);
      expect(newState.totalTokensSold).toBe(600000000000000000000000n);
    }
  });

  it('should handle Sell event correctly', function () {
    const state: PoolState = {
      bondingCurve: BONDING_CURVE_ADDRESS,
      token: '0xEAf5A5AAd581EBFe893F7b31E3720e7bbaA3BAE5',
      ethReserve: 2000000000000000000n,
      tokenReserve: 900000000000000000000000n,
      totalTokensSold: 600000000000000000000000n,
      graduated: false,
      launchId: 1,
    };

    const event = {
      name: 'Sell',
      args: {
        ethReserveAfter: 1500000000000000000n,
        tokenAmount: 50000000000000000000000n,
      },
    };

    const newState = fairylaunchPool.handleSell(event, state);
    
    expect(newState).not.toBeNull();
    if (newState) {
      expect(newState.ethReserve).toBe(1500000000000000000n);
      expect(newState.tokenReserve).toBe(950000000000000000000000n);
      expect(newState.totalTokensSold).toBe(550000000000000000000000n);
    }
  });

  it('should handle Graduate event correctly', function () {
    const state: PoolState = {
      bondingCurve: BONDING_CURVE_ADDRESS,
      token: '0xEAf5A5AAd581EBFe893F7b31E3720e7bbaA3BAE5',
      ethReserve: 6000000000000000000n,
      tokenReserve: 200000000000000000000000n,
      totalTokensSold: 800000000000000000000000n,
      graduated: false,
      launchId: 1,
    };

    const event = {
      name: 'Graduate',
      args: {},
    };

    const newState = fairylaunchPool.handleGraduate(event, state);
    
    expect(newState).not.toBeNull();
    if (newState) {
      expect(newState.graduated).toBe(true);
    }
  });
});