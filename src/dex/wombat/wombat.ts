import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import { Interface } from '@ethersproject/abi';
import { NumberAsString, SwapSide } from '@paraswap/core';

import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
} from '../../types';
import { Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../idex';
import { IDexHelper } from '../../dex-helper';
import { DexParams, PoolState, WombatData } from './types';
import {
  getLocalDeadlineAsFriendlyPlaceholder,
  SimpleExchange,
} from '../simple-exchange';
import { Adapters, WombatConfig } from './config';
import PoolABI from '../../abi/wombat/pool-v2.json';
import AssetABI from '../../abi/wombat/asset.json';
import ERC20ABI from '../../abi/erc20.json';
import { WombatQuoter } from './wombat-quoter';
import { WombatBmw } from './wombat-bmw';
import { fromWad } from './utils';
import { WombatPool } from './wombat-pool';
import { StatePollingManager } from '../../lib/stateful-rpc-poller/state-polling-manager';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Wombat extends SimpleExchange implements IDex<WombatData> {
  // contract interfaces
  static readonly erc20Interface = new Interface(ERC20ABI);
  static readonly poolInterface = new Interface(PoolABI);
  static readonly assetInterface = new Interface(AssetABI);
  protected pollingManager: StatePollingManager;

  protected config: DexParams;
  protected poolLiquidityUSD?: { [poolAddress: string]: number };
  public bmw: WombatBmw;
  public pools: { [poolAddress: string]: WombatPool } = {};

  readonly isStatePollingDex = true;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: {
    key: string;
    networks: Network[];
  }[] = getDexKeysWithNetwork(WombatConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {}, // TODO: add any additional optional params to support other fork DEXes
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.config = WombatConfig[dexKey][network];
    this.pollingManager = StatePollingManager.getInstance(dexHelper);

    this.bmw = new WombatBmw(
      dexKey,
      this.config.bmwAddress,
      network,
      dexHelper,
      this.logger,
      this.config.bmwAddress,
      this.onAssetAdded.bind(this),
    );
  }

  async init(blockNumber: number) {
    if (!this.bmw.isInitialized) {
      await this.bmw.initialize(blockNumber);
    }
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.init(blockNumber);
    const bmwState = this.bmw.getState(blockNumber);
    if (!bmwState) {
      throw new Error('initializePricing: bmwState still null after init');
    }
  }

  onAssetAdded = async (pool: Address, blockNumber: number): Promise<void> => {
    if (!this.pools[pool]) {
      this.pools[pool] = new WombatPool(
        this.dexKey,
        this.getPoolIdentifier(pool),
        this.network,
        this.dexHelper,
        this.logger,
        pool,
      );
      await this.pools[pool].initialize(blockNumber);
    }
  };

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];
    return (
      await this.findPools(
        this.dexHelper.config.wrapETH(srcToken).address.toLowerCase(),
        this.dexHelper.config.wrapETH(destToken).address.toLowerCase(),
        blockNumber,
      )
    ).map(p => this.getPoolIdentifier(p));
  }

  protected getPoolIdentifier(poolAddress: Address): string {
    return `${this.dexKey}_${poolAddress}`;
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<WombatData>> {
    if (side === SwapSide.BUY) return null; // Buy side not implemented yet
    if (!this.pools) {
      this.logger.error(`Missing pools for ${this.dexKey} in getPricesVolume`);
      return null;
    }
    const srcTokenAddress = this.dexHelper.config
      .wrapETH(srcToken)
      .address.toLowerCase();
    const destTokenAddress = this.dexHelper.config
      .wrapETH(destToken)
      .address.toLowerCase();
    if (srcTokenAddress === destTokenAddress) return null;

    const pools = (
      await this.findPools(srcTokenAddress, destTokenAddress, blockNumber)
    ).filter(
      poolAddress =>
        !limitPools || limitPools.includes(this.getPoolIdentifier(poolAddress)),
    );

    const promises = [];
    for (const poolAddress of pools) {
      let state = await this.pools![poolAddress].getState(blockNumber);
      if (!state) {
        this.logger.warn(
          `State of pool ${poolAddress} is null in getPricesVolume, skipping...`,
        );
        continue;
      }
      const [unit, ...prices] = this.computePrices(
        srcTokenAddress,
        destTokenAddress,
        [getBigIntPow(srcToken.decimals), ...amounts],
        side,
        state,
      );
      promises.push({
        prices,
        unit,
        data: {
          exchange: poolAddress,
        },
        poolAddresses: [poolAddress],
        exchange: this.dexKey,
        /** @todo specify gas cost */
        gasCost: 260 * 1000,
        poolIdentifier: this.getPoolIdentifier(poolAddress),
      });
    }

    return await Promise.all(promises);
  }

  // take PoolState to compute price
  protected computePrices(
    srcTokenAddress: Address,
    destTokenAddress: Address,
    amounts: bigint[],
    side: SwapSide,
    state: DeepReadonly<PoolState>,
  ): bigint[] {
    const srcAsset = state.asset[srcTokenAddress];
    const destAsset = state.asset[destTokenAddress];
    const quoter = new WombatQuoter(state.params);

    return amounts.map(fromAmount => {
      return side === SwapSide.SELL
        ? quoter.getQuote(srcAsset, destAsset, fromAmount)
        : quoter.getQuote(destAsset, srcAsset, -fromAmount);
    });
  }

  protected async findPools(
    srcTokenAddress: Address,
    destTokenAddress: Address,
    blockNumber: number,
  ): Promise<Address[]> {
    const pools: Address[] = [];
    for (const [poolAddress, pool] of Object.entries(this.pools)) {
      const state = await pool.getState(blockNumber);
      if (!state) {
        continue;
      }

      if (
        state &&
        !state.params.paused &&
        state.asset[srcTokenAddress] &&
        state.asset[destTokenAddress]
      ) {
        pools.push(poolAddress);
      }
    }

    return pools;
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<WombatData>): number | number[] {
    // TODO: update if there is any payload in getAdapterParam
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WombatData,
    side: SwapSide,
  ): AdapterExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const { exchange } = data;

    return {
      targetExchange: exchange,
      payload: '0x',
      networkFee: '0',
    };
  }

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  // Hint: this.buildSimpleParamWithoutWETHConversion
  // could be useful
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: WombatData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);
    const { exchange } = data;

    // Encode here the transaction arguments
    const swapData = Wombat.poolInterface.encodeFunctionData('swap', [
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      this.augustusAddress,
      getLocalDeadlineAsFriendlyPlaceholder(),
    ]);

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
    data: WombatData,
    side: SwapSide,
  ): DexExchangeParam {
    if (side === SwapSide.BUY) throw new Error(`Buy not supported`);
    const { exchange } = data;

    // Encode here the transaction arguments
    const swapData = Wombat.poolInterface.encodeFunctionData('swap', [
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      recipient,
      getLocalDeadlineAsFriendlyPlaceholder(),
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos:
        side === SwapSide.SELL
          ? extractReturnAmountPosition(
              Wombat.poolInterface,
              'swap',
              'actualToAmount',
            )
          : undefined,
    };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    // getTopPoolsForToken shouldn't use block manager
    // TODO: update getTopPoolsForToken to work without block manager
    return [];
    // if (!this.poolLiquidityUSD) await this.updatePoolState();
    // tokenAddress = (
    //   isETHAddress(tokenAddress)
    //     ? this.dexHelper.config.data.wrappedNativeTokenAddress
    //     : tokenAddress
    // ).toLowerCase();
    // const pools: string[] = [];
    // const poolStates: { [poolAddress: string]: DeepReadonly<PoolState> } = {};
    // for (const [poolAddress, eventPool] of Object.entries(this.pools)) {
    //   let state = await eventPool.getState();
    //   if (!state) {
    //     this.logger.warn(
    //       `State of ${poolAddress} is null in getTopPoolsForToken, skipping...`,
    //     );
    //     continue;
    //   }
    //   if (
    //     state.value.underlyingAddresses.includes(tokenAddress) &&
    //     this.poolLiquidityUSD![poolAddress]
    //   ) {
    //     poolStates[poolAddress] = state.value;
    //     pools.push(poolAddress);
    //   }
    // }

    // // sort by liquidity
    // pools.sort((a, b) => this.poolLiquidityUSD![b] - this.poolLiquidityUSD![a]);
    // return pools.slice(0, limit).map(poolAddress => ({
    //   exchange: this.dexKey,
    //   address: poolAddress,
    //   // other tokens in the same pool
    //   connectorTokens: poolStates[poolAddress].underlyingAddresses
    //     .filter(t => t !== tokenAddress)
    //     .map(t => ({
    //       decimals: poolStates[poolAddress].asset[t].underlyingTokenDecimals,
    //       address: t,
    //     })),
    //   liquidityUSD: this.poolLiquidityUSD![poolAddress],
    // }));
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {
    // TODO: complete me!
  }
}
