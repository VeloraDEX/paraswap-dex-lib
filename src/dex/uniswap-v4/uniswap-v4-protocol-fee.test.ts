import { Interface } from 'ethers/lib/utils';
import { SwapSide } from '@paraswap/core';
import UniswapV4PoolManagerABI from '../../abi/uniswap-v4/pool-manager.abi.json';
import { UniswapV4Pool } from './uniswap-v4-pool';
import { uniswapV4PoolMath } from './contract-math/uniswap-v4-pool-math';
import { Pool, PoolState } from './types';

// Expected amounts are produced by v4-core PoolManager.swap on an identical pool:
// tickSpacing 60, lpFee 3000, sqrtPriceX96 = 2^96 (tick 0),
// one position [-6000, 6000] with liquidity 1e24, exact-in 1e18.

const POOL_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000001';
const LP_FEE = 3000n;
const AMOUNT_IN = 10n ** 18n;

const poolManagerIface = new Interface(UniswapV4PoolManagerABI);

const pool: Pool = {
  id: POOL_ID,
  key: {
    currency0: '0x0000000000000000000000000000000000000001',
    currency1: '0x0000000000000000000000000000000000000002',
    fee: LP_FEE.toString(),
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000',
  },
};

function buildPoolState(protocolFee: bigint): PoolState {
  const state: PoolState = {
    id: POOL_ID,
    token0: pool.key.currency0,
    token1: pool.key.currency1,
    fee: LP_FEE.toString(),
    hooks: pool.key.hooks,
    feeGrowthGlobal0X128: 0n,
    feeGrowthGlobal1X128: 0n,
    liquidity: 0n,
    slot0: {
      sqrtPriceX96: 2n ** 96n,
      tick: 0n,
      protocolFee,
      lpFee: LP_FEE,
    },
    tickSpacing: 60,
    ticks: {},
    tickBitmap: {},
    isValid: true,
  };

  uniswapV4PoolMath.modifyLiquidity(state, {
    liquidityDelta: 10n ** 24n,
    tickLower: -6000n,
    tickUpper: 6000n,
    tickSpacing: 60n,
  });

  return state;
}

// Decode a ProtocolFeeUpdated log exactly like the event subscriber does
function protocolFeeUpdatedEvent(protocolFee: bigint) {
  const fragment = poolManagerIface.getEvent('ProtocolFeeUpdated');
  const { data, topics } = poolManagerIface.encodeEventLog(fragment, [
    POOL_ID,
    protocolFee,
  ]);
  return poolManagerIface.parseLog({ data, topics });
}

function applyProtocolFeeUpdated(state: PoolState, protocolFee: bigint) {
  // the handler does not depend on instance state
  return UniswapV4Pool.prototype.handleProtocolFeeUpdatedEvent.call(
    undefined,
    protocolFeeUpdatedEvent(protocolFee),
    state,
  );
}

const sell = (state: PoolState, zeroForOne: boolean) =>
  uniswapV4PoolMath.queryOutputs(
    pool,
    state,
    [AMOUNT_IN],
    zeroForOne,
    SwapSide.SELL,
  )[0];

const pack = (zeroForOne: bigint, oneForZero: bigint) =>
  zeroForOne | (oneForZero << 12n);

describe('UniswapV4 ProtocolFeeUpdated event', () => {
  it('updates slot0.protocolFee and leaves slot0.lpFee untouched', () => {
    const state = applyProtocolFeeUpdated(buildPoolState(0n), pack(50n, 50n));

    expect(state.slot0.protocolFee).toBe(pack(50n, 50n));
    expect(state.slot0.lpFee).toBe(LP_FEE);
  });

  it('quotes match v4 after the fee switch is turned on (250 / 0 pips)', () => {
    const state = applyProtocolFeeUpdated(buildPoolState(0n), pack(250n, 0n));

    // swapFee = 3000 + 250 - 3000 * 250 / 1e6 = 3250 pips for zeroForOne
    expect(sell(state, true)).toBe(996749006490427780n);
    // oneForZero protocol fee is 0, swap fee is the plain 3000 lp fee
    expect(sell(state, false)).toBe(996999005991991025n);
  });

  it('quotes match v4 with a symmetric protocol fee (50 / 50 pips)', () => {
    const state = applyProtocolFeeUpdated(buildPoolState(0n), pack(50n, 50n));

    expect(sell(state, true)).toBe(996949006091688376n);
  });

  it('quotes match v4 after the fee switch is turned off again', () => {
    const state = applyProtocolFeeUpdated(buildPoolState(pack(50n, 50n)), 0n);

    expect(state.slot0.protocolFee).toBe(0n);
    expect(state.slot0.lpFee).toBe(LP_FEE);
    expect(sell(state, true)).toBe(996999005991991025n);
  });
});
