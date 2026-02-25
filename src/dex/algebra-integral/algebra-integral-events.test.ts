/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { AlgebraIntegralConfig } from './config';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { AlgebraIntegralPoolState } from './types';
import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import AlgebraIntegralStateMulticallABI from '../../abi/algebra-integral/AlgebraIntegralStateMulticall.abi.json';
import { AlgebraIntegralEventPool } from './algebra-integral-pool';
import { BlackholeCLPool } from './forks/blackhole-cl-pool';

jest.setTimeout(300 * 1000);

const stateMulticallIface = new Interface(AlgebraIntegralStateMulticallABI);
const erc20Iface = new Interface(ERC20ABI);

async function fetchPoolStateFromContract(
  pool: AlgebraIntegralEventPool,
  blockNumber: number,
  poolAddress: string,
): Promise<AlgebraIntegralPoolState> {
  const message = `AlgebraIntegral: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  const state = await pool.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

function stateCompare(
  state: AlgebraIntegralPoolState,
  expectedState: AlgebraIntegralPoolState,
) {
  expect(state.pool).toEqual(expectedState.pool);
  expect(state.tickSpacing).toEqual(expectedState.tickSpacing);
  expect(state.globalState.price).toEqual(expectedState.globalState.price);
  expect(state.globalState.tick).toEqual(expectedState.globalState.tick);
  expect(state.globalState.fee).toEqual(expectedState.globalState.fee);
  expect(state.liquidity).toEqual(expectedState.liquidity);
  expect(state.isValid).toEqual(true);
  expect(state.balance0).toEqual(expectedState.balance0);
  expect(state.balance1).toEqual(expectedState.balance1);
}

function createPool(
  dexKey: string,
  network: Network,
  stateMulticallAddress: string,
  token0: string,
  token1: string,
  poolAddress: string,
  Poolimplementation: typeof AlgebraIntegralEventPool = AlgebraIntegralEventPool,
) {
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  const pool = new Poolimplementation(
    dexHelper,
    dexKey,
    stateMulticallIface,
    stateMulticallAddress,
    erc20Iface,
    token0,
    token1,
    logger,
    `${dexKey}_${network}`,
    poolAddress,
  );

  return { pool, dexHelper };
}

describe('AlgebraIntegral Events', function () {
  describe('QuickSwapV4 - Base', function () {
    const dexKey = 'QuickSwapV4';
    const network = Network.BASE;
    const config = AlgebraIntegralConfig[dexKey][network];

    // WETH/USDC pool
    const poolAddress = '0x5a9ad2bb92b0b3e5c571fdd5125114e04e02be1a';
    const token0 = '0x4200000000000000000000000000000000000006'; // WETH
    const token1 = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'; // USDC

    const blockNumbers: { [eventName: string]: number[] } = {
      Swap: [42614705, 42614648, 42614647, 42614636, 42614633],
      Mint: [42614648, 42614647, 42614631, 42614630, 42620744],
      Burn: [42614648, 42614647, 42614631, 42614630, 42620744],
      Collect: [42614648, 42614647, 42614631, 42614630, 42620744],
    };

    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`${event}:${blockNumber} - should return correct state`, async function () {
          const { pool, dexHelper } = createPool(
            dexKey,
            network,
            config.algebraStateMulticall,
            token0,
            token1,
            poolAddress,
          );

          await testEventSubscriber(
            pool as any,
            pool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolStateFromContract(pool, _blockNumber, poolAddress),
            blockNumber,
            `${dexKey}_${poolAddress}`,
            dexHelper.provider,
            stateCompare as any,
          );
        });
      });
    });
  });

  describe('BlackholeCL - Avalanche', function () {
    const dexKey = 'BlackholeCL';
    const network = Network.AVALANCHE;
    const config = AlgebraIntegralConfig[dexKey][network];

    // WAVAX/USDC pool
    const poolAddress = '0xa02ec3ba8d17887567672b2cdcaf525534636ea0';
    const token0 = '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'; // WAVAX
    const token1 = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'; // USDC

    const blockNumbers: { [eventName: string]: number[] } = {
      Swap: [78954389, 78954388, 78954387, 78954386, 78954385],
      Mint: [78954423, 78954387, 78954647, 78954668, 78954649],
      Burn: [78954423, 78954387, 78954385, 78954625, 78954628],
      Collect: [78954423, 78954387, 78954385, 78954625, 78954628],
    };

    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`${event}:${blockNumber} - should return correct state`, async function () {
          const { pool, dexHelper } = createPool(
            dexKey,
            network,
            config.algebraStateMulticall,
            token0,
            token1,
            poolAddress,
            BlackholeCLPool,
          );

          await testEventSubscriber(
            pool as any,
            pool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolStateFromContract(pool, _blockNumber, poolAddress),
            blockNumber,
            `${dexKey}_${poolAddress}`,
            dexHelper.provider,
            stateCompare as any,
          );
        });
      });
    });
  });

  describe('Supernova - Mainnet', function () {
    const dexKey = 'Supernova';
    const network = Network.MAINNET;
    const config = AlgebraIntegralConfig[dexKey][network];

    // WETH/USDT pool
    const poolAddress = '0xde758db54c1b4a87b06b34b30ef0a710dc35388f';
    const token0 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'; // WETH
    const token1 = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // USDT

    const blockNumbers: { [eventName: string]: number[] } = {
      Swap: [24534860, 24534858, 24534856, 24534854, 24534845],
      Mint: [24534848, 24534919, 24534945, 24534897, 24534891],
      Burn: [24534846, 24534917, 24534900, 24534895, 24534878],
      Collect: [24534846, 24534917, 24534955, 24534900, 24534895],
    };

    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`${event}:${blockNumber} - should return correct state`, async function () {
          const { pool, dexHelper } = createPool(
            dexKey,
            network,
            config.algebraStateMulticall,
            token0,
            token1,
            poolAddress,
            BlackholeCLPool,
          );

          await testEventSubscriber(
            pool as any,
            pool.addressesSubscribed,
            (_blockNumber: number) =>
              fetchPoolStateFromContract(pool, _blockNumber, poolAddress),
            blockNumber,
            `${dexKey}_${poolAddress}`,
            dexHelper.provider,
            stateCompare as any,
          );
        });
      });
    });
  });
});
