/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { Interface } from '@ethersproject/abi';
import { AlgebraIntegralConfig } from '../config';
import { Network } from '../../../constants';
import { DummyDexHelper } from '../../../dex-helper/index';
import { testEventSubscriber } from '../../../../tests/utils-events';
import ERC20ABI from '../../../abi/erc20.json';
import AlgebraIntegralStateMulticallABI from '../../../abi/algebra-integral/AlgebraIntegralStateMulticall.abi.json';
import { NamiV4Pool, NamiV4PoolState } from './nami-v4-pool';

jest.setTimeout(300 * 1000);

const dexKey = 'NamiV4';
const stateMulticallIface = new Interface(AlgebraIntegralStateMulticallABI);
const erc20Iface = new Interface(ERC20ABI);

async function fetchPoolStateFromContract(
  pool: NamiV4Pool,
  blockNumber: number,
  poolAddress: string,
): Promise<NamiV4PoolState> {
  const message = `NamiV4: ${poolAddress} blockNumber ${blockNumber}`;
  console.log(`Fetching state ${message}`);
  const state = await pool.generateState(blockNumber);
  console.log(`Done ${message}`);
  return state;
}

// Ticks created from Mint events carry only the fields the swap math reads;
// the state lens also returns the oracle-only fields, so compare the former.
function pricingTicks(ticks: NamiV4PoolState['ticks']) {
  return Object.fromEntries(
    Object.entries(ticks).map(([tick, info]) => [
      tick,
      {
        liquidityGross: info.liquidityGross,
        liquidityNet: info.liquidityNet,
        initialized: info.initialized,
      },
    ]),
  );
}

// The directional fees come from the plugin's adaptive curve, which moves
// with the volatility a swap itself adds, so they are read fresh at each
// poll rather than replayed from events and are only sanity checked here.
function stateCompare(state: NamiV4PoolState, expectedState: NamiV4PoolState) {
  expect(state.pool).toEqual(expectedState.pool);
  expect(state.tickSpacing).toEqual(expectedState.tickSpacing);
  expect(state.globalState.price).toEqual(expectedState.globalState.price);
  expect(state.globalState.tick).toEqual(expectedState.globalState.tick);
  expect(state.liquidity).toEqual(expectedState.liquidity);
  expect(pricingTicks(state.ticks)).toEqual(pricingTicks(expectedState.ticks));
  expect(state.tickBitmap).toEqual(expectedState.tickBitmap);
  expect(state.isValid).toEqual(true);
  expect(state.balance0).toEqual(expectedState.balance0);
  expect(state.balance1).toEqual(expectedState.balance1);
  expect(state.plugin).toEqual(expectedState.plugin);
  expect(state.globalState.feeZto).toBeGreaterThan(0n);
  expect(state.globalState.feeOtz).toBeGreaterThan(0n);
}

function testPool(
  network: Network,
  poolAddress: string,
  token0: string,
  token1: string,
  blockNumbers: { [eventName: string]: number[] },
) {
  const config = AlgebraIntegralConfig[dexKey][network];

  Object.keys(blockNumbers).forEach((event: string) => {
    blockNumbers[event].forEach((blockNumber: number) => {
      it(`${event}:${blockNumber} - should return correct state`, async function () {
        const dexHelper = new DummyDexHelper(network);
        const logger = dexHelper.getLogger(dexKey);

        const pool = new NamiV4Pool(
          dexHelper,
          dexKey,
          stateMulticallIface,
          config.stateMulticall,
          erc20Iface,
          token0,
          token1,
          logger,
          `${dexKey}_${network}`,
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
}

describe('NamiV4 Events', function () {
  describe('Mainnet USDC/WETH', function () {
    testPool(
      Network.MAINNET,
      '0x152cfc187a0c0695eb946c3a2f0a8c6604f0026d',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      {
        Swap: [26242364, 26242306, 26237330, 26235797, 26223224],
        Mint: [26187028, 26185064],
        Burn: [26187031],
        Collect: [26187031],
      },
    );
  });

  describe('Base WETH/USDC', function () {
    testPool(
      Network.BASE,
      '0x0e8af367dba0c9cb4674d38539ef3465a25a7237',
      '0x4200000000000000000000000000000000000006',
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      {
        Swap: [52902869, 52902373, 52900203, 52899275],
      },
    );
  });
});
