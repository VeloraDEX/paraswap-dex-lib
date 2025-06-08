import { Interface } from 'ethers';
import { DeepReadonly } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import nervePoolABIDefault from '../../abi/nerve/nerve-pool.json';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  NerveData,
  PoolState,
  DexParams,
  EventPoolMappings,
  OptimizedNerveData,
  NervePoolFunctions,
  NervePoolSwapParams,
  NervePoolConfig,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import { NerveConfig, Adapters, NERVE_GAS_COST } from './config';
import { NerveEventPool } from './nerve-pool';
import _ from 'lodash';
import { bigIntify } from './utils';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Nerve
  extends SimpleExchange
  implements IDex<NerveData, DexParams, OptimizedNerveData>
{
  protected eventPools: EventPoolMappings = {};

  readonly hasConstantPriceLargeAmounts = false;
  readonly isFeeOnTransferSupported = false;

  readonly minConversionRate = '1';

  public static dexKeysWithNetwork: {
    key: string;
    networks: Network[];
  }[] = getDexKeysWithNetwork(NerveConfig);

  logger: Logger;

  static getIdentifier(dexKey: string, poolAddress: string) {
    return `${dexKey.toLowerCase()}_${poolAddress.toLowerCase()}`;
  }

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
    protected poolConfigs = NerveConfig[dexKey][network].poolConfigs,
    protected nervePoolIface = new Interface(nervePoolABIDefault),
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
  }

  get allPools() {
    return Object.values(this.eventPools);
  }

  async setupEventPool(
    poolConfig: NervePoolConfig,
    blockNumber: number,
    subscribe = true,
  ) {
    const poolIdentifier = Nerve.getIdentifier(this.dexKey, poolConfig.address);

    if (!poolConfig.isMetapool) {
      const newPool = new NerveEventPool(
        this.dexKey,
        this.network,
        this.dexHelper,
        this.logger,
        poolConfig.name,
      );
      this.eventPools[poolIdentifier] = newPool;

      if (subscribe) {
        // Generate first state for the blockNumber and subscribe to logs
        await newPool.initialize(blockNumber);
      } else {
        const state = await newPool.generateState(blockNumber);
        newPool.setState(state, blockNumber);
      }
    } else {
      this.logger.warn(
        `We don't support metapools for Nerve. Check config: ${poolConfig.name}`,
      );
      // No need to throw because we want to initialize other pools
    }
  }

  async initializePricing(blockNumber: number) {
    await Promise.all(
      Object.values(this.poolConfigs).map(
        async poolConfig => await this.setupEventPool(poolConfig, blockNumber),
      ),
    );
  }

  async updatePoolState(): Promise<void> {
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();

    await Promise.all(
      Object.values(this.poolConfigs).map(
        async poolConfig => await this.updateEventPool(poolConfig, blockNumber),
      ),
    );
  }

  async updateEventPool(poolConfig: NervePoolConfig, blockNumber: number) {
    const poolIdentifier = Nerve.getIdentifier(this.dexKey, poolConfig.address);

    if (this.eventPools[poolIdentifier]) {
      const state = await this.eventPools[poolIdentifier].generateState(
        blockNumber,
      );
      this.eventPools[poolIdentifier].setState(state, blockNumber);
    } else {
      await this.setupEventPool(poolConfig, blockNumber, false);
    }
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] || null;
  }

  async getStates(
    pools?: NerveEventPool[],
    // null means to get states for the latest `updated` block
    // and update to latest `on-chain` block in case state is invalid
    blockNumber?: number | null,
  ): Promise<DeepReadonly<{ state: PoolState; pool: NerveEventPool }[]>> {
    const _pools = pools === undefined ? this.allPools : pools;

    const _blockNumber =
      blockNumber === undefined || blockNumber === null
        ? await this.dexHelper.web3Provider.eth.getBlockNumber()
        : blockNumber;

    // TODO: Need to batch this RPC calls in one multicall
    return Promise.all(
      _pools.map(async eventPool => {
        let state = eventPool.getState(blockNumber === null ? 0 : _blockNumber);
        if (!state || !state.isValid) {
          this.logger.info(
            `State for ${this.dexKey} pool ${eventPool.name} on ${this.network} is stale or invalid on block ${_blockNumber}. Generating new one`,
          );
          const newState = await eventPool.generateState(_blockNumber);
          eventPool.setState(newState, _blockNumber);
          return { state: newState, pool: eventPool };
        } else {
          return { state, pool: eventPool };
        }
      }),
    );
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    return this.allPools
      .filter(pool => {
        return (
          pool.tokenAddresses.includes(_srcToken.address.toLowerCase()) &&
          pool.tokenAddresses.includes(_destToken.address.toLowerCase())
        );
      })
      .map(pool => Nerve.getIdentifier(this.dexKey, pool.address));
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<NerveData>> {
    try {
      if (side === SwapSide.BUY) return null;

      const _srcToken = this.dexHelper.config.wrapETH(srcToken);
      const _destToken = this.dexHelper.config.wrapETH(destToken);

      if (
        _srcToken.address.toLowerCase() === _destToken.address.toLowerCase()
      ) {
        return null;
      }

      const filterPoolsByIdentifiers = (
        identifiers: string[],
        pools: NerveEventPool[],
      ) => {
        return pools.filter(pool =>
          identifiers.includes(Nerve.getIdentifier(this.dexKey, pool.address)),
        );
      };

      const selectedPools = !limitPools
        ? filterPoolsByIdentifiers(
            await this.getPoolIdentifiers(
              _srcToken,
              _destToken,
              side,
              blockNumber,
            ),
            this.allPools,
          )
        : filterPoolsByIdentifiers(limitPools, this.allPools);

      const statePoolPair = await this.getStates(selectedPools, blockNumber);

      // here side === SwapSide.SELL
      const unitVolume = getBigIntPow(_srcToken.decimals);

      const _amounts = [unitVolume, ...amounts.slice(1)];

      const result: ExchangePrices<NerveData> = [];
      for (const { pool, state } of statePoolPair) {
        if (state.paused) {
          continue;
        }

        const srcIndex = pool.tokens.findIndex(
          token =>
            token.address.toLowerCase() === _srcToken.address.toLowerCase(),
        );
        const destIndex = pool.tokens.findIndex(
          token =>
            token.address.toLowerCase() === _destToken.address.toLowerCase(),
        );

        if (srcIndex === -1 || destIndex === -1) {
          continue;
        }

        const _prices: bigint[] = [];
        for (const _amount of _amounts) {
          try {
            const out = pool.math.calculateSwap(
              state,
              srcIndex,
              destIndex,
              _amount,
              // Actually we need here block timestamp, but +- 15 seconds shouldn't
              // affect the calculations
              bigIntify((Date.now() / 1000).toFixed(0)),
            );
            _prices.push(out.dy);
          } catch (e) {
            // Something unexpected happen, so set invalidated state.
            // Later it will be regenerated
            pool.setState({ ...state, isValid: false }, blockNumber);
            this.logger.error(
              `${this.dexKey} protocol ${pool.name} (${pool.address}) pool can not calculate out swap for amount ${_amount}`,
              e,
            );
            return null;
          }
        }

        const unit = _prices[0];

        result.push({
          unit,
          prices: [0n, ..._prices.slice(1)],
          data: {
            i: srcIndex.toString(),
            j: destIndex.toString(),
            exchange: pool.address,
            deadline: (Math.floor(Date.now() / 1000) + 10 * 60).toString(),
          },
          poolIdentifier: Nerve.getIdentifier(this.dexKey, pool.address),
          exchange: this.dexKey,
          gasCost: NERVE_GAS_COST,
          poolAddresses: [pool.address],
        });
      }
      return result;
    } catch (e) {
      if (blockNumber === 0)
        this.logger.error(
          `Error_getPricesVolume: Aurelius block manager not yet instantiated`,
        );
      this.logger.error(`Error_getPrices:`, e);
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<NerveData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      CALLDATA_GAS_COST.INDEX +
      CALLDATA_GAS_COST.INDEX +
      CALLDATA_GAS_COST.TIMESTAMP
    );
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OptimizedNerveData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { i, j, deadline } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          i: 'int128',
          j: 'int128',
          deadline: 'uint256',
        },
      },
      { i, j, deadline },
    );
    return {
      targetExchange: data.exchange,
      payload,
      networkFee: '0',
    };
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OptimizedNerveData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, deadline } = data;

    const swapFunctionParam: NervePoolSwapParams = [
      i,
      j,
      srcAmount,
      this.minConversionRate,
      deadline,
    ];

    const swapData = this.nervePoolIface.encodeFunctionData(
      NervePoolFunctions.swap,
      swapFunctionParam,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: OptimizedNerveData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange, i, j, deadline } = data;

    const swapFunctionParam: NervePoolSwapParams = [
      i,
      j,
      srcAmount,
      this.minConversionRate,
      deadline,
    ];

    const swapData = this.nervePoolIface.encodeFunctionData(
      NervePoolFunctions.swap,
      swapFunctionParam,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              this.nervePoolIface,
              NervePoolFunctions.swap,
            )
          : undefined,
    };
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // We set decimals to default as we don't really care of actual number.
    // We use here only address
    const wrappedTokenAddress = this.dexHelper.config.wrapETH({
      address: tokenAddress,
      decimals: 18,
    });

    const selectedPools = this.allPools.filter(pool =>
      pool.tokenAddresses.includes(wrappedTokenAddress.address),
    );

    return Promise.all(
      // As the state is readonly we spread it to receive a copy,
      // It is not a deep copy, so we shouldn't alter the nested objects
      // get the latest state, block number doesn't matter as we update states with updatePoolState
      [...(await this.getStates(selectedPools, null))]
        .sort((a, b) => {
          const diff = b.state.lpToken_supply - a.state.lpToken_supply;
          if (diff === 0n) {
            return 0;
          } else if (diff.toString().startsWith('-')) {
            return -1;
          } else {
            return 1;
          }
        })
        .slice(0, limit)
        .map(async ({ state, pool }) => {
          const normalisedBalances = pool.math._xp(state);
          const totalLiquidity = normalisedBalances.reduce(
            (prev, acc) => prev + acc,
            0n,
          );

          let priceInUSD = 0;
          if (pool.poolConfig.isUSDPool) {
            // We force here precision to be 0
            priceInUSD = Number(
              totalLiquidity /
                bigIntify(10) ** pool.math.POOL_PRECISION_DECIMALS,
            );
          } else {
            priceInUSD = await this.dexHelper.getTokenUSDPrice(
              {
                // I assume that the first indexed token is the most popular
                address: pool.tokens[0].address,
                decimals: Number(pool.math.POOL_PRECISION_DECIMALS),
              },
              totalLiquidity,
            );
          }

          return {
            exchange: this.dexKey,
            address: pool.address,
            connectorTokens: _(pool.tokens)
              .uniqBy('address')
              .filter(
                token =>
                  token.address.toLowerCase() !==
                  wrappedTokenAddress.address.toLowerCase(),
              )
              .value(),
            liquidityUSD: priceInUSD,
          };
        }),
    );
  }
}
