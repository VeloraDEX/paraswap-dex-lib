/* eslint-disable no-console */
import dotenv from 'dotenv';
dotenv.config();

import { DummyDexHelper } from '../../dex-helper/index';
import { Network } from '../../constants';
import { Machima } from './machima';
import { Tokens } from '../../../tests/constants-e2e';
import { MACHIMA_POOL_FEE } from './constants';

/*
  Machima pool-state test (Base mainnet).

  Validates that the inherited UniswapV3EventPool resolves a Machima pool using
  the reused Base StateMulticall + the Machima pool init code hash, and that it
  produces a usable slot0 / liquidity state.

  Requires HTTP_PROVIDER_8453 in .env.
  Run: npx jest src/dex/machima/machima-events.test.ts
*/

describe('Machima pool state (Base)', function () {
  const network = Network.BASE;
  const dexKey = 'Machima';
  const dexHelper = new DummyDexHelper(network);
  const tokens = Tokens[network];

  it('resolves and generates state for the XMA/WETH pool', async function () {
    const blockNumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const machima = new Machima(network, dexKey, dexHelper);
    await machima.initializePricing(blockNumber);

    const pool = await machima.getPool(
      tokens['XMA'].address.toLowerCase(),
      tokens['WETH'].address.toLowerCase(),
      MACHIMA_POOL_FEE,
      blockNumber,
    );

    expect(pool).not.toBeNull();
    console.log('XMA/WETH pool address:', pool!.poolAddress);

    const state =
      pool!.getState(blockNumber) ?? (await pool!.generateState(blockNumber));
    expect(state).not.toBeNull();
    expect(state!.pool.toLowerCase()).toEqual(pool!.poolAddress.toLowerCase());
    expect(state!.liquidity).toBeGreaterThanOrEqual(0n);
    expect(state!.slot0.sqrtPriceX96).toBeGreaterThan(0n);
  });
});
