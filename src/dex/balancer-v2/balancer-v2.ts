import { Interface } from '@ethersproject/abi';
import { assert, DeepReadonly } from 'ts-essentials';
import _, { keyBy } from 'lodash';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  ExchangeTxInfo,
  Log,
  Logger,
  PoolLiquidity,
  PoolPrices,
  PreprocessTransactionOptions,
  SimpleExchangeParam,
  Token,
  TxInfo,
} from '../../types';
import {
  ETHER_ADDRESS,
  MAX_INT,
  Network,
  NULL_ADDRESS,
  SUBGRAPH_TIMEOUT,
  SwapSide,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { StablePool } from './pools/stable/StablePool';
import { WeightedPool } from './pools/weighted/WeightedPool';
import { PhantomStablePool } from './pools/phantom-stable/PhantomStablePool';
import { LinearPool } from './pools/linear/LinearPool';
import { Gyro3Pool } from './pools/gyro/Gyro3Pool';
import { GyroEPool } from './pools/gyro/GyroEPool';
import VaultABI from '../../abi/balancer-v2/vault.json';
import DirectSwapABI from '../../abi/DirectSwap.json';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import {
  getBigIntPow,
  getDexKeysWithNetwork,
  uuidToBytes16,
} from '../../utils';
import { Context, IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper';
import {
  BalancerV2BatchSwapParam,
  BalancerPoolTypes,
  BalancerSwap,
  BalancerV2Data,
  BalancerV2DirectParam,
  OptimizedBalancerV2Data,
  PoolState,
  PoolStateCache,
  PoolStateMap,
  SubgraphPoolAddressDictionary,
  SubgraphPoolBase,
  SwapTypes,
  BalancerV2DirectParamV6,
  BalancerV2DirectParamV6Swap,
  BalancerV2SwapParam,
  BalancerV2SingleSwap,
} from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { Adapters, BalancerConfig } from './config';
import {
  getAllPoolsUsedInPaths,
  isSameAddress,
  poolGetMainTokens,
  poolGetPathForTokenInOut,
} from './utils';
import {
  DirectMethods,
  DirectMethodsV6,
  MIN_USD_LIQUIDITY_TO_FETCH,
  STABLE_GAS_COST,
  VARIABLE_GAS_COST_PER_CYCLE,
} from './constants';
import { NumberAsString, OptimalSwapExchange } from '@paraswap/core';
import { hexConcat, hexlify, hexZeroPad, solidityPack } from 'ethers/lib/utils';
import BalancerVaultABI from '../../abi/balancer-v2/vault.json';
import { BigNumber } from 'ethers';
import { SpecialDex } from '../../executor/types';
import { extractReturnAmountPosition } from '../../executor/utils';

// If you disable some pool, don't forget to clear the cache, otherwise changes won't be applied immediately
const enabledPoolTypes = [
  // BalancerPoolTypes.MetaStable, // BOOSTED POOLS Disabled since vulnerability https://github.com/BalancerMaxis/multisig-ops/blob/main/BIPs/00notGov/2023-08-mitigation.md
  BalancerPoolTypes.Stable,
  BalancerPoolTypes.Weighted,
  BalancerPoolTypes.LiquidityBootstrapping,
  BalancerPoolTypes.Investment,
  BalancerPoolTypes.StablePhantom,
  BalancerPoolTypes.AaveLinear,
  BalancerPoolTypes.ERC4626Linear,
  BalancerPoolTypes.Linear,
  BalancerPoolTypes.ComposableStable,
  BalancerPoolTypes.BeefyLinear,
  BalancerPoolTypes.GearboxLinear,
  BalancerPoolTypes.MidasLinear,
  BalancerPoolTypes.ReaperLinear,
  BalancerPoolTypes.SiloLinear,
  BalancerPoolTypes.TetuLinear,
  BalancerPoolTypes.YearnLinear,
  BalancerPoolTypes.GyroE,
  BalancerPoolTypes.Gyro3,
];

const disabledPoolIds = [
  // broken ?
  '0xbd482ffb3e6e50dc1c437557c3bea2b68f3683ee0000000000000000000003c6',

  /* DISABLED POOLS SINCE VULNERABILITY https://github.com/BalancerMaxis/multisig-ops/blob/main/BIPs/00notGov/2023-08-mitigation.md*/
  /* START:2023-08-mitigation */
  //mainnet
  '0xbf2ef8bdc2fc0f3203b3a01778e3ec5009aeef3300000000000000000000058d',
  '0x99c88ad7dc566616548adde8ed3effa730eb6c3400000000000000000000049a',
  '0x60683b05e9a39e3509d8fdb9c959f23170f8a0fa000000000000000000000489',
  '0xa13a9247ea42d743238089903570127dda72fe4400000000000000000000035d',
  '0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb20000000000000000000000fe',
  '0x25accb7943fd73dda5e23ba6329085a3c24bfb6a000200000000000000000387',
  '0x50cf90b954958480b8df7958a9e965752f62712400000000000000000000046f',
  '0x133d241f225750d2c92948e464a5a80111920331000000000000000000000476',
  '0x8a6b25e33b12d1bb6929a8793961076bd1f9d3eb0002000000000000000003e8',
  '0x959216bb492b2efa72b15b7aacea5b5c984c3cca000200000000000000000472',
  '0x9b692f571b256140a39a34676bffa30634c586e100000000000000000000059d',
  '0xe7b1d394f3b40abeaa0b64a545dbcf89da1ecb3f00010000000000000000009a',

  // polygon
  '0xb3d658d5b95bf04e2932370dd1ff976fe18dd66a000000000000000000000ace',
  '0x48e6b98ef6329f8f0a30ebb8c7c960330d64808500000000000000000000075b',
  '0xb54b2125b711cd183edd3dd09433439d5396165200000000000000000000075e',

  // arbitrum
  '0xa8af146d79ac0bb981e4e0d8b788ec5711b1d5d000000000000000000000047b',
  '0x077794c30afeccdf5ad2abc0588e8cee7197b71a000000000000000000000352',
  '0x519cce718fcd11ac09194cff4517f12d263be067000000000000000000000382',

  // optimism
  '0x23ca0306b21ea71552b148cf3c4db4fc85ae19290000000000000000000000ac',
  '0x62cf35db540152e94936de63efc90d880d4e241b0000000000000000000000ef',
  '0x098f32d98d0d64dba199fc1923d3bf4192e787190001000000000000000000d2',
  '0x43da214fab3315aa6c02e0b8f2bfb7ef2e3c60a50000000000000000000000ae',
  '0xb1c9ac57594e9b1ec0f3787d9f6744ef4cb0a02400000000000000000000006e',
  '0xde45f101250f2ca1c0f8adfc172576d10c12072d00000000000000000000003f',
  '0x05e7732bf9ae5592e6aa05afe8cd80f7ab0a7bea00020000000000000000005a',
  '0x981fb05b738e981ac532a99e77170ecb4bc27aef00010000000000000000004b',
  '0x6222ae1d2a9f6894da50aa25cb7b303497f9bebd000000000000000000000046',
  '0x3c74c4ed512050eb843d89fb9dcd5ebb4668eb6d0002000000000000000000cc',

  // fantom
  '0xc0064b291bd3d4ba0e44ccfc81bf8e7f7a579cd200000000000000000000042c',
  '0x6e6dc948ce85c62125ff7a1e543d761a88f0a4cb000000000000000000000743',
  '0x78ab08bf98f90f29a09c9b1d85b3b549369b03a3000100000000000000000354',
  '0x302b8b64795b064cadc32f74993a6372498608070001000000000000000003e0',
  '0x5ddb92a5340fd0ead3987d3661afcd6104c3b757000000000000000000000187',
  '0xdfc65c1f15ad3507754ef0fd4ba67060c108db7e000000000000000000000406',
  '0x6da14f5acd58dd5c8e486cfa1dc1c550f5c61c1c0000000000000000000003cf',
  '0x592fa9f9d58065096f2b7838709c116957d7b5cf00020000000000000000043c',
  '0xf47f4d59c863c02cbfa3eefe6771b9c9fbe7b97800000000000000000000072b',
  '0xff2753aaba51c9f84689b9bd0a21b3cf380a1cff00000000000000000000072e',
  '0x10441785a928040b456a179691141c48356eb3a50001000000000000000002fa',
  '0x64b301e21d640f9bef90458b0987d81fb4cf1b9e00020000000000000000022e',
  '0xba0e9aea8a7fa1daab4edf244191f2387a4e472b000100000000000000000737',
  '0x1e2576344d49779bdbb71b1b76193d27e6f996b700020000000000000000032d',
  '0xa10285f445bcb521f1d623300dc4998b02f11c8f00000000000000000000043b',

  // zkevm
  '0x6f34a44fce1506352a171232163e7716dd073ade000200000000000000000015',
  '0xe274c9deb6ed34cfe4130f8d0a8a948dea5bb28600000000000000000000000d',
  /* END:2023-08-mitigation */
];

const fetchAllPools = `query ($count: Int) {
  pools: pools(
    first: $count
    orderBy: totalLiquidity
    orderDirection: desc
    where: {
      and: [
        { 
          or: [
            { isInRecoveryMode: false }
            { isInRecoveryMode: null }
          ]
        },
        {
          totalLiquidity_gt: ${MIN_USD_LIQUIDITY_TO_FETCH.toString()},
          totalShares_not_in: ["0", "0.000000000001"],
          id_not_in: [
            ${disabledPoolIds.map(p => `"${p}"`).join(', ')}
          ],
          address_not_in: [
            "0x0afbd58beca09545e4fb67772faf3858e610bcd0",
            "0x2ff1a9dbdacd55297452cfd8a4d94724bc22a5f7",
            "0xbc0f2372008005471874e426e86ccfae7b4de79d",
            "0xdba274b4d04097b90a72b62467d828cefd708037",
            "0xf22ff21e17157340575158ad7394e068048dd98b",
            "0xf71d0774b214c4cf51e33eb3d30ef98132e4dbaa",
          ],
          swapEnabled: true,
          poolType_in: [
            ${enabledPoolTypes.map(p => `"${p}"`).join(', ')}
          ]
        }
      ]
    }
  ) {
    id
    address
    poolType
    poolTypeVersion
    tokens (orderBy: index) {
      address
      decimals
    }
    mainIndex
    wrappedIndex

    root3Alpha
  }
}`;
// skipping low liquidity composableStablePool (0xbd482ffb3e6e50dc1c437557c3bea2b68f3683ee0000000000000000000003c6) with oracle issues. Experimental.

const fetchWeightUpdating = `query ($count: Int, $timestampPast: Int, $timestampFuture: Int) {
  gradualWeightUpdates(
    first: $count,
    where: {startTimestamp_lt: $timestampFuture, endTimestamp_gt: $timestampPast }
  ) {
    poolId {
      address
    }
  }
}`;

const MAX_POOL_CNT = 1000; // Taken from SOR
const POOL_CACHE_TTL = 60 * 60; // 1 hr
const POOL_EVENT_DISABLED_TTL = 5 * 60; // 5 min
const POOL_EVENT_REENABLE_DELAY = 7 * 24 * 60 * 60; // 1 week

function typecastReadOnlyPoolState(pool: DeepReadonly<PoolState>): PoolState {
  return _.cloneDeep(pool) as PoolState;
}

export class BalancerV2EventPool extends StatefulEventSubscriber<PoolStateMap> {
  public vaultInterface: Interface;

  handlers: {
    [event: string]: (event: any, pool: PoolState, log: Log) => PoolState;
  } = {};

  pools: {
    [type: string]:
      | WeightedPool
      | StablePool
      | LinearPool
      | PhantomStablePool
      | Gyro3Pool
      | GyroEPool;
  };

  public allPools: SubgraphPoolBase[] = [];
  vaultDecoder: (log: Log) => any;

  buySupportedPoolTypes: Set<BalancerPoolTypes> = new Set([
    BalancerPoolTypes.Weighted,
    BalancerPoolTypes.GyroE,
    BalancerPoolTypes.ComposableStable,
  ]);

  eventSupportedPoolTypes: BalancerPoolTypes[] = [
    BalancerPoolTypes.Stable,
    BalancerPoolTypes.Weighted,
    BalancerPoolTypes.LiquidityBootstrapping,
    BalancerPoolTypes.Investment,

    // Need to check if we can support these pools with event base
    // BalancerPoolTypes.ComposableStable,
    // BalancerPoolTypes.Linear,
    // BalancerPoolTypes.MetaStable,
    // BalancerPoolTypes.AaveLinear,
    // BalancerPoolTypes.ERC4626Linear,

    // If this pool is enabled as event supported, it is failing BeetsFi: can not decode getRate()
    // BalancerPoolTypes.StablePhantom,
  ];

  eventRemovedPools = (
    [
      // Gradual weight changes are not currently handled in event system
      // This pool keeps changing weights and is causing pricing issue
      // But should now be handled by eventDisabledPools so don't need here!
      //'0x34809aEDF93066b49F638562c42A9751eDb36DF5',
    ] as Address[]
  ).map(s => s.toLowerCase());

  constructor(
    parentName: string,
    protected network: number,
    public vaultAddress: Address,
    protected subgraphURL: string,
    protected dexHelper: IDexHelper,
    logger: Logger,
  ) {
    super(parentName, vaultAddress, dexHelper, logger);
    this.vaultInterface = new Interface(VaultABI);
    const weightedPool = new WeightedPool(
      this.vaultAddress,
      this.vaultInterface,
    );
    const stablePool = new StablePool(this.vaultAddress, this.vaultInterface);
    const stablePhantomPool = new PhantomStablePool(
      this.vaultAddress,
      this.vaultInterface,
    );
    /*
    ComposableStable has same maths as StablePhantom.
    The main difference is that ComposableStables have join/exit functions when StablePhantom did not.
    The difference of note for swaps is ComposableStable must use 'actualSupply' instead of VirtualSupply.
    VirtualSupply could be calculated easily whereas actualSupply cannot hence the use of onchain call.
    */
    const composableStable = new PhantomStablePool(
      this.vaultAddress,
      this.vaultInterface,
      true,
    );
    const linearPool = new LinearPool(this.vaultAddress, this.vaultInterface);
    const gyro3Pool = new Gyro3Pool(this.vaultAddress, this.vaultInterface);
    const gyroEPool = new GyroEPool(this.vaultAddress, this.vaultInterface);

    this.pools = {};
    this.pools[BalancerPoolTypes.Weighted] = weightedPool;
    this.pools[BalancerPoolTypes.Stable] = stablePool;
    this.pools[BalancerPoolTypes.MetaStable] = stablePool;
    this.pools[BalancerPoolTypes.LiquidityBootstrapping] = weightedPool;
    this.pools[BalancerPoolTypes.Investment] = weightedPool;
    this.pools[BalancerPoolTypes.StablePhantom] = stablePhantomPool;
    this.pools[BalancerPoolTypes.ComposableStable] = composableStable;
    // All these Linear pool have same maths and ABI as AaveLinear but have different factories
    this.pools[BalancerPoolTypes.AaveLinear] = linearPool;
    this.pools[BalancerPoolTypes.ERC4626Linear] = linearPool;
    this.pools[BalancerPoolTypes.GearboxLinear] = linearPool;
    this.pools[BalancerPoolTypes.MidasLinear] = linearPool;
    this.pools[BalancerPoolTypes.ReaperLinear] = linearPool;
    this.pools[BalancerPoolTypes.SiloLinear] = linearPool;
    this.pools[BalancerPoolTypes.TetuLinear] = linearPool;
    this.pools[BalancerPoolTypes.YearnLinear] = linearPool;
    this.pools[BalancerPoolTypes.BeefyLinear] = linearPool;
    // Beets uses "Linear" generically for all linear pool types
    this.pools[BalancerPoolTypes.Linear] = linearPool;

    this.pools[BalancerPoolTypes.Gyro3] = gyro3Pool;
    this.pools[BalancerPoolTypes.GyroE] = gyroEPool;

    this.vaultDecoder = (log: Log) => this.vaultInterface.parseLog(log);
    this.addressesSubscribed = [vaultAddress];

    // Add default handlers
    this.handlers['Swap'] = this.handleSwap.bind(this);
    this.handlers['PoolBalanceChanged'] =
      this.handlePoolBalanceChanged.bind(this);
  }

  protected processLog(
    state: DeepReadonly<PoolStateMap>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolStateMap> | null {
    const _state: PoolStateMap = {};
    for (const [address, pool] of Object.entries(state))
      _state[address] = typecastReadOnlyPoolState(pool);

    try {
      const event = this.vaultDecoder(log);
      if (event.name in this.handlers) {
        const poolAddress = event.args.poolId.slice(0, 42).toLowerCase();
        // Only update the _state if we are tracking the pool
        if (poolAddress in _state) {
          _state[poolAddress] = this.handlers[event.name](
            event,
            _state[poolAddress],
            log,
          );
        }
      }
      return _state;
    } catch (e) {
      this.logger.error(
        `Error_${this.parentName}_processLog could not parse the log with topic ${log.topics}:`,
        e,
      );
      return null;
    }
  }

  async fetchAllSubgraphPools(): Promise<SubgraphPoolBase[]> {
    const cacheKey = 'BalancerV2SubgraphPools2';
    const cachedPools = await this.dexHelper.cache.get(
      this.parentName,
      this.network,
      cacheKey,
    );
    if (cachedPools) {
      const allPools = JSON.parse(cachedPools);
      this.logger.info(
        `Got ${allPools.length} ${this.parentName}_${this.network} pools from cache`,
      );
      return allPools;
    }

    this.logger.info(
      `Fetching ${this.parentName}_${this.network} Pools from subgraph`,
    );

    const variables = {
      count: MAX_POOL_CNT,
    };
    const { data } = await this.dexHelper.httpRequest.querySubgraph(
      this.subgraphURL,
      { query: fetchAllPools, variables },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (!(data && data.pools))
      throw new Error('Unable to fetch pools from the subgraph');

    const poolsMap = keyBy(data.pools, 'address');
    const allPools: SubgraphPoolBase[] = data.pools.map(
      (pool: Omit<SubgraphPoolBase, 'mainTokens'>) => ({
        ...pool,
        mainTokens: poolGetMainTokens(pool, poolsMap),
        tokensMap: pool.tokens.reduce(
          (acc, token) => ({ ...acc, [token.address.toLowerCase()]: token }),
          {},
        ),
      }),
    );

    this.dexHelper.cache.setex(
      this.parentName,
      this.network,
      cacheKey,
      POOL_CACHE_TTL,
      JSON.stringify(allPools),
    );

    this.logger.info(
      `Got ${allPools.length} ${this.parentName}_${this.network} pools from subgraph`,
    );

    return allPools;
  }

  async generateState(blockNumber: number): Promise<Readonly<PoolStateMap>> {
    const allPools = await this.fetchAllSubgraphPools();
    this.allPools = allPools;

    const eventSupportedPools = allPools.filter(
      pool =>
        this.eventSupportedPoolTypes.includes(pool.poolType) &&
        !this.eventRemovedPools.includes(pool.address.toLowerCase()),
    );
    const allPoolsLatestState = await this.getOnChainState(
      eventSupportedPools,
      blockNumber,
    );

    return allPoolsLatestState;
  }

  handleSwap(event: any, pool: PoolState, log: Log): PoolState {
    const tokenIn = event.args.tokenIn.toLowerCase();
    const amountIn = BigInt(event.args.amountIn.toString());
    const tokenOut = event.args.tokenOut.toLowerCase();
    const amountOut = BigInt(event.args.amountOut.toString());
    pool.tokens[tokenIn].balance += amountIn;
    pool.tokens[tokenOut].balance -= amountOut;
    return pool;
  }

  handlePoolBalanceChanged(event: any, pool: PoolState, log: Log): PoolState {
    const tokens = event.args.tokens.map((t: string) => t.toLowerCase());
    const deltas = event.args.deltas.map((d: any) => BigInt(d.toString()));
    const fees = event.args.protocolFeeAmounts.map((d: any) =>
      BigInt(d.toString()),
    ) as bigint[];
    tokens.forEach((t: string, i: number) => {
      const diff = deltas[i] - fees[i];
      pool.tokens[t].balance += diff;
    });
    return pool;
  }

  isSupportedPool(poolType: string): boolean {
    const supportedPoolTypes: string[] = Object.values(BalancerPoolTypes);
    return supportedPoolTypes.includes(poolType);
  }

  getPricesPool(
    from: Token,
    to: Token,
    subgraphPool: SubgraphPoolBase,
    poolState: PoolState,
    amounts: bigint[],
    unitVolume: bigint,
    side: SwapSide,
  ): { unit: bigint; prices: bigint[] } | null {
    if (!this.isSupportedPool(subgraphPool.poolType)) {
      this.logger.error(`Unsupported Pool Type: ${subgraphPool.poolType}`);
      return null;
    }

    if (
      side === SwapSide.BUY &&
      !this.buySupportedPoolTypes.has(subgraphPool.poolType)
    ) {
      return null;
    }

    const amountWithoutZero = amounts.slice(1);
    const pool = this.pools[subgraphPool.poolType];

    const poolPairData = pool.parsePoolPairData(
      subgraphPool,
      poolState,
      from.address,
      to.address,
    );

    const swapMaxAmount = pool.getSwapMaxAmount(
      // Don't like this but don't have time to refactor it properly
      poolPairData as any,
      side,
    );

    const checkedAmounts: bigint[] = new Array(amountWithoutZero.length).fill(
      0n,
    );
    const checkedUnitVolume = pool._nullifyIfMaxAmountExceeded(
      unitVolume,
      swapMaxAmount,
    );

    let nonZeroAmountIndex = 0;
    for (const [i, amountIn] of amountWithoutZero.entries()) {
      const checkedOutput = pool._nullifyIfMaxAmountExceeded(
        amountIn,
        swapMaxAmount,
      );
      if (checkedOutput === 0n) {
        // Stop earlier because other values are bigger and for sure wont' be tradable
        break;
      }
      nonZeroAmountIndex = i + 1;
      checkedAmounts[i] = checkedOutput;
    }

    if (nonZeroAmountIndex === 0) {
      return null;
    }

    const unitResult =
      checkedUnitVolume === 0n
        ? 0n
        : side === SwapSide.SELL
        ? pool.onSell([checkedUnitVolume], poolPairData as any)[0]
        : pool.onBuy([checkedUnitVolume], poolPairData as any)[0];

    const prices: bigint[] = new Array(amounts.length).fill(0n);

    const outputs =
      side === SwapSide.SELL
        ? pool.onSell(
            amountWithoutZero.slice(0, nonZeroAmountIndex),
            poolPairData as any,
          )
        : pool.onBuy(
            amountWithoutZero.slice(0, nonZeroAmountIndex),
            poolPairData as any,
          );

    assert(
      outputs.length <= prices.length,
      `Wrong length logic: outputs.length (${outputs.length}) <= prices.length (${prices.length})`,
    );

    for (const [i, output] of outputs.entries()) {
      // Outputs shifted right to one to keep first entry as 0
      prices[i + 1] = output;
    }

    return { unit: unitResult, prices };
  }

  async getOnChainState(
    subgraphPoolBase: SubgraphPoolBase[],
    blockNumber: number,
  ): Promise<PoolStateMap> {
    const multiCallData = subgraphPoolBase
      .map(pool => {
        if (!this.isSupportedPool(pool.poolType)) return [];

        return this.pools[pool.poolType].getOnChainCalls(pool);
      })
      .flat();

    // 500 is an arbitrary number chosen based on the blockGasLimit
    const slicedMultiCallData = _.chunk(multiCallData, 500);

    const returnData = (
      await Promise.all(
        slicedMultiCallData.map(async _multiCallData =>
          this.dexHelper.multiContract.methods
            .tryAggregate(false, _multiCallData)
            .call({}, blockNumber),
        ),
      )
    ).flat();

    let i = 0;
    const onChainStateMap = subgraphPoolBase.reduce(
      (acc: { [address: string]: PoolState }, pool) => {
        if (!this.isSupportedPool(pool.poolType)) return acc;

        const [decoded, newIndex] = this.pools[
          pool.poolType
        ].decodeOnChainCalls(pool, returnData, i);
        i = newIndex;
        acc = { ...acc, ...decoded };
        return acc;
      },
      {},
    );

    return onChainStateMap;
  }
}

export class BalancerV2
  extends SimpleExchange
  implements
    IDex<
      BalancerV2Data,
      BalancerV2DirectParam | BalancerV2DirectParamV6Swap,
      OptimizedBalancerV2Data
    >
{
  public eventPools: BalancerV2EventPool;

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;
  readonly needWrapNative = true; // temporary

  readonly directSwapIface = new Interface(DirectSwapABI);
  readonly balancerVaultInterface = new Interface(BalancerVaultABI);

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BalancerConfig);

  logger: Logger;

  // In memory pool state for non-event pools
  nonEventPoolStateCache: PoolStateCache;

  eventDisabledPoolsTimer?: NodeJS.Timeout;
  eventDisabledPools: Address[] = [];

  constructor(
    protected network: Network,
    dexKey: string,
    public dexHelper: IDexHelper,
    public vaultAddress: Address = BalancerConfig[dexKey][network].vaultAddress,
    protected subgraphURL: string = BalancerConfig[dexKey][network].subgraphURL,
    protected adapters = Adapters[network],
  ) {
    super(dexHelper, dexKey);
    // Initialise cache - this will hold pool state of non-event pools in memory to be reused if block hasn't expired
    this.nonEventPoolStateCache = { blockNumber: 0, poolState: {} };
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPools = new BalancerV2EventPool(
      dexKey,
      network,
      vaultAddress,
      subgraphURL,
      dexHelper,
      this.logger,
    );
  }

  async setupEventPools(blockNumber: number) {
    await this.eventPools.initialize(blockNumber);
  }

  async fetchEventDisabledPools() {
    const cacheKey = 'eventDisabledPools';
    const poolAddressListFromCache = await this.dexHelper.cache.get(
      this.dexKey,
      this.network,
      cacheKey,
    );
    if (poolAddressListFromCache) {
      this.eventDisabledPools = JSON.parse(poolAddressListFromCache);
      return;
    }
    this.logger.info(
      `Fetching ${this.dexKey}_${this.network} Weight Updates from subgraph`,
    );
    const timeNow = Math.floor(Date.now() / 1000);
    const variables = {
      count: MAX_POOL_CNT,
      timestampPast: timeNow - POOL_EVENT_REENABLE_DELAY,
      timestampFuture: timeNow + POOL_EVENT_DISABLED_TTL,
    };
    const { data } = await this.dexHelper.httpRequest.querySubgraph(
      this.subgraphURL,
      { query: fetchWeightUpdating, variables },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (!(data && data.gradualWeightUpdates)) {
      throw new Error(
        `${this.dexKey}_${this.network} failed to fetch weight updates from subgraph`,
      );
    }

    this.eventDisabledPools = _.uniq(
      data.gradualWeightUpdates.map(
        (wu: { poolId: { address: Address } }) => wu.poolId.address,
      ),
    );
    const poolAddressList = JSON.stringify(this.eventDisabledPools);
    this.logger.info(
      `Pools blocked from event based on ${this.dexKey}_${this.network}: ${poolAddressList}`,
    );
    this.dexHelper.cache.setex(
      this.dexKey,
      this.network,
      cacheKey,
      POOL_EVENT_DISABLED_TTL,
      poolAddressList,
    );
  }

  async initializePricing(blockNumber: number) {
    if (!this.eventDisabledPoolsTimer) {
      await this.fetchEventDisabledPools();
      this.eventDisabledPoolsTimer = setInterval(async () => {
        try {
          await this.fetchEventDisabledPools();
        } catch (e) {
          this.logger.error(
            `${this.dexKey}: Failed to update event disabled pools:`,
            e,
          );
        }
      }, POOL_EVENT_DISABLED_TTL * 1000);
    }
    await this.setupEventPools(blockNumber);
  }

  releaseResources(): void {
    if (this.eventDisabledPoolsTimer) {
      clearInterval(this.eventDisabledPoolsTimer);
      this.eventDisabledPoolsTimer = undefined;
      this.logger.info(
        `${this.dexKey}: cleared eventDisabledPoolsTimer before shutting down`,
      );
    }
  }

  getPoolsWithTokenPair(from: Token, to: Token): SubgraphPoolBase[] {
    const pools = this.eventPools.allPools.filter(p => {
      const fromMain = p.mainTokens.find(
        token => token.address.toLowerCase() === from.address.toLowerCase(),
      );
      const toMain = p.mainTokens.find(
        token => token.address.toLowerCase() === to.address.toLowerCase(),
      );

      return (
        fromMain &&
        toMain &&
        // filter instances similar to the following:
        // USDC -> DAI in a pool where bbaUSD is nested (ie: MAI / bbaUSD)
        !(fromMain.isDeeplyNested && toMain.isDeeplyNested)
      );
    });

    return pools.slice(0, 10);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters?.[side] ? this.adapters[side] : null;
  }

  async getPoolIdentifiers(
    from: Token,
    to: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _from = this.dexHelper.config.wrapETH(from);
    const _to = this.dexHelper.config.wrapETH(to);

    const pools = this.getPoolsWithTokenPair(_from, _to);

    return pools.map(
      ({ address }) => `${this.dexKey}_${address.toLowerCase()}`,
    );
  }

  /**
   * Returns cached poolState if blockNumber matches cached value. Resets if not.
   */
  private getNonEventPoolStateCache(blockNumber: number): PoolStateMap {
    if (this.nonEventPoolStateCache.blockNumber !== blockNumber)
      this.nonEventPoolStateCache.poolState = {};
    return this.nonEventPoolStateCache.poolState;
  }

  /**
   * Update poolState cache.
   * If same blockNumber as current cache then update with new pool state.
   * If different blockNumber overwrite cache with latest.
   */
  private updateNonEventPoolStateCache(
    poolState: PoolStateMap,
    blockNumber: number,
  ): PoolStateMap {
    if (this.nonEventPoolStateCache.blockNumber !== blockNumber) {
      this.nonEventPoolStateCache.blockNumber = blockNumber;
      this.nonEventPoolStateCache.poolState = poolState;
    } else
      this.nonEventPoolStateCache.poolState = {
        ...this.nonEventPoolStateCache.poolState,
        ...poolState,
      };
    return this.nonEventPoolStateCache.poolState;
  }

  async getPricesVolume(
    from: Token,
    to: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<BalancerV2Data>> {
    try {
      const _from = this.dexHelper.config.wrapETH(from);
      const _to = this.dexHelper.config.wrapETH(to);

      if (_from.address === _to.address) {
        return null;
      }

      const allPools = this.getPoolsWithTokenPair(_from, _to);

      const allowedPools = limitPools
        ? allPools.filter(({ address }) =>
            limitPools.includes(`${this.dexKey}_${address.toLowerCase()}`),
          )
        : allPools;

      if (!allowedPools.length) return null;

      const eventPoolStatesRO = await this.eventPools.getState(blockNumber);
      if (!eventPoolStatesRO) {
        this.logger.error(`getState returned null`);
      }
      const eventPoolStates = { ...(eventPoolStatesRO || {}) };

      for (const addr of this.eventDisabledPools) delete eventPoolStates[addr];

      // Fetch previously cached non-event pool states
      let nonEventPoolStates = this.getNonEventPoolStateCache(blockNumber);

      //get all pools that would be used in the paths, nested pools included
      const poolsFlattened = getAllPoolsUsedInPaths(
        _from.address,
        _to.address,
        allowedPools,
        this.poolAddressMap,
        side,
      );

      // Missing pools are pools that don't already exist in event or non-event
      const missingPools = poolsFlattened.filter(
        pool =>
          !(
            pool.address.toLowerCase() in eventPoolStates ||
            pool.address.toLowerCase() in nonEventPoolStates
          ),
      );

      // Retrieve onchain state for any missing pools
      if (missingPools.length > 0) {
        const missingPoolsStateMap = await this.eventPools.getOnChainState(
          missingPools,
          blockNumber,
        );
        // Update non-event pool state cache with newly retrieved data so it can be reused in future
        nonEventPoolStates = this.updateNonEventPoolStateCache(
          missingPoolsStateMap,
          blockNumber,
        );
      }

      const poolPrices = allowedPools
        .map((pool: SubgraphPoolBase) => {
          try {
            const poolAddress = pool.address.toLowerCase();

            const path = poolGetPathForTokenInOut(
              _from.address,
              _to.address,
              pool,
              this.poolAddressMap,
              side,
            );

            let pathAmounts = amounts;
            let resOut: { unit: bigint; prices: bigint[] } | null = null;

            for (let i = 0; i < path.length; i++) {
              const poolAddress = path[i].pool.address.toLowerCase();
              const poolState = (eventPoolStates[poolAddress] ||
                nonEventPoolStates[poolAddress]) as PoolState | undefined;
              if (!poolState) {
                this.logger.error(
                  `Unable to find the poolState ${poolAddress}`,
                );
                return null;
              }

              const unitVolume = getBigIntPow(
                (side === SwapSide.SELL ? path[i].tokenIn : path[i].tokenOut)
                  .decimals,
              );

              const res = this.eventPools.getPricesPool(
                path[i].tokenIn,
                path[i].tokenOut,
                path[i].pool,
                poolState,
                pathAmounts,
                unitVolume,
                side,
              );

              if (!res) {
                return null;
              }

              pathAmounts = res.prices;

              if (i === path.length - 1) {
                resOut = res;
              }
            }

            if (!resOut) {
              return null;
            }

            return {
              unit: resOut.unit,
              prices: resOut.prices,
              data: {
                poolId: pool.id,
              },
              poolAddresses: [poolAddress],
              exchange: this.dexKey,
              gasCost:
                STABLE_GAS_COST + VARIABLE_GAS_COST_PER_CYCLE * path.length,
              poolIdentifier: `${this.dexKey}_${poolAddress}`,
            };

            // TODO: re-check what should be the current block time stamp
          } catch (e) {
            this.logger.warn(
              `Error_getPrices ${from.symbol || from.address}, ${
                to.symbol || to.address
              }, ${side}, ${pool.address}:`,
              e,
            );

            return;
          }
        })
        .filter(p => !!p);
      return poolPrices as ExchangePrices<BalancerV2Data>;
    } catch (e) {
      this.logger.error(
        `Error_getPrices ${from.symbol || from.address}, ${
          to.symbol || to.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<BalancerV2Data>,
  ): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_LARGE +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> assets[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> funds
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.BOOL +
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.BOOL +
      // ParentStruct -> limits[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // ParentStruct -> swaps[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> swaps[0] header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[0] -> poolId
      CALLDATA_GAS_COST.FULL_WORD +
      // ParentStruct -> swaps[0] -> assetInIndex
      CALLDATA_GAS_COST.INDEX +
      // ParentStruct -> swaps[0] -> assetOutIndex
      CALLDATA_GAS_COST.INDEX +
      // ParentStruct -> swaps[0] -> amount
      CALLDATA_GAS_COST.AMOUNT +
      // ParentStruct -> swaps[0] -> userData header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[0] -> userData
      CALLDATA_GAS_COST.ZERO +
      // ParentStruct -> assets[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> assets[0:2]
      CALLDATA_GAS_COST.ADDRESS * 2 +
      // ParentStruct -> limits[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> limits[0:2]
      CALLDATA_GAS_COST.FULL_WORD * 2
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const params = this.getBalancerV2BatchSwapParam(
      srcToken,
      destToken,
      data,
      side,
      this.dexHelper.config.data.augustusAddress!,
      this.dexHelper.config.data.augustusAddress!,
    );

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          'swaps[]': {
            poolId: 'bytes32',
            assetInIndex: 'uint256',
            assetOutIndex: 'uint256',
            amount: 'uint256',
            userData: 'bytes',
          },
          assets: 'address[]',
          funds: {
            sender: 'address',
            fromInternalBalance: 'bool',
            recipient: 'address',
            toInternalBalance: 'bool',
          },
          limits: 'int256[]',
          deadline: 'uint256',
        },
      },
      {
        swaps: params[1],
        assets: params[2],
        funds: params[3],
        limits: params[4],
        deadline: params[5],
      },
    );

    return {
      targetExchange: this.vaultAddress,
      payload,
      networkFee: '0',
    };
  }

  public getBalancerV2SwapParam(
    srcToken: string,
    destToken: string,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
    recipient: string,
    sender: string,
  ): BalancerV2SwapParam {
    assert(data.swaps.length === 1, 'should have exactly one pool');

    const singleSwap: BalancerV2SingleSwap = {
      poolId: data.swaps[0].poolId,
      kind:
        side === SwapSide.SELL ? SwapTypes.SwapExactIn : SwapTypes.SwapExactOut,
      assetIn:
        srcToken.toLowerCase() === ETHER_ADDRESS ? NULL_ADDRESS : srcToken,
      assetOut:
        destToken.toLowerCase() === ETHER_ADDRESS ? NULL_ADDRESS : destToken,
      amount: data.swaps[0].amount,
      userData: '0x',
    };

    const funds = {
      sender,
      recipient,
      fromInternalBalance: false,
      toInternalBalance: false,
    };

    const params: BalancerV2SwapParam = [
      singleSwap,
      funds,
      side === SwapSide.SELL ? '1' : MAX_INT,
      getLocalDeadlineAsFriendlyPlaceholder(),
    ];

    return params;
  }

  /*
      Algorithm to determine balancer (sender, recipient) params:

      if version = 5
          sender = recipient = augustusV5
      else (so V6)
        if direct swap
            sender = recipient = augustusV6
        else (so generic swaps)
          if sell
            if swap.destToken = priceRoute.destToken <> ETH (need withdraw for eth currently, need fix in future)
                  sender = executor and recipient = augustusV6 (skip 1 extra transfer)
              else
                  sender = recipient = executor
              # note: we pass sender=null then the address of the executor is inferred contract side
          else (so buy)
              sender = recipient = executor
*/
  public getBalancerV2BatchSwapParam(
    srcToken: string,
    destToken: string,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
    recipient: string,
    sender: string,
    shouldWalkAssetsBackward?: boolean, // should do for all buy but prefer keep it under control
  ): BalancerV2BatchSwapParam {
    let swapOffset = 0;
    let swaps: BalancerSwap[] = [];
    let assets: string[] = [];
    let limits: string[] = [];

    for (const swapData of data.swaps) {
      const pool = this.poolIdMap[swapData.poolId];
      const hasEth = [srcToken.toLowerCase(), destToken.toLowerCase()].includes(
        ETHER_ADDRESS.toLowerCase(),
      );
      const _srcToken = this.dexHelper.config.wrapETH({
        address: srcToken,
        decimals: 18,
      }).address;
      const _destToken = this.dexHelper.config.wrapETH({
        address: destToken,
        decimals: 18,
      }).address;

      let path = poolGetPathForTokenInOut(
        _srcToken,
        _destToken,
        pool,
        this.poolAddressMap,
        side,
      );

      if (side === SwapSide.BUY) {
        path = path.reverse();
      }

      const _swaps = path.map((hop, index) => {
        const assetInIndex = shouldWalkAssetsBackward
          ? swapOffset + path.length - index
          : swapOffset + index;

        const assetOutIndex = shouldWalkAssetsBackward
          ? swapOffset + path.length - index - 1
          : swapOffset + index + 1;

        const amount =
          (side === SwapSide.SELL && index === 0) ||
          (side === SwapSide.BUY && index === path.length - 1)
            ? swapData.amount
            : '0';

        if (assetInIndex < 0 || assetOutIndex < 0) {
          const error = new Error(`Invalid indices in balancer`);
          this.logger.error(error.message, error);
          throw error;
        }

        return {
          poolId: hop.pool.id,
          assetInIndex,
          assetOutIndex,
          amount,
          userData: '0x',
        };
      });

      swapOffset += path.length + 1;

      // BalancerV2 Uses Address(0) as ETH
      const _assets = [_srcToken, ...path.map(hop => hop.tokenOut.address)].map(
        t => (hasEth && this.dexHelper.config.isWETH(t) ? NULL_ADDRESS : t),
      );

      const _limits = _assets.map(_ => MAX_INT);

      swaps = swaps.concat(_swaps);
      assets = assets.concat(_assets);
      limits = limits.concat(_limits);
    }

    const funds = {
      sender,
      recipient,
      fromInternalBalance: false,
      toInternalBalance: false,
    };

    const params: BalancerV2BatchSwapParam = [
      side === SwapSide.SELL ? SwapTypes.SwapExactIn : SwapTypes.SwapExactOut,
      side === SwapSide.SELL ? swaps : swaps.reverse(),
      shouldWalkAssetsBackward ? assets.reverse() : assets,
      funds,
      limits,
      getLocalDeadlineAsFriendlyPlaceholder(),
    ];

    return params;
  }

  static getDirectFunctionName(): string[] {
    return [DirectMethods.directSell, DirectMethods.directBuy];
  }

  getTokenFromAddress(address: Address): Token {
    // In this Dex decimals are not used
    return { address, decimals: 0 };
  }

  async preProcessTransaction(
    optimalSwapExchange: OptimalSwapExchange<OptimizedBalancerV2Data>,
    srcToken: Token,
    _0: Token,
    _1: SwapSide,
    options: PreprocessTransactionOptions,
  ): Promise<[OptimalSwapExchange<OptimizedBalancerV2Data>, ExchangeTxInfo]> {
    if (!options.isDirectMethod) {
      return [
        optimalSwapExchange,
        {
          deadline: BigInt(getLocalDeadlineAsFriendlyPlaceholder()),
        },
      ];
    }

    assert(
      optimalSwapExchange.data !== undefined,
      `preProcessTransaction: data field is missing`,
    );

    let isApproved: boolean | undefined;

    try {
      isApproved = await this.dexHelper.augustusApprovals.hasApproval(
        options.executionContractAddress,
        this.dexHelper.config.wrapETH(srcToken).address,
        this.vaultAddress,
      );
    } catch (e) {
      this.logger.error(
        `preProcessTransaction failed to retrieve allowance info: `,
        e,
      );
    }

    return [
      {
        ...optimalSwapExchange,
        data: {
          ...optimalSwapExchange.data,
          isApproved,
        },
      },
      {
        deadline: BigInt(getLocalDeadlineAsFriendlyPlaceholder()),
      },
    ];
  }

  getDirectParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    expectedAmount: NumberAsString,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
    permit: string,
    uuid: string,
    feePercent: NumberAsString,
    deadline: NumberAsString,
    partner: string,
    beneficiary: string,
    contractMethod: string,
  ): TxInfo<BalancerV2DirectParam> {
    if (
      contractMethod !== DirectMethods.directSell &&
      contractMethod !== DirectMethods.directBuy
    ) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    let isApproved: boolean = !!data.isApproved;
    if (data.isApproved === undefined) {
      this.logger.warn(`isApproved is undefined, defaulting to false`);
    }

    const [, swaps, assets, funds, limits, _deadline] =
      this.getBalancerV2BatchSwapParam(
        srcToken,
        destToken,
        data,
        side,
        this.dexHelper.config.data.augustusAddress!,
        this.dexHelper.config.data.augustusAddress!,
      );

    const swapParams: BalancerV2DirectParam = [
      swaps,
      assets,
      funds,
      limits,
      srcAmount,
      destAmount,
      expectedAmount,
      _deadline,
      feePercent,
      this.vaultAddress,
      partner,
      isApproved,
      beneficiary,
      permit,
      uuidToBytes16(uuid),
    ];

    const encoder = (...params: BalancerV2DirectParam) => {
      return this.directSwapIface.encodeFunctionData(
        side === SwapSide.SELL
          ? DirectMethods.directSell
          : DirectMethods.directBuy,
        [params],
      );
    };

    return {
      params: swapParams,
      encoder,
      networkFee: '0',
    };
  }

  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ) {
    if (!contractMethod) throw new Error(`contractMethod need to be passed`);

    if (!BalancerV2.getDirectFunctionNameV6().includes(contractMethod!)) {
      throw new Error(`Invalid contract method ${contractMethod}`);
    }

    const metadata = hexConcat([
      hexZeroPad(uuidToBytes16(uuid), 16),
      hexZeroPad(hexlify(blockNumber), 16),
    ]);

    const balancerBatchSwapParam = this.getBalancerV2BatchSwapParam(
      srcToken,
      destToken,
      data,
      side,
      this.dexHelper.config.data.augustusV6Address!,
      this.dexHelper.config.data.augustusV6Address!,
      side === SwapSide.BUY,
    );

    // after getBalancerV2BatchSwapParam runs we may get more swaps so we can't decide on single vs batch before resolving it
    const [, swaps] = balancerBatchSwapParam;
    const isSingleSwap = swaps.length === 1;

    const balancerParams = isSingleSwap
      ? this.getBalancerV2SwapParam(
          srcToken,
          destToken,
          data,
          side,
          this.dexHelper.config.data.augustusV6Address!,
          this.dexHelper.config.data.augustusV6Address!,
        )
      : balancerBatchSwapParam;

    const swapParams: BalancerV2DirectParamV6 = [
      fromAmount,
      toAmount,
      quotedAmount,
      metadata,
      this.encodeBeneficiaryAndApproveFlag(beneficiary, !data.isApproved),
    ];

    const encodeParams: BalancerV2DirectParamV6Swap = [
      swapParams,
      partnerAndFee,
      permit,
      balancerParams.length === 4 // TODO: upgrade ts to use isSingleSwap
        ? this.encodeBalancerV2SwapParam(balancerParams)
        : this.encodeBalancerV2BatchSwapParam(balancerParams),
    ];

    const encoder = (...params: BalancerV2DirectParamV6Swap) => {
      return this.augustusV6Interface.encodeFunctionData(
        side === SwapSide.SELL
          ? DirectMethodsV6.directSell
          : DirectMethodsV6.directBuy,
        [...params],
      );
    };

    return {
      encoder,
      params: encodeParams,
      networkFee: '0',
    };
  }

  private encodeBeneficiaryAndApproveFlag(
    beneficiary: Address,
    approveFlag: boolean,
  ) {
    const addressBN = BigNumber.from(beneficiary);
    const flagBN = approveFlag ? BigNumber.from(1).shl(255) : BigNumber.from(0);

    return addressBN.or(flagBN).toString();
  }

  private encodeBalancerV2SwapParam(param: BalancerV2SwapParam): string {
    const [singleSwap, funds, limit, deadline] = param;

    const encoded = this.balancerVaultInterface.encodeFunctionData('swap', [
      singleSwap,
      funds,
      limit,
      deadline,
    ]);

    return encoded;
  }

  private encodeBalancerV2BatchSwapParam(
    param: BalancerV2BatchSwapParam,
  ): string {
    const [kind, swaps, assets, funds, limits, deadline] = param;

    const encoded = this.balancerVaultInterface.encodeFunctionData(
      'batchSwap',
      [kind, swaps, assets, funds, limits, deadline],
    );
    return encoded;
  }

  static getDirectFunctionNameV6(): string[] {
    return [DirectMethodsV6.directSell, DirectMethodsV6.directBuy];
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const params = this.getBalancerV2BatchSwapParam(
      srcToken,
      destToken,
      data,
      side,
      this.dexHelper.config.data.augustusAddress!,
      this.dexHelper.config.data.augustusAddress!,
    );

    const swapData = this.eventPools.vaultInterface.encodeFunctionData(
      'batchSwap',
      params,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.vaultAddress,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: OptimizedBalancerV2Data,
    side: SwapSide,
    context: Context,
    executor: Address,
  ): DexExchangeParam {
    const balancerBatchSwapParam = this.getBalancerV2BatchSwapParam(
      srcToken,
      destToken,
      data,
      side,
      recipient,
      side === SwapSide.SELL ? NULL_ADDRESS : executor,
    );

    const [, swaps] = balancerBatchSwapParam;
    const isSingleSwap = swaps.length === 1;

    if (isSingleSwap) {
      const balancerSwapParam = this.getBalancerV2SwapParam(
        srcToken,
        destToken,
        data,
        side,
        recipient,
        executor,
      );

      const exchangeData = this.eventPools.vaultInterface.encodeFunctionData(
        'swap',
        balancerSwapParam,
      );

      return {
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: true,
        exchangeData,
        targetExchange: this.vaultAddress,
        returnAmountPos:
          side === SwapSide.SELL
            ? extractReturnAmountPosition(
                this.balancerVaultInterface,
                'swap',
                'amountCalculated',
              )
            : undefined,
      };
    }

    let exchangeData = this.eventPools.vaultInterface.encodeFunctionData(
      'batchSwap',
      balancerBatchSwapParam,
    );
    let specialDexFlag = SpecialDex.DEFAULT;

    if (side === SwapSide.SELL) {
      const totalAmount = swaps.reduce<BigNumber>((acc, swap) => {
        return acc.add(swap.amount);
      }, BigNumber.from(0));

      exchangeData = solidityPack(
        ['bytes32', 'bytes'],
        [hexZeroPad(hexlify(totalAmount), 32), exchangeData],
      );
      specialDexFlag = SpecialDex.SWAP_ON_BALANCER_V2;
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      specialDexFlag,
      targetExchange: this.vaultAddress,
      returnAmountPos: undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    this.eventPools.allPools = await this.eventPools.fetchAllSubgraphPools();
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    count: number,
  ): Promise<PoolLiquidity[]> {
    const poolsWithToken = this.eventPools.allPools.filter(pool =>
      pool.mainTokens.some(mainToken =>
        isSameAddress(mainToken.address, tokenAddress),
      ),
    );

    const variables = {
      poolIds: poolsWithToken.map(pool => pool.id),
      count,
    };

    const query = `query ($poolIds: [String!]!, $count: Int) {
      pools (first: $count, orderBy: totalLiquidity, orderDirection: desc,
        where: {
          and: [
            { 
              or: [
                { isInRecoveryMode: false }
                { isInRecoveryMode: null }
              ]
            },
            {
              id_in: $poolIds,
              swapEnabled: true,
              totalLiquidity_gt: ${MIN_USD_LIQUIDITY_TO_FETCH.toString()}
            }
          ]
      }) {
        address
        totalLiquidity
        tokens {
          address
          decimals
        }
      }
    }`;
    const { data } = await this.dexHelper.httpRequest.querySubgraph<{
      data: {
        pools: {
          address: string;
          totalLiquidity: string;
          tokens: { address: string; decimals: number }[];
        }[];
      };
    }>(
      this.subgraphURL,
      {
        query,
        variables,
      },
      { timeout: SUBGRAPH_TIMEOUT },
    );

    if (!(data && data.pools))
      throw new Error(
        `Error_${this.dexKey}_Subgraph: couldn't fetch the pools from the subgraph`,
      );

    return _.map(data.pools, pool => {
      const subgraphPool = poolsWithToken.find(poolWithToken =>
        isSameAddress(poolWithToken.address, pool.address),
      )!;

      return {
        exchange: this.dexKey,
        address: pool.address.toLowerCase(),
        connectorTokens: subgraphPool.mainTokens.filter(
          token => !isSameAddress(tokenAddress, token.address),
        ),
        liquidityUSD: parseFloat(pool.totalLiquidity),
      };
    });
  }

  private get poolAddressMap(): SubgraphPoolAddressDictionary {
    return keyBy(this.eventPools.allPools, 'address');
  }

  private get poolIdMap(): { [poolId: string]: SubgraphPoolBase } {
    return keyBy(this.eventPools.allPools, 'id');
  }
}
