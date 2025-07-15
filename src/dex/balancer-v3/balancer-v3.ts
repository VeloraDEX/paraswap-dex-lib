import { AsyncOrSync, DeepReadonly } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { BalancerV3Data, PoolState, PoolStateMap } from './types';
import { SimpleExchange } from '../simple-exchange';
import { BalancerV3Config } from './config';
import { BalancerV3EventPool } from './balancer-v3-pool';
import { NumberAsString } from '@paraswap/core';
import { SwapKind } from '@balancer-labs/balancer-maths';
import { Interface } from '@ethersproject/abi';
import { extractReturnAmountPosition } from '../../executor/utils';
import { getTopPoolsApi } from './getTopPoolsApi';
import balancerRouterAbi from '../../abi/balancer-v3/router.json';
import balancerBatchRouterAbi from '../../abi/balancer-v3/batch-router.json';
import { getGasCost } from './getGasCost';
import { Block } from '@ethersproject/abstract-provider';
import { BalancerEventHook } from './hooks/balancer-hook-event-subscriber';
import { removeCircularStepPairs } from './utils';

const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const POOL_UPDATE_TTL = 1 * 60; // 1min
const RATE_UPDATE_TTL = 1 * 60; // 1min
const HOOK_UPDATE_TTL = 5 * 60; // 5min

type DeepMutable<T> = {
  -readonly [P in keyof T]: T[P] extends object ? DeepMutable<T[P]> : T[P];
};

export class BalancerV3 extends SimpleExchange implements IDex<BalancerV3Data> {
  protected eventPools: BalancerV3EventPool;
  protected eventHooks: BalancerEventHook;

  readonly hasConstantPriceLargeAmounts = false;
  // Vault can handle native
  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BalancerV3Config);

  logger: Logger;
  balancerRouter: Interface;
  balancerBatchRouter: Interface;
  updateNewPoolsTimer?: NodeJS.Timeout;
  updateRatesTimer?: NodeJS.Timeout;
  updateHooksTimer?: NodeJS.Timeout;

  latestBlock?: Block;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventHooks = new BalancerEventHook(
      dexKey,
      network,
      dexHelper,
      this.logger,
    );
    this.eventPools = new BalancerV3EventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
    );
    this.balancerRouter = new Interface(balancerRouterAbi);
    this.balancerBatchRouter = new Interface(balancerBatchRouterAbi);
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.eventHooks.initialize(blockNumber);
    this.eventPools.setHooksConfigMap(this.eventHooks.hooksConfigMap);
    await this.eventPools.initialize(blockNumber);

    // This will periodically query API and add any new pools to pool state
    if (!this.updateNewPoolsTimer) {
      this.updateNewPoolsTimer = setInterval(async () => {
        try {
          await this.updatePoolState();
        } catch (e) {
          this.logger.error(`${this.dexKey}: Failed to update pool state:`, e);
        }
      }, POOL_UPDATE_TTL * 1000);
    }

    // This will periodically refresh tokenRates with onchain state
    if (!this.updateRatesTimer) {
      this.updateRatesTimer = setInterval(async () => {
        try {
          await this.updateStatePoolRates();
        } catch (e) {
          this.logger.error(`${this.dexKey}: Failed to update pool rates:`, e);
        }
      }, RATE_UPDATE_TTL * 1000);
    }

    // This will periodically update any hook state that can't be tracked by events
    if (!this.updateHooksTimer) {
      this.updateHooksTimer = setInterval(async () => {
        try {
          await this.updateHooksState();
        } catch (e) {
          this.logger.error(`${this.dexKey}: Failed to update hook state:`, e);
        }
      }, HOOK_UPDATE_TTL * 1000);
    }
  }

  getAdapters(side: SwapSide): null {
    return null;
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
    const _from = this.dexHelper.config.wrapETH(srcToken);
    const _to = this.dexHelper.config.wrapETH(destToken);
    const poolState = this.eventPools.getState(blockNumber);
    if (poolState === null) return [];
    return this.findPoolAddressesWithTokens(
      poolState,
      _from.address.toLowerCase(),
      _to.address.toLowerCase(),
    );
  }

  async getBlock(blockNumber: number): Promise<Block> {
    if (this.latestBlock && this.latestBlock.number === blockNumber) {
      return this.latestBlock;
    }

    const block = await this.dexHelper.provider.getBlock(blockNumber);
    this.latestBlock = block;
    return block;
  }

  findPoolAddressesWithTokens(
    pools: DeepReadonly<PoolStateMap>,
    tokenA: string,
    tokenB: string,
  ): string[] {
    return Object.entries(pools)
      .filter(([, poolState]) => {
        return this.hasTokens(poolState, [tokenA, tokenB]);
      })
      .map(([address]) => address);
  }

  /**
   * Filter pools that have tokens from/to and are in limitPool list
   * @param pools
   * @param from
   * @param to
   * @param limitPools
   * @returns Array of PoolState
   */
  filterPools(
    pools: DeepReadonly<PoolStateMap>,
    from: string,
    to: string,
    limitPools?: string[],
  ): PoolState[] {
    return Object.entries(pools)
      .filter(([address, poolState]) => {
        const hasRequiredTokens = this.hasTokens(poolState, [from, to]);
        const isAllowedPool = !limitPools || limitPools.includes(address);
        return hasRequiredTokens && isAllowedPool;
      })
      .map(([_, poolState]) => poolState as DeepMutable<typeof poolState>);
  }

  hasTokens(pool: DeepReadonly<PoolState>, tokens: string[]): boolean {
    return tokens.every(
      token =>
        pool.tokens.includes(token) || pool.tokensUnderlying.includes(token),
    );
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
  ): Promise<null | ExchangePrices<BalancerV3Data>> {
    try {
      const _from = this.dexHelper.config.wrapETH(srcToken);
      const _to = this.dexHelper.config.wrapETH(destToken);
      if (_from.address === _to.address) {
        return null;
      }

      // This is used to get block timestamp which is needed to calculate Amp if it is updating
      const block = await this.getBlock(blockNumber);

      // get up to date pools and state
      const allPoolState = this.eventPools.getState(blockNumber);
      if (allPoolState === null) {
        this.logger.error(`getState returned null`);
        return null;
      }

      // filter for pools with tokens and to only use limit pools
      const allowedPools = this.filterPools(
        allPoolState,
        _from.address.toLowerCase(),
        _to.address.toLowerCase(),
        limitPools,
      );

      if (!allowedPools.length) return null;

      const swapKind =
        side === SwapSide.SELL ? SwapKind.GivenIn : SwapKind.GivenOut;
      const tokenIn = _from.address;
      const tokenOut = _to.address;

      // Gets the single unit amount based off token decimals, e.g. for USDC its 1e6
      const unitAmount = getBigIntPow(
        (side === SwapSide.SELL ? _from : _to).decimals,
      );

      const poolPrices: ExchangePrices<BalancerV3Data> = [];
      // For each pool we calculate swap result using balancer maths
      for (let i = 0; i < allowedPools.length; i++) {
        const pool = {
          ...allowedPools[i],
        };

        const tokenInInfo = this.eventPools.getTokenInfo(pool, tokenIn);
        const tokenOutInfo = this.eventPools.getTokenInfo(pool, tokenOut);
        if (!tokenInInfo || !tokenOutInfo) {
          continue;
        }

        const steps = this.eventPools.getSteps(pool, tokenInInfo, tokenOutInfo);

        try {
          // This is the max amount the pool can swap
          const maxSwapAmount = this.eventPools.getMaxSwapAmount(
            pool,
            tokenInInfo,
            tokenOutInfo,
            swapKind,
            block.timestamp,
          );

          let unit = 0n;
          if (unitAmount < maxSwapAmount)
            unit = this.eventPools.getSwapResult(
              steps,
              unitAmount,
              swapKind,
              block.timestamp,
              this.eventHooks.getState(blockNumber) || {},
            );

          const poolExchangePrice: PoolPrices<BalancerV3Data> = {
            prices: new Array(amounts.length).fill(0n),
            unit,
            data: {
              steps: steps,
            },
            exchange: this.dexKey,
            gasCost: getGasCost(steps),
            poolAddresses: [pool.poolAddress],
            poolIdentifier: `${this.dexKey}_${pool.poolAddress}`,
          };

          for (let j = 0; j < amounts.length; j++) {
            if (amounts[j] < maxSwapAmount) {
              // Uses balancer maths to calculate swap
              poolExchangePrice.prices[j] = this.eventPools.getSwapResult(
                steps,
                amounts[j],
                swapKind,
                block.timestamp,
                this.eventHooks.getState(blockNumber) || {},
              );
            }
          }
          poolPrices.push(poolExchangePrice);
        } catch (err) {
          const errorMessage =
            err instanceof Error ? `error: ${err.message}` : `error: ${err}`;
          const stack = err instanceof Error ? err.stack : '';
          // Ignore some sort of errors
          // minimum trade amount - https://github.com/balancer/balancer-maths/blob/main/typescript/src/vault/vault.ts#L39
          // wrapAmountTooSmall - https://github.com/balancer/balancer-maths/blob/main/typescript/src/buffer/erc4626BufferWrapOrUnwrap.ts#L17
          if (
            !errorMessage.includes('TradeAmountTooSmall') &&
            !errorMessage.includes('wrapAmountTooSmall')
          ) {
            this.logger.error(
              `error fetching prices for pool: ${pool.poolAddress}, msg: ${errorMessage}, stack: ${stack}`,
            );
          }
        }
      }

      return poolPrices;
    } catch (err) {}
    return null;
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<BalancerV3Data>,
  ): number | number[] {
    if (
      poolPrices.data.steps.length === 1 &&
      !poolPrices.data.steps[0].isBuffer
    ) {
      return (
        CALLDATA_GAS_COST.DEX_OVERHEAD +
        // pool
        CALLDATA_GAS_COST.ADDRESS +
        // tokenIn
        CALLDATA_GAS_COST.ADDRESS +
        // tokenOut
        CALLDATA_GAS_COST.ADDRESS +
        // exactAmountOut
        CALLDATA_GAS_COST.AMOUNT +
        // maxAmountIn
        CALLDATA_GAS_COST.AMOUNT +
        // deadline
        CALLDATA_GAS_COST.TIMESTAMP +
        // wethIsEth
        CALLDATA_GAS_COST.BOOL +
        // userData
        CALLDATA_GAS_COST.FULL_WORD
      );
    }

    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_LARGE +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> paths[] header
      CALLDATA_GAS_COST.OFFSET_LARGE +
      // ParentStruct -> paths[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> paths header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> paths -> exactAmountIn
      CALLDATA_GAS_COST.AMOUNT +
      // ParentStruct -> paths -> minAmountOut
      CALLDATA_GAS_COST.AMOUNT +
      // ParentStruct -> paths -> tokenIn
      CALLDATA_GAS_COST.ADDRESS +
      poolPrices.data.steps.reduce(step => {
        return (
          // ParentStruct -> paths -> step header
          CALLDATA_GAS_COST.OFFSET_SMALL +
          // ParentStruct -> paths -> step -> isBuffer
          CALLDATA_GAS_COST.BOOL +
          // ParentStruct -> paths -> step -> pool
          CALLDATA_GAS_COST.ADDRESS +
          // ParentStruct -> paths -> step -> tokenOut
          CALLDATA_GAS_COST.ADDRESS
        );
      }, 0) +
      // deadline
      CALLDATA_GAS_COST.TIMESTAMP +
      // wethIsEth
      CALLDATA_GAS_COST.BOOL +
      // userData
      CALLDATA_GAS_COST.FULL_WORD
    );
  }

  // Not used for V6
  getAdapterParam(): AdapterExchangeParam {
    return {
      targetExchange: '0x',
      payload: '0x',
      networkFee: '0',
    };
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: BalancerV3Data,
    side: SwapSide,
  ): DexExchangeParam {
    const steps = removeCircularStepPairs(data.steps);
    if (steps.length === 0) {
      this.logger.error(`${this.dexKey}: getDexParam: no steps`);
    }

    if (side === SwapSide.SELL) {
      return this.getExactInParam(srcToken, destToken, srcAmount, {
        ...data,
        steps,
      });
    } else {
      return this.getExactOutParam(srcToken, destToken, srcAmount, destAmount, {
        ...data,
        steps,
      });
    }
  }

  getExactInParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    data: BalancerV3Data,
  ): DexExchangeParam {
    if (data.steps.length === 1 && !data.steps[0].isBuffer) {
      const exchangeData = this.balancerRouter.encodeFunctionData(
        'swapSingleTokenExactIn',
        [
          data.steps[0].pool,
          this.dexHelper.config.wrapETH(srcToken),
          this.dexHelper.config.wrapETH(destToken),
          srcAmount,
          '0', // This should be limit for min amount out. Assume this is set elsewhere via Paraswap contract.
          MAX_UINT256, // Deadline
          isETHAddress(srcToken) || isETHAddress(destToken),
          '0x',
        ],
      );
      return {
        sendEthButSupportsInsertFromAmount: true,
        permit2Approval: true,
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: false,
        exchangeData,
        // This router handles single swaps
        targetExchange:
          BalancerV3Config.BalancerV3[this.network].balancerRouterAddress,
        returnAmountPos: extractReturnAmountPosition(
          this.balancerRouter,
          'swapSingleTokenExactIn',
        ),
      };
    } else {
      // for each step:
      // if tokenIn == pool router uses removeLiquidity SINGLE_TOKEN_EXACT_IN
      // if tokenOut == pool router uses addLiquidity UNBALANCED
      const exchangeData = this.balancerBatchRouter.encodeFunctionData(
        'swapExactIn',
        [
          [
            {
              tokenIn: this.dexHelper.config.wrapETH(srcToken),
              steps: data.steps.map(step => ({
                pool: step.pool,
                tokenOut: step.swapInput.tokenOut,
                isBuffer: step.isBuffer,
              })),
              exactAmountIn: srcAmount,
              minAmountOut: '0', // This should be limit for min amount out. Assume this is set elsewhere via Paraswap contract.
            },
          ],
          MAX_UINT256, // Deadline
          isETHAddress(srcToken) || isETHAddress(destToken),
          '0x',
        ],
      );

      return {
        sendEthButSupportsInsertFromAmount: true,
        permit2Approval: true,
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: false,
        exchangeData,
        // This router handles batch swaps
        targetExchange:
          BalancerV3Config.BalancerV3[this.network].balancerBatchRouterAddress,
        returnAmountPos: undefined,
      };
    }
  }

  getExactOutParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: BalancerV3Data,
  ): DexExchangeParam {
    if (data.steps.length === 1 && !data.steps[0].isBuffer) {
      const exchangeData = this.balancerRouter.encodeFunctionData(
        'swapSingleTokenExactOut',
        [
          data.steps[0].pool,
          this.dexHelper.config.wrapETH(srcToken),
          this.dexHelper.config.wrapETH(destToken),
          destAmount,
          MAX_UINT256, // This should be limit for max amount in. Assume this is set elsewhere via Paraswap contract.
          MAX_UINT256, // Deadline
          isETHAddress(srcToken) || isETHAddress(destToken),
          '0x',
        ],
      );

      return {
        sendEthButSupportsInsertFromAmount: true,
        permit2Approval: true,
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: false,
        exchangeData,
        // Single swaps are submitted via Balancer Router
        targetExchange:
          BalancerV3Config.BalancerV3[this.network].balancerRouterAddress,
        returnAmountPos: undefined,
      };
    } else {
      // for each step:
      // if tokenIn == pool use removeLiquidity SINGLE_TOKEN_EXACT_OUT
      // if tokenOut == pool use addLiquidity SINGLE_TOKEN_EXACT_OUT
      const exchangeData = this.balancerBatchRouter.encodeFunctionData(
        'swapExactOut',
        [
          [
            {
              tokenIn: this.dexHelper.config.wrapETH(srcToken),
              steps: data.steps.map(step => ({
                pool: step.pool,
                tokenOut: step.swapInput.tokenOut,
                isBuffer: step.isBuffer,
              })),
              exactAmountOut: destAmount,
              maxAmountIn: srcAmount,
            },
          ],
          MAX_UINT256, // Deadline
          isETHAddress(srcToken) || isETHAddress(destToken),
          '0x',
        ],
      );

      return {
        sendEthButSupportsInsertFromAmount: true,
        permit2Approval: true,
        needWrapNative: this.needWrapNative,
        dexFuncHasRecipient: false,
        exchangeData,
        // This router handles batch swaps
        targetExchange:
          BalancerV3Config.BalancerV3[this.network].balancerBatchRouterAddress,
        returnAmountPos: undefined,
      };
    }
  }

  /**
   * Uses multicall to get onchain token rate for each pool then updates pool state
   */
  async updateStatePoolRates(): Promise<void> {
    await this.eventPools.updateStatePoolRates();
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    await this.eventPools.updateStatePools();
  }

  async updateHooksState(): Promise<void> {
    await this.eventHooks.updateHookState();
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    count: number,
  ): Promise<PoolLiquidity[]> {
    const poolsWithToken = Object.entries(this.eventPools.getStaleState() || {})
      .filter(([, poolState]) => {
        return this.hasTokens(poolState, [tokenAddress.toLowerCase()]);
      })
      .map(([address]) => address);

    const topPools = await getTopPoolsApi(
      this.network,
      poolsWithToken,
      count,
      this.eventHooks.hooksConfigMap,
    );

    return topPools.map(pool => {
      const tokens = pool.poolTokens
        .filter(t => t.address !== tokenAddress)
        .map(t => ({
          address: t.address,
          decimals: t.decimals,
        }));

      const underlyingTokens = pool.poolTokens
        .map(t => t.underlyingToken)
        .filter(t => !!t)
        .filter(t => t?.address !== tokenAddress) as Token[];

      return {
        exchange: this.dexKey,
        address: pool.address,
        liquidityUSD: parseFloat(pool.dynamicData.totalLiquidity),
        connectorTokens: tokens.concat(underlyingTokens),
      };
    });
  }

  releaseResources(): AsyncOrSync<void> {
    if (this.updateNewPoolsTimer) {
      clearInterval(this.updateNewPoolsTimer);
      this.updateNewPoolsTimer = undefined;
      this.logger.info(
        `${this.dexKey}: cleared updateNewPoolsTimer before shutting down`,
      );
    }
    if (this.updateRatesTimer) {
      clearInterval(this.updateRatesTimer);
      this.updateRatesTimer = undefined;
      this.logger.info(
        `${this.dexKey}: cleared updateRatesTimer before shutting down`,
      );
    }
    if (this.updateHooksTimer) {
      clearInterval(this.updateHooksTimer);
      this.updateHooksTimer = undefined;
      this.logger.info(
        `${this.dexKey}: cleared updateHooksTimer before shutting down`,
      );
    }
  }
}
