import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  PoolLiquidity,
  DexExchangeParam,
  Logger,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { Context, IDex } from '../idex';
import { IDexHelper } from '../../dex-helper';
import {
  CollateralReserves,
  DebtReserves,
  FluidDexData,
  FluidDexPool,
  DexLimits,
  TokenLimit,
  PoolWithDecimals,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import FluidDexPoolABI from '../../abi/fluid-dex/fluid-dex.abi.json';
import { FluidDexConfig, FLUID_DEX_GAS_COST } from './config';
import { FluidDexFactory } from './fluid-dex-factory';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BigNumber } from 'ethers';
import { sqrt } from './utils';
import { FluidDexLiquidityProxy } from './fluid-dex-liquidity-proxy';
import { FluidDexEventPool } from './fluid-dex-pool';
import { MIN_SWAP_LIQUIDITY } from './constants';

export class FluidDex extends SimpleExchange implements IDex<FluidDexData> {
  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(FluidDexConfig);

  logger: Logger;

  pools: FluidDexPool[] = [];

  eventPools: FluidDexEventPool[] = [];

  readonly factory: FluidDexFactory;

  readonly liquidityProxy: FluidDexLiquidityProxy;

  readonly fluidDexPoolIface: Interface;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.factory = new FluidDexFactory(
      dexKey,
      FluidDexConfig[dexKey][network].commonAddresses,
      network,
      dexHelper,
      this.logger,
      this.onPoolCreatedUpdatePools.bind(this),
    );

    this.liquidityProxy = new FluidDexLiquidityProxy(
      dexKey,
      this.factory.commonAddresses,
      this.network,
      this.dexHelper,
      this.logger,
    );

    this.fluidDexPoolIface = new Interface(FluidDexPoolABI);
  }

  private async fetchFluidDexPools(
    blockNumber: number,
  ): Promise<FluidDexPool[]> {
    const poolsFromFactory = await this.factory.getStateOrGenerate(
      blockNumber,
      false,
    );
    return this.generateFluidDexPoolsFromPoolsFactory(poolsFromFactory);
  }

  private generateFluidDexPoolsFromPoolsFactory(
    pools: readonly PoolWithDecimals[],
  ): FluidDexPool[] {
    return pools.map(pool => ({
      id: `FluidDex_${pool.address}`,
      address: pool.address,
      token0: pool.token0,
      token1: pool.token1,
      token0Decimals: pool.token0Decimals,
      token1Decimals: pool.token1Decimals,
    }));
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.factory.initialize(blockNumber);
    this.pools = await this.fetchFluidDexPools(blockNumber);
    this.eventPools = await Promise.all(
      this.pools.map(async pool => {
        const eventPool = new FluidDexEventPool(
          this.dexKey,
          pool.address,
          this.network,
          this.dexHelper,
          this.logger,
        );
        await eventPool.initialize(blockNumber);
        return eventPool;
      }),
    );

    await this.liquidityProxy.initialize(blockNumber);
  }

  getAdapters(side: SwapSide) {
    return null;
  }

  protected onPoolCreatedUpdatePools(
    poolsFromFactory: readonly PoolWithDecimals[],
  ) {
    this.pools = this.generateFluidDexPoolsFromPoolsFactory(poolsFromFactory);
    this.logger.info(`${this.dexKey}: pools list was updated ...`);
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
    const pools = this.getPoolsByTokenPair(srcToken.address, destToken.address);
    return pools.map(pool => pool.id);
  }

  getPoolsByTokenPair(srcToken: Address, destToken: Address): FluidDexPool[] {
    const srcAddress = srcToken.toLowerCase();
    const destAddress = destToken.toLowerCase();

    // A pair must have 2 different tokens.
    if (srcAddress === destAddress) return [];

    return this.pools.filter(
      pool =>
        (srcAddress === pool.token0 && destAddress === pool.token1) ||
        (srcAddress === pool.token1 && destAddress === pool.token0),
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
  ): Promise<null | ExchangePrices<FluidDexData>> {
    try {
      if (srcToken.address.toLowerCase() === destToken.address.toLowerCase())
        return null;

      // Get the pools to use.
      let pools = this.getPoolsByTokenPair(srcToken.address, destToken.address);

      if (limitPools) {
        pools = pools.filter(pool => limitPools.includes(pool.id));
      }

      if (!pools.length) return null;

      const liquidityProxyState = await this.liquidityProxy.getStateOrGenerate(
        blockNumber,
      );

      const poolsPrices = await Promise.all(
        pools.map(async pool => {
          const currentPoolReserves = liquidityProxyState.poolsReserves.find(
            poolReserve =>
              poolReserve.pool.toLowerCase() === pool.address.toLowerCase(),
          );

          const eventPool = this.eventPools.find(
            eventPool =>
              eventPool.poolAddress.toLowerCase() ===
              pool.address.toLowerCase(),
          );

          if (!eventPool) {
            this.logger.warn(
              `${this.dexKey}-${this.network}: Event pool ${pool.address} was not found...`,
            );
            return null;
          }

          const state = await eventPool.getStateOrGenerate(blockNumber);

          if (!currentPoolReserves || state.isSwapAndArbitragePaused === true) {
            return null;
          }

          const prices = amounts.map(amount => {
            if (side === SwapSide.SELL) {
              return this.swapIn(
                srcToken.address.toLowerCase() === pool.token0.toLowerCase(),
                amount,
                currentPoolReserves.collateralReserves,
                currentPoolReserves.debtReserves,
                srcToken.decimals,
                destToken.decimals,
                BigInt(currentPoolReserves.fee),
                currentPoolReserves.dexLimits,
                BigInt(currentPoolReserves.centerPrice),
                Math.floor(Date.now() / 1000),
              );
            } else {
              return this.swapOut(
                srcToken.address.toLowerCase() === pool.token0.toLowerCase(),
                amount,
                currentPoolReserves.collateralReserves,
                currentPoolReserves.debtReserves,
                srcToken.decimals,
                destToken.decimals,
                BigInt(currentPoolReserves.fee),
                currentPoolReserves.dexLimits,
                BigInt(currentPoolReserves.centerPrice),
                Math.floor(Date.now() / 1000),
              );
            }
          });

          return {
            prices: prices,
            unit: getBigIntPow(destToken.decimals),
            data: {
              poolId: pool.id,
            },
            exchange: this.dexKey,
            poolIdentifiers: [pool.id],
            gasCost: FLUID_DEX_GAS_COST,
            poolAddresses: [pool.address],
          };
        }),
      );

      return poolsPrices.filter(
        res => res !== null,
      ) as ExchangePrices<FluidDexData>;
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.address || srcToken.symbol}, ${
          destToken.address || destToken.symbol
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<FluidDexData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: FluidDexData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: '0x',
      payload,
      networkFee: '0',
    };
  }

  async updatePoolState() {
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();

    this.pools = await this.fetchFluidDexPools(blockNumber);

    this.eventPools = await Promise.all(
      this.pools.map(async pool => {
        const eventPool = new FluidDexEventPool(
          this.dexKey,
          pool.address,
          this.network,
          this.dexHelper,
          this.logger,
        );
        await eventPool.updatePoolState(blockNumber);
        return eventPool;
      }),
    );

    await this.liquidityProxy.updatePoolState(blockNumber);
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    try {
      const normalizedTokenAddress = tokenAddress.toLowerCase();

      const relevantPools = this.pools.filter(
        pool =>
          pool.token0 === normalizedTokenAddress ||
          pool.token1 === normalizedTokenAddress,
      );

      if (!relevantPools.length) {
        return [];
      }

      const liquidityProxyState = this.liquidityProxy.getStaleState();

      if (!liquidityProxyState) {
        return [];
      }

      const poolLiquidity: PoolLiquidity[] = [];

      for (const pool of relevantPools) {
        const currentPoolReserves = liquidityProxyState.poolsReserves.find(
          poolReserve => poolReserve.pool.toLowerCase() === pool.address,
        );

        if (!currentPoolReserves) {
          continue;
        }

        const eventPool = this.eventPools.find(
          eventPool => eventPool.poolAddress.toLowerCase() === pool.address,
        );

        if (!eventPool) continue;

        try {
          const state = eventPool.getStaleState();
          if (!state || state.isSwapAndArbitragePaused) {
            // Skip paused pools
            continue;
          }

          const token0Supply =
            currentPoolReserves.dexLimits.withdrawableToken0.available +
            currentPoolReserves.dexLimits.borrowableToken0.available;
          const token1Supply =
            currentPoolReserves.dexLimits.withdrawableToken1.available +
            currentPoolReserves.dexLimits.borrowableToken1.available;

          if (token0Supply === 0n || token1Supply === 0n) {
            // Skip pools with no liquidity
            continue;
          }

          const [token0LiquidityUSD, token1LiquidityUSD] =
            await this.dexHelper.getUsdTokenAmounts([
              [pool.token0, token0Supply],
              [pool.token1, token1Supply],
            ]);

          // Determine connector token (the other token in the pair)
          const [connectorToken, liquidityUSD] =
            pool.token0.toLowerCase() === normalizedTokenAddress
              ? [
                  {
                    address: pool.token1,
                    decimals: pool.token1Decimals,
                    liquidityUSD: token1LiquidityUSD,
                  },
                  token0LiquidityUSD,
                ]
              : [
                  {
                    address: pool.token0,
                    decimals: pool.token0Decimals,
                    liquidityUSD: token0LiquidityUSD,
                  },
                  token1LiquidityUSD,
                ];

          poolLiquidity.push({
            exchange: this.dexKey,
            address: pool.address,
            connectorTokens: [connectorToken],
            liquidityUSD,
          });
        } catch (error) {
          this.logger.debug(
            `Error getting liquidity for pool ${pool.id}`,
            error,
          );
        }
      }

      // Sort by liquidity and return top pools
      return poolLiquidity
        .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error in getTopPoolsForToken', error);
      return [];
    }
  }

  async getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: string,
    destAmount: string,
    recipient: Address,
    data: FluidDexData,
    side: SwapSide,
    context: Context,
    executorAddress: Address,
  ): Promise<DexExchangeParam> {
    let args: any;
    let returnAmountPos: number | undefined;

    const method = side === SwapSide.SELL ? 'swapIn' : 'swapOut';

    returnAmountPos = extractReturnAmountPosition(
      this.fluidDexPoolIface,
      method,
      side === SwapSide.SELL ? 'amountOut_' : 'amountIn_',
    );

    const pool = this.pools.find(pool => pool.id === data.poolId);
    if (!pool)
      throw new Error(
        `${this.dexKey}-${this.network}: Pool with id: ${data.poolId} was not found`,
      );

    if (side === SwapSide.SELL) {
      if (pool!.token0.toLowerCase() !== srcToken.toLowerCase()) {
        args = [false, BigInt(srcAmount), BigInt(destAmount), recipient];
      } else {
        args = [true, BigInt(srcAmount), BigInt(destAmount), recipient];
      }
    } else {
      if (pool!.token0.toLowerCase() !== srcToken.toLowerCase()) {
        args = [
          false,
          (BigInt(destAmount) * 1000001n) / 1000000n, // 0.0001% increase target out amount when calling Fluid Dex as it is not 100% exact. Guarantees meeting reaching exact out amount condition
          BigInt(srcAmount),
          recipient,
        ];
      } else {
        args = [
          true,
          (BigInt(destAmount) * 1000001n) / 1000000n, // 0.0001% increase target out amount when calling Fluid Dex as it is not 100% exact. Guarantees meeting reaching exact out amount condition
          BigInt(srcAmount),
          recipient,
        ];
      }
    }
    const swapData = this.fluidDexPoolIface.encodeFunctionData(method, args);
    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: pool!.address,
      returnAmountPos,
      sendEthButSupportsInsertFromAmount: true,
    };
  }

  /**
   * Calculates the output amount for a given input amount in a swap operation.
   * @param swap0To1 - Direction of the swap. True if swapping token0 for token1, false otherwise.
   * @param amountIn - The amount of input token to be swapped (as a BigInt).
   * @param colReserves - The reserves of the collateral pool.
   * @param debtReserves - The reserves of the debt pool.
   * @param inDecimals - The number of decimals for the input token.
   * @param outDecimals - The number of decimals for the output token.
   * @returns The calculated output amount (as a BigInt).
   */
  public swapIn(
    swap0To1: boolean,
    amountIn: bigint,
    colReserves: CollateralReserves,
    debtReserves: DebtReserves,
    inDecimals: number,
    outDecimals: number,
    fee: bigint,
    currentLimits: DexLimits,
    centerPrice: bigint,
    syncTime: number,
  ): bigint {
    if (amountIn === 0n) {
      return 0n; // Return 0 if input amount is 0
    }
    if (
      colReserves.token0RealReserves + debtReserves.token0RealReserves == 0n &&
      colReserves.token1RealReserves + debtReserves.token1RealReserves == 0n
    ) {
      return 0n;
    }

    const amountInAdjusted =
      (amountIn * BigInt(10 ** 12)) / BigInt(10 ** inDecimals);

    const amountOut = this.swapInAdjusted(
      swap0To1,
      amountInAdjusted,
      colReserves,
      debtReserves,
      fee,
      outDecimals,
      currentLimits,
      centerPrice,
      syncTime,
    );
    return (amountOut * BigInt(10 ** outDecimals)) / BigInt(10 ** 12);
  }

  /**
   * Calculates the output amount for a given input amount in a swap operation.
   * @param swap0To1 - Direction of the swap. True if swapping token0 for token1, false otherwise.
   * @param amountToSwap - The amount of input token to be swapped.
   * @param colReserves - The reserves of the collateral pool.
   * @param debtReserves - The reserves of the debt pool.
   * @returns The calculated output amount.
   */
  public swapInAdjusted(
    swap0To1: boolean,
    amountToSwap: bigint,
    colReserves: CollateralReserves,
    debtReserves: DebtReserves,
    fee: bigint,
    outDecimals: number,
    currentLimits: DexLimits,
    centerPrice: bigint,
    syncTime: number,
  ): bigint {
    const {
      token0RealReserves,
      token1RealReserves,
      token0ImaginaryReserves,
      token1ImaginaryReserves,
    } = colReserves;
    const {
      token0RealReserves: debtToken0RealReserves,
      token1RealReserves: debtToken1RealReserves,
      token0ImaginaryReserves: debtToken0ImaginaryReserves,
      token1ImaginaryReserves: debtToken1ImaginaryReserves,
    } = debtReserves;

    // Check if all reserves of collateral pool are greater than 0
    const colPoolEnabled =
      token0RealReserves > 0 &&
      token1RealReserves > 0 &&
      token0ImaginaryReserves > 0 &&
      token1ImaginaryReserves > 0;

    // Check if all reserves of debt pool are greater than 0
    const debtPoolEnabled =
      debtToken0RealReserves > 0 &&
      debtToken1RealReserves > 0 &&
      debtToken0ImaginaryReserves > 0 &&
      debtToken1ImaginaryReserves > 0;

    let colReserveIn, colReserveOut, debtReserveIn, debtReserveOut;
    let colIReserveIn, colIReserveOut, debtIReserveIn, debtIReserveOut;
    let borrowable, withdrawable;

    if (swap0To1) {
      colReserveIn = token0RealReserves;
      colReserveOut = token1RealReserves;
      colIReserveIn = token0ImaginaryReserves;
      colIReserveOut = token1ImaginaryReserves;
      debtReserveIn = debtToken0RealReserves;
      debtReserveOut = debtToken1RealReserves;
      debtIReserveIn = debtToken0ImaginaryReserves;
      debtIReserveOut = debtToken1ImaginaryReserves;
      borrowable = this.getExpandedLimit(
        syncTime,
        currentLimits.borrowableToken1,
      );
      withdrawable = this.getExpandedLimit(
        syncTime,
        currentLimits.withdrawableToken1,
      );
    } else {
      colReserveIn = token1RealReserves;
      colReserveOut = token0RealReserves;
      colIReserveIn = token1ImaginaryReserves;
      colIReserveOut = token0ImaginaryReserves;
      debtReserveIn = debtToken1RealReserves;
      debtReserveOut = debtToken0RealReserves;
      debtIReserveIn = debtToken1ImaginaryReserves;
      debtIReserveOut = debtToken0ImaginaryReserves;
      borrowable = this.getExpandedLimit(
        syncTime,
        currentLimits.borrowableToken0,
      );
      withdrawable = this.getExpandedLimit(
        syncTime,
        currentLimits.withdrawableToken0,
      );
    }

    // bring borrowable and withdrawable from token decimals to 1e12 decimals, same as amounts
    borrowable = (borrowable * BigInt(10 ** 12)) / BigInt(10 ** outDecimals);
    withdrawable =
      (withdrawable * BigInt(10 ** 12)) / BigInt(10 ** outDecimals);

    let a: bigint;
    if (colPoolEnabled && debtPoolEnabled) {
      a = this.swapRoutingIn(
        amountToSwap,
        colIReserveOut,
        colIReserveIn,
        debtIReserveOut,
        debtIReserveIn,
      );
    } else if (debtPoolEnabled) {
      a = -1n; // Route from debt pool
    } else if (colPoolEnabled) {
      a = amountToSwap + 1n; // Route from collateral pool
    } else {
      throw new Error('No pools are enabled');
    }

    let amountOutCollateral = 0n;
    let amountOutDebt = 0n;
    let amountInCollateral = 0n;
    let amountInDebt = 0n;

    if (a <= 0n) {
      // Entire trade routes through debt pool
      amountInDebt = amountToSwap;

      amountOutDebt = this.getAmountOut(
        this.applyFeeForSell(amountToSwap, fee),
        debtIReserveIn,
        debtIReserveOut,
      );
    } else if (a >= amountToSwap) {
      // Entire trade routes through collateral pool
      amountInCollateral = amountToSwap;
      amountOutCollateral = this.getAmountOut(
        this.applyFeeForSell(amountToSwap, fee),
        colIReserveIn,
        colIReserveOut,
      );
    } else {
      // Trade routes through both pools
      amountInCollateral = a;
      amountOutCollateral = this.getAmountOut(
        this.applyFeeForSell(a, fee),
        colIReserveIn,
        colIReserveOut,
      );
      amountInDebt = amountToSwap - a;
      amountOutDebt = this.getAmountOut(
        this.applyFeeForSell(amountInDebt, fee),
        debtIReserveIn,
        debtIReserveOut,
      );
    }

    if (amountOutDebt > debtReserveOut) {
      return 0n;
    }
    if (amountOutDebt > borrowable) {
      return 0n;
    }

    if (amountOutCollateral > colReserveOut) {
      return 0n;
    }

    if (amountOutCollateral > withdrawable) {
      return 0n;
    }

    if (amountInCollateral > 0) {
      let reservesRatioValid = swap0To1
        ? this.verifyToken1Reserves(
            colReserveIn + amountInCollateral,
            colReserveOut - amountOutCollateral,
            centerPrice,
          )
        : this.verifyToken0Reserves(
            colReserveOut - amountOutCollateral,
            colReserveIn + amountInCollateral,
            centerPrice,
          );
      if (!reservesRatioValid) {
        return 0n;
      }
    }

    if (amountInDebt > 0) {
      let reservesRatioValid = swap0To1
        ? this.verifyToken1Reserves(
            debtReserveIn + amountInDebt,
            debtReserveOut - amountOutDebt,
            centerPrice,
          )
        : this.verifyToken0Reserves(
            debtReserveOut - amountOutDebt,
            debtReserveIn + amountInDebt,
            centerPrice,
          );
      if (!reservesRatioValid) {
        return 0n;
      }
    }

    // For price calculations, we'll use a precision factor for bigint division
    const PRECISION = 1000000000000000000000000000n; // 1e27

    let oldPrice: bigint;
    let newPrice: bigint;

    if (amountInCollateral > amountInDebt) {
      // new pool price from col pool
      oldPrice = swap0To1
        ? (colIReserveOut * PRECISION) / colIReserveIn
        : (colIReserveIn * PRECISION) / colIReserveOut;

      newPrice = swap0To1
        ? ((colIReserveOut - amountOutCollateral) * PRECISION) /
          (colIReserveIn + amountInCollateral)
        : ((colIReserveIn + amountInCollateral) * PRECISION) /
          (colIReserveOut - amountOutCollateral);
    } else {
      // new pool price from debt pool
      oldPrice = swap0To1
        ? (debtIReserveOut * PRECISION) / debtIReserveIn
        : (debtIReserveIn * PRECISION) / debtIReserveOut;

      newPrice = swap0To1
        ? ((debtIReserveOut - amountOutDebt) * PRECISION) /
          (debtIReserveIn + amountInDebt)
        : ((debtIReserveIn + amountInDebt) * PRECISION) /
          (debtIReserveOut - amountOutDebt);
    }
    // Calculate price difference using bigint arithmetic
    const MAX_PRICE_DIFF = 5n; // 5%
    const priceDiff =
      oldPrice > newPrice ? oldPrice - newPrice : newPrice - oldPrice;
    const maxAllowedDiff = (oldPrice * MAX_PRICE_DIFF) / 100n;

    if (priceDiff > maxAllowedDiff) {
      return 0n;
    }

    const totalAmountOut = amountOutCollateral + amountOutDebt;

    return totalAmountOut;
  }

  /**
   * Checks if token0 reserves are sufficient compared to token1 reserves.
   * This helps prevent edge cases and ensures high precision in calculations.
   * @param {number} token0Reserves - The reserves of token0.
   * @param {number} token1Reserves - The reserves of token1.
   * @param {number} price - The current price used for calculation.
   * @returns {boolean} - Returns false if token0 reserves are too low, true otherwise.
   */
  protected verifyToken0Reserves(
    token0Reserves: bigint,
    token1Reserves: bigint,
    price: bigint,
  ): boolean {
    return (
      token0Reserves >=
      (token1Reserves * 10n ** 27n) / (price * MIN_SWAP_LIQUIDITY)
    );
  }

  /**
   * Checks if token1 reserves are sufficient compared to token0 reserves.
   * This helps prevent edge cases and ensures high precision in calculations.
   * @param {number} token0Reserves - The reserves of token0.
   * @param {number} token1Reserves - The reserves of token1.
   * @param {number} price - The current price used for calculation.
   * @returns {boolean} - Returns false if token1 reserves are too low, true otherwise.
   */
  protected verifyToken1Reserves(
    token0Reserves: bigint,
    token1Reserves: bigint,
    price: bigint,
  ): boolean {
    return (
      token1Reserves >=
      (token0Reserves * price) / (10n ** 27n * MIN_SWAP_LIQUIDITY)
    );
  }

  /**
   * Calculates the currently available swappable amount for a token limit considering expansion since last syncTime.
   * @param syncTime - timestamp in seconds when the limits were synced
   * @param limit - token limit object containing available amount, expandsTo amount, and expandDuration
   * @returns The calculated available swappable amount (borrowable or withdrawable)
   */
  public getExpandedLimit(syncTime: number, limit: TokenLimit): bigint {
    const currentTime = Math.floor(Date.now() / 1000); // convert milliseconds to seconds
    const elapsedTime = currentTime - syncTime;
    limit.expandsDuration = limit.expandsDuration || 0n;
    if (elapsedTime < 10n) {
      // if almost no time has elapsed, return available amount
      return limit.available;
    }

    if (elapsedTime >= limit.expandsDuration) {
      // if duration has passed, return max amount
      return limit.expandsTo;
    }

    // Calculate expansion ratio using bigint arithmetic
    // Multiply by a large factor for precision in integer arithmetic
    const PRECISION = 1000000;
    const ratio = BigInt(elapsedTime * PRECISION) / limit.expandsDuration;

    // Calculate expanded amount with precision factor
    const expansion =
      ((limit.expandsTo - limit.available) * ratio) / BigInt(PRECISION);
    const expandedAmount = limit.available + expansion;
    return expandedAmount;
  }

  /**
   * Given an input amount of asset and pair reserves, returns the maximum output amount of the other asset.
   * @param amountIn - The amount of input asset.
   * @param iReserveIn - Imaginary token reserve with input amount.
   * @param iReserveOut - Imaginary token reserve of output amount.
   * @returns The maximum output amount of the other asset.
   */
  public getAmountOut(
    amountIn: bigint,
    iReserveIn: bigint,
    iReserveOut: bigint,
  ): bigint {
    // Both numerator and denominator are scaled to 1e6 to factor in fee scaling.
    const numerator = amountIn * iReserveOut;
    const denominator = iReserveIn + amountIn;

    // Using the swap formula: (AmountIn * iReserveY) / (iReserveX + AmountIn)
    // We use division with rounding down, which is the default for bigint division

    return numerator / denominator;
  }

  /**
   * Given an output amount of asset and pair reserves, returns the input amount of the other asset
   * @param amountOut - Desired output amount of the asset.
   * @param iReserveIn - Imaginary token reserve of input amount.
   * @param iReserveOut - Imaginary token reserve of output amount.
   * @returns The input amount of the other asset.
   */
  public getAmountIn(
    amountOut: bigint,
    iReserveIn: bigint,
    iReserveOut: bigint,
  ): bigint {
    // Both numerator and denominator are scaled to 1e6 to factor in fee scaling.
    const numerator = amountOut * iReserveIn;
    const denominator = iReserveOut - amountOut;

    // Using the swap formula: (AmountOut * iReserveX) / (iReserveY - AmountOut)
    return numerator / denominator;
  }

  /**
   * Calculates how much of a swap should go through the collateral pool for output amount.
   * @param t - Total amount out.
   * @param x - Imaginary reserves of token in of collateral.
   * @param y - Imaginary reserves of token out of collateral.
   * @param x2 - Imaginary reserves of token in of debt.
   * @param y2 - Imaginary reserves of token out of debt.
   * @returns How much swap should go through collateral pool. Remaining will go from debt.
   * @note If a < 0 then entire trade route through debt pool and debt pool arbitrage with col pool.
   * @note If a > t then entire trade route through col pool and col pool arbitrage with debt pool.
   * @note If a > 0 & a < t then swap will route through both pools.
   */
  public swapRoutingOut(
    t: bigint,
    x: bigint,
    y: bigint,
    x2: bigint,
    y2: bigint,
  ): bigint {
    // Adding 1e18 precision
    const xyRoot = sqrt(BigNumber.from(x).mul(y).mul(BigInt(1e18))).toBigInt();
    const x2y2Root = sqrt(
      BigNumber.from(x2).mul(y2).mul(BigInt(1e18)),
    ).toBigInt();

    // 1e18 precision gets cancelled out in division
    const numerator = t * xyRoot + y * x2y2Root - y2 * xyRoot;
    const denominator = xyRoot + x2y2Root;

    // Use integer division (rounds down)
    const a = numerator / denominator;

    return a;
  }

  /**
   * Calculates how much of a swap should go through the collateral pool.
   * @param t - Total amount in.
   * @param x - Imaginary reserves of token out of collateral.
   * @param y - Imaginary reserves of token in of collateral.
   * @param x2 - Imaginary reserves of token out of debt.
   * @param y2 - Imaginary reserves of token in of debt.
   * @returns How much swap should go through collateral pool. Remaining will go from debt.
   * @note If a < 0 then entire trade route through debt pool and debt pool arbitrage with col pool.
   * @note If a > t then entire trade route through col pool and col pool arbitrage with debt pool.
   * @note If a > 0 & a < t then swap will route through both pools.
   */
  public swapRoutingIn(
    t: bigint,
    x: bigint,
    y: bigint,
    x2: bigint,
    y2: bigint,
  ): bigint {
    // Adding 1e18 precision

    const xyRoot = sqrt(BigNumber.from(x).mul(y).mul(BigInt(1e18))).toBigInt();
    const x2y2Root = sqrt(
      BigNumber.from(x2).mul(y2).mul(BigInt(1e18)),
    ).toBigInt();

    // Calculating 'a' using the given formula
    const a = (y2 * xyRoot + t * xyRoot - y * x2y2Root) / (xyRoot + x2y2Root);
    return a;
  }

  /**
   * Calculates the input amount for a given output amount in a swap operation.
   * @param {boolean} swap0to1 - Direction of the swap. True if swapping token0 for token1, false otherwise.
   * @param {bigint} amountOut - The amount of output token to be swapped.
   * @param {Reserves} colReserves - The reserves of the collateral pool.
   * @param {Reserves} debtReserves - The reserves of the debt pool.
   * @param {number} inDecimals - The number of decimals for the input token.
   * @param {number} outDecimals - The number of decimals for the output token.
   * @param {number} fee - The fee for the swap. 1e4 = 1%
   * @returns {bigint} amountIn - The calculated input amount required for the swap.
   */
  public swapOut(
    swap0to1: boolean,
    amountOut: bigint,
    colReserves: CollateralReserves,
    debtReserves: DebtReserves,
    inDecimals: number,
    outDecimals: number,
    fee: bigint,
    currentLimits: DexLimits,
    centerPrice: bigint,
    syncTime: number,
  ): bigint {
    const amountOutWithBuffer = (amountOut * 1000001n) / 1000000n;

    const amountOutAdjusted =
      (amountOutWithBuffer * BigInt(10 ** 12)) / BigInt(10 ** outDecimals);

    const amountIn = this.swapOutAdjusted(
      swap0to1,
      amountOutAdjusted,
      colReserves,
      debtReserves,
      fee,
      outDecimals,
      currentLimits,
      centerPrice,
      syncTime,
    );

    const ans = (amountIn * BigInt(10 ** inDecimals)) / BigInt(10 ** 12);
    return ans;
  }

  /**
   * Calculates the input amount for a given output amount in a swap operation.
   * @param {boolean} swap0to1 - Direction of the swap. True if swapping token0 for token1, false otherwise.
   * @param {bigint} amountOut - The amount of output token to be swapped.
   * @param {CollateralReserves} colReserves - The reserves of the collateral pool.
   * @param {DebtReserves} debtReserves - The reserves of the debt pool.
   * @returns {bigint} The calculated input amount required for the swap.
   */
  public swapOutAdjusted(
    swap0to1: boolean,
    amountOut: bigint,
    colReserves: CollateralReserves,
    debtReserves: DebtReserves,
    fee: bigint,
    outDecimals: number,
    currentLimits: DexLimits,
    centerPrice: bigint,
    syncTime: number,
  ): bigint {
    if (amountOut === 0n) {
      return 0n; // Return 0 if output amount is 0
    }
    const {
      token0RealReserves,
      token1RealReserves,
      token0ImaginaryReserves,
      token1ImaginaryReserves,
    } = colReserves;

    const {
      token0RealReserves: debtToken0RealReserves,
      token1RealReserves: debtToken1RealReserves,
      token0ImaginaryReserves: debtToken0ImaginaryReserves,
      token1ImaginaryReserves: debtToken1ImaginaryReserves,
    } = debtReserves;

    // Check if all reserves of collateral pool are greater than 0
    const colPoolEnabled =
      token0RealReserves > 0n &&
      token1RealReserves > 0n &&
      token0ImaginaryReserves > 0n &&
      token1ImaginaryReserves > 0n;

    // Check if all reserves of debt pool are greater than 0
    const debtPoolEnabled =
      debtToken0RealReserves > 0n &&
      debtToken1RealReserves > 0n &&
      debtToken0ImaginaryReserves > 0n &&
      debtToken1ImaginaryReserves > 0n;

    let colReserveIn: bigint,
      colReserveOut: bigint,
      debtReserveIn: bigint,
      debtReserveOut: bigint;
    let colIReserveIn: bigint,
      colIReserveOut: bigint,
      debtIReserveIn: bigint,
      debtIReserveOut: bigint;
    let borrowable: bigint, withdrawable: bigint;

    if (swap0to1) {
      colReserveIn = token0RealReserves;
      colReserveOut = token1RealReserves;
      colIReserveIn = token0ImaginaryReserves;
      colIReserveOut = token1ImaginaryReserves;
      debtReserveIn = debtToken0RealReserves;
      debtReserveOut = debtToken1RealReserves;
      debtIReserveIn = debtToken0ImaginaryReserves;
      debtIReserveOut = debtToken1ImaginaryReserves;
      borrowable = this.getExpandedLimit(
        syncTime,
        currentLimits.borrowableToken1,
      );
      withdrawable = this.getExpandedLimit(
        syncTime,
        currentLimits.withdrawableToken1,
      );
    } else {
      colReserveIn = token1RealReserves;
      colReserveOut = token0RealReserves;
      colIReserveIn = token1ImaginaryReserves;
      colIReserveOut = token0ImaginaryReserves;
      debtReserveIn = debtToken1RealReserves;
      debtReserveOut = debtToken0RealReserves;
      debtIReserveIn = debtToken1ImaginaryReserves;
      debtIReserveOut = debtToken0ImaginaryReserves;
      borrowable = this.getExpandedLimit(
        syncTime,
        currentLimits.borrowableToken0,
      );
      withdrawable = this.getExpandedLimit(
        syncTime,
        currentLimits.withdrawableToken0,
      );
    }

    // bring borrowable and withdrawable from token decimals to 1e12 decimals, same as amounts
    borrowable = (borrowable * BigInt(10 ** 12)) / BigInt(10 ** outDecimals);
    withdrawable =
      (withdrawable * BigInt(10 ** 12)) / BigInt(10 ** outDecimals);

    let a: bigint;
    if (colPoolEnabled && debtPoolEnabled) {
      a = this.swapRoutingOut(
        amountOut,
        colIReserveIn,
        colIReserveOut,
        debtIReserveIn,
        debtIReserveOut,
      );
    } else if (debtPoolEnabled) {
      a = -1n; // Route from debt pool
    } else if (colPoolEnabled) {
      a = amountOut + 1n; // Route from collateral pool
    } else {
      throw new Error('No pools are enabled');
    }

    let amountInCollateral: bigint = 0n;
    let amountInDebt: bigint = 0n;
    let amountOutCollateral: bigint = 0n;
    let amountOutDebt: bigint = 0n;

    if (a <= 0n) {
      // Entire trade routes through debt pool

      amountOutDebt = amountOut;
      amountInDebt = this.getAmountIn(
        amountOut,
        debtIReserveIn,
        debtIReserveOut,
      );
      amountInDebt = this.applyFeeForBuy(amountInDebt, fee);
      if (amountOut > debtReserveOut) {
        return 0n;
      }
      if (amountOut > borrowable) {
        return 0n;
      }
    } else if (a >= amountOut) {
      // Entire trade routes through collateral pool
      amountOutCollateral = amountOut;
      amountInCollateral = this.getAmountIn(
        amountOut,
        colIReserveIn,
        colIReserveOut,
      );
      amountInCollateral = this.applyFeeForBuy(amountInCollateral, fee);
      if (amountOut > colReserveOut) {
        return 0n;
      }
      if (amountOut > withdrawable) {
        return 0n;
      }
    } else {
      // Trade routes through both pools
      amountOutCollateral = a;
      amountInCollateral = this.getAmountIn(a, colIReserveIn, colIReserveOut);
      const amountOutDebtAdjusted = amountOut - a;

      amountInCollateral = this.applyFeeForBuy(amountInCollateral, fee);

      amountInDebt = this.getAmountIn(
        amountOutDebtAdjusted,
        debtIReserveIn,
        debtIReserveOut,
      );

      amountInDebt = this.applyFeeForBuy(amountInDebt, fee);
      if (amountOutDebt > debtReserveOut || a > colReserveOut) {
        return 0n;
      }
      if (amountOutDebt > borrowable || a > withdrawable) {
        return 0n;
      }
    }

    if (amountInCollateral > 0) {
      let reservesRatioValid = swap0to1
        ? this.verifyToken1Reserves(
            colReserveIn + amountInCollateral,
            colReserveOut - amountOutCollateral,
            centerPrice,
          )
        : this.verifyToken0Reserves(
            colReserveOut - amountOutCollateral,
            colReserveIn + amountInCollateral,
            centerPrice,
          );
      if (!reservesRatioValid) {
        return 0n;
      }
    }
    if (amountInDebt > 0) {
      let reservesRatioValid = swap0to1
        ? this.verifyToken1Reserves(
            debtReserveIn + amountInDebt,
            debtReserveOut - amountOutDebt,
            centerPrice,
          )
        : this.verifyToken0Reserves(
            debtReserveOut - amountOutDebt,
            debtReserveIn + amountInDebt,
            centerPrice,
          );
      if (!reservesRatioValid) {
        return 0n;
      }
    }

    let oldPrice: bigint;
    let newPrice: bigint;
    const SCALE = BigInt(1e27);

    // from whatever pool higher amount of swap is routing we are taking that as final price, does not matter much because both pools final price should be same
    if (amountOutCollateral > amountOutDebt) {
      // new pool price from col pool
      oldPrice = swap0to1
        ? (colIReserveOut * SCALE) / colIReserveIn
        : (colIReserveIn * SCALE) / colIReserveOut;
      newPrice = swap0to1
        ? ((colIReserveOut - amountOutCollateral) * SCALE) /
          (colIReserveIn + amountInCollateral)
        : ((colIReserveIn + amountInCollateral) * SCALE) /
          (colIReserveOut - amountOutCollateral);
    } else {
      // new pool price from debt pool
      oldPrice = swap0to1
        ? (debtIReserveOut * SCALE) / debtIReserveIn
        : (debtIReserveIn * SCALE) / debtIReserveOut;
      newPrice = swap0to1
        ? ((debtIReserveOut - amountOutDebt) * SCALE) /
          (debtIReserveIn + amountInDebt)
        : ((debtIReserveIn + amountInDebt) * SCALE) /
          (debtIReserveOut - amountOutDebt);
    }

    const MAX_PRICE_DIFF = BigInt(5); // 5%
    if (
      this.abs(oldPrice - newPrice) >
      (oldPrice / BigInt(100)) * MAX_PRICE_DIFF
    ) {
      // if price diff is > 5% then swap would revert.
      return 0n;
    }

    const totalAmountIn = amountInCollateral + amountInDebt;

    return totalAmountIn;
  }

  private applyFeeForBuy(amount: bigint, fee: bigint): bigint {
    return (amount * 10n ** 6n) / (10n ** 6n - fee);
  }

  private applyFeeForSell(amount: bigint, fee: bigint): bigint {
    return (amount * (10n ** 6n - fee)) / 10n ** 6n;
  }

  private abs(value: bigint): bigint {
    return value < 0 ? -value : value;
  }
}
