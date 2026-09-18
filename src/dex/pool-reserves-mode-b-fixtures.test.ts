import { UNLIMITED_RESERVES } from '../constants';
import { MultiWrapper } from '../lib/multi-wrapper';
import { expectPoolReserves } from '../../tests/utils-pool-reserves';
import { WooFiV2 } from './woo-fi-v2/woo-fi-v2';
import { AngleStakedStable } from './angle-staked-stable/angle-staked-stable';
import { AngleTransmuter } from './angle-transmuter/angle-transmuter';
import { OSwap } from './oswap/oswap';
import { ERC4626 } from './erc4626/erc4626';
import { AaveGsm } from './aave-gsm/aave-gsm';

// Deterministic state cases for the state-backed enumerated-mode adapters.
// Instances are built from the prototype with only the fields
// `getPoolReserves` reads, so no RPC or event subscription is involved.

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const C = '0x3333333333333333333333333333333333333333';
const POOL = '0x4444444444444444444444444444444444444444';
const POOL2 = '0x5555555555555555555555555555555555555555';

const build = <T>(Cls: { prototype: T }, fields: object): T =>
  Object.assign(Object.create(Cls.prototype as object), fields);

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

const eventPool = (state: unknown, invalid = false) => ({
  isInvalid: () => invalid,
  getStaleState: () => state,
});

describe('pool reserves fixtures: WooFiV2', () => {
  const woo = (tokenStates: Record<string, { woFeasible: boolean }>) =>
    build(WooFiV2, {
      dexKey: 'WooFiV2',
      quoteTokenAddress: A,
      config: { wooPPV2Address: POOL },
      tokenByAddress: {
        [A]: { address: A },
        [B]: { address: B },
        [C]: { address: C },
      },
      pollingPool: {
        getState: async () => ({
          value: {
            isPaused: false,
            tokenInfos: {
              [A]: { reserve: 1n },
              [B]: { reserve: 2n },
              [C]: { reserve: 3n },
            },
            tokenStates,
          },
        }),
      },
    });

  it('excludes base tokens with an infeasible oracle', async () => {
    const reserves = await woo({
      [B]: { woFeasible: true },
      [C]: { woFeasible: false },
    }).getPoolReserves();
    expectPoolReserves(reserves, 'WooFiV2');
    expect(reserves[0].reserves).toEqual({ [A]: '1', [B]: '2' });
  });

  it('omits the pool when only the quote token is usable', async () => {
    const reserves = await woo({
      [B]: { woFeasible: false },
      [C]: { woFeasible: false },
    }).getPoolReserves();
    expect(reserves).toEqual([]);
  });
});

describe('pool reserves fixtures: AngleStakedStable', () => {
  const staked = (state: unknown) =>
    build(AngleStakedStable, {
      dexKey: 'AngleStakedStableUSD',
      config: { stakeToken: POOL, agToken: A },
      eventPools: { [POOL]: eventPool(state) },
    });

  it('reports mint unlimited and redeem = totalAssets', () => {
    const reserves = staked({
      totalAssets: 500n,
      paused: false,
    }).getPoolReserves();
    expectPoolReserves(reserves, 'AngleStakedStableUSD');
    expect(reserves[0].reserves).toEqual({
      [`${A}_${POOL}`]: UNLIMITED_RESERVES,
      [`${POOL}_${A}`]: '500',
    });
  });

  it('omits a paused vault', () => {
    expect(
      staked({ totalAssets: 500n, paused: true }).getPoolReserves(),
    ).toEqual([]);
  });
});

describe('pool reserves fixtures: AngleTransmuter', () => {
  const tryAggregate = jest.fn();
  const transmuter = (pool: object) =>
    build(AngleTransmuter, {
      dexKey: 'AngleTransmuter',
      stablecoinList: ['USD'],
      params: { USD: { transmuter: POOL, stablecoin: { address: A } } },
      eventPools: { USD: { ...pool, config: { collaterals: [B, C] } } },
      dexHelper: {
        multiWrapper: {
          defaultBatchSize: 500,
          tryAggregate,
        } as unknown as MultiWrapper,
      },
    });

  beforeEach(() => tryAggregate.mockReset());

  it('skips a fiat whose state is invalid or missing without calling RPC', async () => {
    expect(await transmuter(eventPool({}, true)).getPoolReserves()).toEqual([]);
    expect(await transmuter(eventPool(null)).getPoolReserves()).toEqual([]);
    expect(tryAggregate).not.toHaveBeenCalled();
  });

  it('keeps only the mint key for a collateral whose balance call failed', async () => {
    tryAggregate.mockResolvedValueOnce([
      { success: true, returnData: 7n },
      { success: false },
    ]);
    const reserves = await transmuter(eventPool({})).getPoolReserves();
    expectPoolReserves(reserves, 'AngleTransmuter');
    expect(reserves[0].reserves).toEqual({
      [`${B}_${A}`]: UNLIMITED_RESERVES,
      [`${A}_${B}`]: '7',
      [`${C}_${A}`]: UNLIMITED_RESERVES,
    });
  });
});

describe('pool reserves fixtures: OSwap', () => {
  it('generates missing state per pool and skips the one that fails', async () => {
    const good = {
      ...eventPool(null),
      name: 'good',
      generateState: jest.fn(async () => ({ balance0: '10', balance1: '20' })),
      setState: jest.fn(function (this: any, state: unknown) {
        this.getStaleState = () => state;
      }),
    };
    const bad = {
      ...eventPool(null),
      name: 'bad',
      generateState: jest.fn(async () => {
        throw new Error('revert');
      }),
      setState: jest.fn(),
    };
    const cached = eventPool({ balance0: '1', balance1: '2' });

    const oswap = build(OSwap, {
      dexKey: 'OSwap',
      logger,
      dexHelper: { web3Provider: { eth: { getBlockNumber: async () => 100 } } },
      pools: [
        { id: 'p1', address: POOL, token0: A, token1: B },
        { id: 'p2', address: POOL2, token0: A, token1: C },
        { id: 'p3', address: C, token0: B, token1: C },
      ],
      eventPools: { p1: good, p2: bad, p3: cached },
    });

    const reserves = await oswap.getPoolReserves();
    expectPoolReserves(reserves, 'OSwap');
    expect(reserves.map(r => r.address)).toEqual([POOL, C]);
    expect(reserves[0].reserves).toEqual({ [A]: '10', [B]: '20' });
    expect(reserves[1].reserves).toEqual({ [B]: '1', [C]: '2' });
    expect(good.generateState).toHaveBeenCalledWith(100);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('pool reserves fixtures: ERC4626', () => {
  const vault = (state: unknown) =>
    build(ERC4626, {
      dexKey: 'sUSDe',
      vault: POOL,
      asset: A,
      withdrawDisabled: false,
      eventPool: eventPool(state),
    });

  it('drops the redeem key while a cooldown is active', () => {
    const reserves = vault({
      totalAssets: 9n,
      totalShares: 9n,
      cooldownDuration: 100n,
    }).getPoolReserves();
    expect(reserves[0].reserves).toEqual({
      [`${A}_${POOL}`]: UNLIMITED_RESERVES,
    });
  });

  it('keeps redeem with value 0 when the vault is empty', () => {
    const reserves = vault({
      totalAssets: 0n,
      totalShares: 0n,
      cooldownDuration: 0n,
    }).getPoolReserves();
    expect(reserves[0].reserves[`${POOL}_${A}`]).toEqual('0');
  });
});

describe('pool reserves fixtures: AaveGsm', () => {
  const RAY = 10n ** 27n;
  const gsm = (state: object) =>
    build(AaveGsm, {
      dexKey: 'AaveGsm',
      config: { GHO: A },
      eventPools: {
        [POOL]: {
          ...eventPool({
            buyFee: 0n,
            sellFee: 0n,
            underlyingLiquidity: 1_000_000n,
            exposureCap: 1_000_000n,
            isFrozen: false,
            isSeized: false,
            rate: RAY,
            asset: B,
            ...state,
          }),
          gsm: POOL,
          underlying: B,
        },
      },
    });

  it("reports '0' for underlying -> GHO at the exposure cap", () => {
    const reserves = gsm({}).getPoolReserves();
    expectPoolReserves(reserves, 'AaveGsm');
    expect(reserves[0].reserves).toEqual({
      [`${A}_${B}`]: '1000000',
      [`${B}_${A}`]: '0',
    });
  });

  it('converts the remaining cap to GHO units', () => {
    const reserves = gsm({ exposureCap: 3_000_000n }).getPoolReserves();
    // 2_000_000 units of a 6-decimal asset at rate 1 = 2e18 GHO
    expect(reserves[0].reserves[`${B}_${A}`]).toEqual('2000000000000000000');
  });

  it('omits frozen and seized GSMs', () => {
    expect(gsm({ isFrozen: true }).getPoolReserves()).toEqual([]);
    expect(gsm({ isSeized: true }).getPoolReserves()).toEqual([]);
  });
});
