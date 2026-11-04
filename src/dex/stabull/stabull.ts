import { AsyncOrSync } from 'ts-essentials';
import type {
  Address,
  AdapterExchangeParam,
  DexExchangeParam,
  ExchangePrices,
  GetDexParamOptions,
  Logger,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  PoolReserves,
  Token,
} from '../../types';
import { Network, SwapSide } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import type { IDex } from '../idex';
import type { IDexHelper } from '../../dex-helper/idex-helper';
import {
  SimpleExchange,
  getLocalDeadlineAsFriendlyPlaceholder,
} from '../simple-exchange';
import {
  PoolReservesNotReadyError,
  directionalReserves,
} from '../../lib/pools-storage/reserves';
import { extractReturnAmountPosition } from '../../executor/utils';
import { StabullConfig } from './config';
import { poolInterface } from './abi';
import { StabullFactory } from './stabull-factory';
import { StabullEventPool } from './stabull-pool';
import { StabullData } from './types';
import { quoteSell } from './contract-math/math';

const STABULL_GAS_COST = 250_000;

export class Stabull extends SimpleExchange implements IDex<StabullData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;
  static readonly dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(StabullConfig);

  readonly logger: Logger;
  readonly factory: StabullFactory;

  // Create the integration and its factory/pool event subscribers.
  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.factory = new StabullFactory(network, dexKey, dexHelper);
  }

  /** Initializes pricing state; pool tracking can also start via updatePoolState. */
  async initializePricing(blockNumber: number): Promise<void> {
    await this.factory.initialize(blockNumber);
  }

  // This integration builds V6 call data directly and has no V5 adapter.
  getAdapters(_side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // Return enabled pools that contain both tokens for a supported SELL.
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (side !== SwapSide.SELL || !this.factoryReady()) return [];
    const src = srcToken.address.toLowerCase();
    const dest = destToken.address.toLowerCase();
    return [...this.factory.pools.values()]
      .filter(pool => {
        const tokens = pool.poolConfig.tokens.map(token => token.toLowerCase());
        return (
          tokens.includes(src) &&
          tokens.includes(dest) &&
          src !== dest &&
          this.isPoolEnabled(pool)
        );
      })
      .map(pool => this.poolIdentifier(pool.poolConfig.address));
  }

  // Quote from the pool's cached state; this path performs no network reads.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<StabullData>> {
    if (side !== SwapSide.SELL || !this.factoryReady()) return null;
    const src = srcToken.address.toLowerCase();
    const dest = destToken.address.toLowerCase();
    if (src === dest) return null;

    const eligible = [...this.factory.pools.values()].filter(pool => {
      const id = this.poolIdentifier(pool.poolConfig.address);
      const tokens = pool.poolConfig.tokens.map(token => token.toLowerCase());
      return (
        tokens.includes(src) &&
        tokens.includes(dest) &&
        this.isPoolEnabled(pool) &&
        (!limitPools?.length || limitPools.includes(id))
      );
    });
    if (eligible.length === 0) return null;

    const prices: ExchangePrices<StabullData> = [];
    for (const pool of eligible) {
      const state = pool.getState(blockNumber);
      if (!state) continue;
      const inputIndex = pool.poolConfig.tokens.findIndex(
        token => token.toLowerCase() === src,
      );
      if (inputIndex < 0) continue;
      const quoteEach = (amount: bigint): bigint => {
        try {
          return quoteSell(state, inputIndex, amount);
        } catch (_error) {
          // Keep valid sizes usable when a larger requested amount hits a halt.
          return 0n;
        }
      };
      prices.push({
        prices: amounts.map(quoteEach),
        unit: quoteEach(10n ** BigInt(srcToken.decimals)),
        gasCost: STABULL_GAS_COST,
        exchange: this.dexKey,
        data: { pool: pool.poolConfig.address },
        poolAddresses: [pool.poolConfig.address],
        poolIdentifiers: [this.poolIdentifier(pool.poolConfig.address)],
      });
    }
    return prices.length > 0 ? prices : null;
  }

  // Estimate the fixed calldata size of an originSwap call.
  getCalldataGasCost(_poolPrices: PoolPrices<StabullData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.FUNCTION_SELECTOR +
      2 * CALLDATA_GAS_COST.ADDRESS +
      2 * CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.TIMESTAMP
    );
  }

  // V5 adapter encoding is unsupported; V6 uses getDexParam instead.
  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    _data: StabullData,
    _side: SwapSide,
  ): AdapterExchangeParam {
    throw new Error('Stabull: V5 adapters are not supported');
  }

  // Encode the pool's exact-input swap call for Augustus V6.
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    _recipient: Address,
    data: StabullData,
    side: SwapSide,
    _executorAddress: Address,
    options?: GetDexParamOptions,
  ): DexExchangeParam {
    if (side !== SwapSide.SELL) {
      throw new Error('Stabull: only SELL swaps are supported');
    }
    const pool = data.pool;
    const swapData = poolInterface.encodeFunctionData('originSwap', [
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      getLocalDeadlineAsFriendlyPlaceholder(options?.nowTimestampMs),
    ]);
    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: pool,
      returnAmountPos: extractReturnAmountPosition(
        poolInterface,
        'originSwap',
        'amountOut',
      ),
    };
  }

  async updatePoolState(): Promise<void> {
    // Start tracking independently for reserve consumers that skip pricing init.
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();
    await this.factory.initialize(blockNumber);
  }

  // Report both tracked swap directions for the pool tracker.
  async getPoolReserves(): Promise<PoolReserves[]> {
    if (!this.factoryReady()) {
      throw new PoolReservesNotReadyError(
        this.dexKey,
        'factory state is not ready',
      );
    }
    const reserves: PoolReserves[] = [];
    for (const pool of this.factory.pools.values()) {
      if (pool.isInactive() || pool.isInvalid() || !pool.isTracking()) {
        throw new PoolReservesNotReadyError(
          this.dexKey,
          `state tracking is unavailable for ${pool.poolConfig.address}`,
        );
      }
      const state = pool.getStaleState();
      if (!state) {
        throw new PoolReservesNotReadyError(
          this.dexKey,
          `no tracked state for ${pool.poolConfig.address}`,
        );
      }
      if (
        state.frozen ||
        state.emergency ||
        state.globallyFrozen ||
        !state.tokens.every(token => token.answer > 0n && token.updatedAt > 0n)
      ) {
        continue;
      }
      const [token0, token1] = state.tokens;
      reserves.push({
        dex: this.dexKey,
        id: pool.poolConfig.address.toLowerCase(),
        address: pool.poolConfig.address,
        reserves: directionalReserves([
          {
            src: token0.address,
            dest: token1.address,
            capacity: token1.balance,
          },
          {
            src: token1.address,
            dest: token0.address,
            capacity: token0.balance,
          },
        ]),
      });
    }
    return reserves;
  }

  // Rank tracked pools by the USD value of the opposite token balance.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.factoryReady()) return [];
    const token = tokenAddress.toLowerCase();
    const pools: PoolLiquidity[] = [];
    for (const pool of this.factory.pools.values()) {
      if (!this.isPoolEnabled(pool)) continue;
      const state = pool.getStaleState();
      if (!state) continue;
      const index = state.tokens.findIndex(
        poolToken => poolToken.address.toLowerCase() === token,
      );
      if (index < 0) continue;
      const connector = state.tokens[1 - index];
      const liquidityUSD = await this.dexHelper.getTokenUSDPrice(
        connector,
        connector.balance,
      );
      pools.push({
        poolIdentifier: this.poolIdentifier(pool.poolConfig.address),
        exchange: this.dexKey,
        address: pool.poolConfig.address,
        connectorTokens: [
          { address: connector.address, decimals: connector.decimals },
        ],
        liquidityUSD: Number.isFinite(liquidityUSD) ? liquidityUSD : 0,
      });
    }
    return pools
      .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
      .slice(0, limit);
  }

  // Stop the factory and all pool subscribers during service shutdown.
  releaseResources(): AsyncOrSync<void> {
    return this.factory.releaseResources();
  }

  // Keep pool identifiers stable and unique across DEX integrations.
  private poolIdentifier(address: string): string {
    return `${this.dexKey}_${address.toLowerCase()}`;
  }

  // Prevent stale registry entries from being used while recovery is pending.
  private factoryReady(): boolean {
    return (
      this.factory.isInitialized &&
      !this.factory.isInvalid() &&
      !this.factory.isInactive()
    );
  }

  // Require live tracking, valid oracle values, and no protocol halt flags.
  private isPoolEnabled(pool: StabullEventPool): boolean {
    if (pool.isInactive() || pool.isInvalid() || !pool.isTracking())
      return false;
    const state = pool.getStaleState();
    return Boolean(
      state &&
        !state.frozen &&
        !state.emergency &&
        !state.globallyFrozen &&
        state.tokens.every(token => token.answer > 0n && token.updatedAt > 0n),
    );
  }
}
