import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BalancerV2 } from './balancer-v2';
import { BalancerPoolTypes, SubgraphPoolBase } from './types';
import { poolGetMainTokens } from './utils';
import { keyBy } from 'lodash';
import { SpecialDex } from '../../executor/types';

const WETH = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
const USDC = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174';
const POOL_ID =
  '0x10f21c9bd8128a29aa785ab2de0d044dcdd79436000200000000000000000059';
const POOL_ADDR = '0x10f21c9bd8128a29aa785ab2de0d044dcdd79436';
const RECIPIENT = '0x082738d007001080a00099a000004f3006152085';
const EXECUTOR = '0x082738d007001080a00099a000004f3006152085';

function makePool(id: string, address: string): SubgraphPoolBase {
  const tokens = [
    { address: WETH, decimals: 18 },
    { address: USDC, decimals: 6 },
  ];
  const base = {
    id,
    address,
    poolType: BalancerPoolTypes.Weighted,
    poolTypeVersion: 4,
    tokens,
    tokensMap: keyBy(tokens, 'address'),
    mainIndex: 0,
    wrappedIndex: 0,
    root3Alpha: '',
    alpha: '',
    beta: '',
    c: '',
    s: '',
    lambda: '',
    tauAlphaX: '',
    tauAlphaY: '',
    tauBetaX: '',
    tauBetaY: '',
    u: '',
    v: '',
    w: '',
    z: '',
    dSq: '',
  };
  return {
    ...base,
    mainTokens: poolGetMainTokens(base as any, { [address]: base } as any),
  } as SubgraphPoolBase;
}

describe('BalancerV2 getDexParam without optimizer', () => {
  const dexHelper = new DummyDexHelper(Network.POLYGON);
  const balancerV2 = new BalancerV2(Network.POLYGON, 'BalancerV2', dexHelper);
  const pool = makePool(POOL_ID, POOL_ADDR);
  balancerV2.eventPools.allPools = [pool];

  it('SELL: raw pricing data encodes identically to optimizer-shaped data', () => {
    const srcAmount = '7002323829613962';
    const raw = balancerV2.getDexParam(
      WETH,
      USDC,
      srcAmount,
      '1',
      RECIPIENT,
      { gasUSD: '0.004572', poolId: POOL_ID } as any,
      SwapSide.SELL,
      EXECUTOR,
    );
    const optimized = balancerV2.getDexParam(
      WETH,
      USDC,
      srcAmount,
      '1',
      RECIPIENT,
      { swaps: [{ poolId: POOL_ID, amount: srcAmount }] },
      SwapSide.SELL,
      EXECUTOR,
    );
    expect(raw).toEqual(optimized);
    expect(raw.exchangeData.length).toBeGreaterThan(2);
  });

  it('BUY: raw pricing data encodes identically to optimizer-shaped data', () => {
    const srcAmount = '9999999999999999';
    const destAmount = '17171874';
    const raw = balancerV2.getDexParam(
      WETH,
      USDC,
      srcAmount,
      destAmount,
      RECIPIENT,
      { gasUSD: '0.004572', poolId: POOL_ID } as any,
      SwapSide.BUY,
      EXECUTOR,
    );
    const optimized = balancerV2.getDexParam(
      WETH,
      USDC,
      srcAmount,
      destAmount,
      RECIPIENT,
      { swaps: [{ poolId: POOL_ID, amount: destAmount }] },
      SwapSide.BUY,
      EXECUTOR,
    );
    expect(raw).toEqual(optimized);
  });

  it('multi-pool optimizer data still goes down the batch path untouched', () => {
    const second = makePool(POOL_ID.replace('0059', '0060'), POOL_ADDR);
    balancerV2.eventPools.allPools = [pool, second];
    const out = balancerV2.getDexParam(
      WETH,
      USDC,
      '3000',
      '1',
      RECIPIENT,
      {
        swaps: [
          { poolId: pool.id, amount: '1000' },
          { poolId: second.id, amount: '2000' },
        ],
      },
      SwapSide.SELL,
      EXECUTOR,
    );
    expect(out.specialDexFlag).toBe(SpecialDex.SWAP_ON_BALANCER_V2);
    balancerV2.eventPools.allPools = [pool];
  });

  it.each([
    ['empty swaps array', { swaps: [] }],
    ['null swaps', { swaps: null }],
    ['no poolId', { gasUSD: '0.004572' }],
    ['non-string poolId', { poolId: 123 }],
  ])('rejects malformed payload: %s', (_label, data) => {
    expect(() =>
      balancerV2.getDexParam(
        WETH,
        USDC,
        '1000',
        '1',
        RECIPIENT,
        data as any,
        SwapSide.SELL,
        EXECUTOR,
      ),
    ).toThrow(/neither swaps nor poolId/);
  });

  it('throws a clear error for an unknown poolId', () => {
    expect(() =>
      balancerV2.getDexParam(
        WETH,
        USDC,
        '1000',
        '1',
        RECIPIENT,
        { poolId: '0xdeadbeef' } as any,
        SwapSide.SELL,
        EXECUTOR,
      ),
    ).toThrow(/unknown poolId/);
  });
});
