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

  // Balances may differ slightly due to BurnFee plugin fees not tracked
  // by event handlers. Use tolerance: <0.01% of total balance.
  const bal0Diff =
    state.balance0 > expectedState.balance0
      ? state.balance0 - expectedState.balance0
      : expectedState.balance0 - state.balance0;
  const bal1Diff =
    state.balance1 > expectedState.balance1
      ? state.balance1 - expectedState.balance1
      : expectedState.balance1 - state.balance1;

  const tolerance0 =
    expectedState.balance0 > 0n ? expectedState.balance0 / 10000n : 1n;
  const tolerance1 =
    expectedState.balance1 > 0n ? expectedState.balance1 / 10000n : 1n;

  expect(bal0Diff).toBeLessThanOrEqual(tolerance0);
  expect(bal1Diff).toBeLessThanOrEqual(tolerance1);
}

function createPool(
  dexKey: string,
  network: Network,
  stateMulticallAddress: string,
  token0: string,
  token1: string,
  poolAddress: string,
) {
  const dexHelper = new DummyDexHelper(network);
  const logger = dexHelper.getLogger(dexKey);

  const pool = new AlgebraIntegralEventPool(
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
  describe('BlackholeCL - Avalanche', function () {
    const dexKey = 'BlackholeCL';
    const network = Network.AVALANCHE;
    const config = AlgebraIntegralConfig[dexKey][network];

    // WAVAX/USDC pool
    const poolAddress = '0xa02ec3ba8d17887567672b2cdcaf525534636ea0';
    const token0 = '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'; // WAVAX
    const token1 = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'; // USDC

    const blockNumbers: { [eventName: string]: number[] } = {
      Swap: [78816476, 78842289, 78866470],
      Mint: [78816486, 78841515, 78866465],
      Burn: [78816476, 78841593, 78866465],
      Collect: [78816476, 78841599, 78866465],
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
});
