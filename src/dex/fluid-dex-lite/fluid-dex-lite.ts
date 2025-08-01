import { AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  DexExchangeParam,
  NumberAsString,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  FluidDexLiteData,
  DexKey,
  PoolParams,
  PoolState,
  BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_DECIMALS,
  BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_DECIMALS,
  BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_TOTAL_SUPPLY_ADJUSTED,
  BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_TOTAL_SUPPLY_ADJUSTED,
  X5,
  X60,
} from './types';
import { unpackDexVariables as fullUnpackDexVariables } from './fluid-dex-lite-math';
import { SimpleExchange } from '../simple-exchange';
import { FluidDexLiteConfig } from './config';
import { FluidDexLiteEventPool } from './fluid-dex-lite-pool';
import FluidDexLiteABI from '../../abi/fluid-dex-lite/FluidDexLite.abi.json';
import { Interface } from '@ethersproject/abi';
import { hexZeroPad } from 'ethers/lib/utils';
import { uint256ToBigInt } from '../../lib/decoders';
import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from 'web3-utils';
import { calculateSwap } from './fluid-dex-lite-math';
import { extractReturnAmountPosition } from '../../executor/utils';

// Storage slot constants
const DEX_LITE_DEXES_LIST_SLOT = 1;

export class FluidDexLite
  extends SimpleExchange
  implements IDex<FluidDexLiteData>
{
  protected eventPools: { [key: string]: FluidDexLiteEventPool | null } = {};
  public pools: PoolParams[] = [];

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(FluidDexLiteConfig);

  logger: Logger;
  fluidDexLiteIface: Interface;
  dexLiteAddress: Address;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.fluidDexLiteIface = new Interface(FluidDexLiteABI);

    const config = FluidDexLiteConfig[dexKey][network];
    if (!config) {
      throw new Error(`No config found for ${dexKey} on network ${network}`);
    }
    this.dexLiteAddress = config.dexLiteAddress;
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests.
  async initializePricing(blockNumber: number) {
    try {
      // Step 1: Read the _dexesList array from storage
      await this.loadDexesList(blockNumber);

      // Step 2: Initialize event pools for each dex
      await this.initializeEventPools(blockNumber);

      this.logger.info(`FluidDexLite: Initialized ${this.pools.length} pools`);
    } catch (error) {
      this.logger.error('FluidDexLite: Failed to initialize pricing', error);
      throw error;
    }
  }

  // Load all dex pools from the _dexesList storage array
  private async loadDexesList(blockNumber: number): Promise<void> {
    try {
      // First, read the array length from the storage slot
      const lengthSlot = hexZeroPad(
        '0x' + DEX_LITE_DEXES_LIST_SLOT.toString(16),
        32,
      );
      const lengthCallData = {
        target: this.dexLiteAddress,
        callData: this.fluidDexLiteIface.encodeFunctionData('readFromStorage', [
          lengthSlot,
        ]),
        decodeFunction: uint256ToBigInt,
      };

      const lengthResult =
        await this.dexHelper.multiWrapper.tryAggregate<bigint>(
          false,
          [lengthCallData],
          blockNumber,
          this.dexHelper.multiWrapper.defaultBatchSize,
          false,
        );

      const arrayLength = Number(lengthResult[0].returnData);
      if (arrayLength === 0) {
        this.logger.info('FluidDexLite: No dex pools found in _dexesList');
        return;
      }

      // Calculate base slot for array data: keccak256(slot)
      const arrayBaseSlot = keccak256(
        defaultAbiCoder.encode(['uint256'], [DEX_LITE_DEXES_LIST_SLOT]),
      );

      // OPTIMIZED: Batch ALL storage reads into a single RPC call
      // Build all multicall data for all DexKeys (3N storage slots total)
      const allMulticallData = [];

      for (let i = 0; i < arrayLength; i++) {
        const baseIndex = BigInt(arrayBaseSlot) + BigInt(i * 3); // Each DexKey struct takes 3 slots

        // Add token0 slot
        allMulticallData.push({
          target: this.dexLiteAddress,
          callData: this.fluidDexLiteIface.encodeFunctionData(
            'readFromStorage',
            [hexZeroPad('0x' + baseIndex.toString(16), 32)],
          ),
          decodeFunction: uint256ToBigInt,
        });

        // Add token1 slot
        allMulticallData.push({
          target: this.dexLiteAddress,
          callData: this.fluidDexLiteIface.encodeFunctionData(
            'readFromStorage',
            [hexZeroPad('0x' + (baseIndex + 1n).toString(16), 32)],
          ),
          decodeFunction: uint256ToBigInt,
        });

        // Add salt slot
        allMulticallData.push({
          target: this.dexLiteAddress,
          callData: this.fluidDexLiteIface.encodeFunctionData(
            'readFromStorage',
            [hexZeroPad('0x' + (baseIndex + 2n).toString(16), 32)],
          ),
          decodeFunction: uint256ToBigInt,
        });
      }

      // Execute ALL storage reads in a single batched RPC call
      const allResults = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        allMulticallData,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

      // Process results to build DexKeys
      const dexesList: DexKey[] = [];
      for (let i = 0; i < arrayLength; i++) {
        const resultIndex = i * 3; // Each DexKey uses 3 results

        // Validate we have all required results
        if (resultIndex + 2 >= allResults.length) {
          this.logger.warn(
            `FluidDexLite: Missing results for pool ${i}, skipping`,
          );
          continue;
        }

        const token0 = allResults[resultIndex].returnData;
        const token1 = allResults[resultIndex + 1].returnData;
        const salt = allResults[resultIndex + 2].returnData;

        // Validate non-zero values
        if (token0 === 0n || token1 === 0n) {
          this.logger.debug(
            `FluidDexLite: Invalid token addresses for pool ${i}, skipping`,
          );
          continue;
        }

        // Convert to addresses with proper validation
        const dexKey: DexKey = {
          token0: '0x' + token0.toString(16).padStart(40, '0'),
          token1: '0x' + token1.toString(16).padStart(40, '0'),
          salt: '0x' + salt.toString(16).padStart(64, '0'),
        };

        dexesList.push(dexKey);
      }

      // Convert DexKeys to PoolParams with dexId
      this.pools = dexesList.map(dexKey => {
        const dexId = this.calculateDexId(dexKey);
        return {
          dexId,
          dexKey,
        };
      });

      this.logger.info(`FluidDexLite: Loaded ${this.pools.length} dex pools`);
    } catch (error) {
      this.logger.error('FluidDexLite: Failed to load dexes list', error);
      throw error;
    }
  }

  // Initialize event pools for tracking state changes
  private async initializeEventPools(blockNumber: number): Promise<void> {
    for (const pool of this.pools) {
      try {
        const mapKey = `${pool.dexKey.token0}_${pool.dexKey.token1}_${pool.dexKey.salt}`;

        const eventPool = new FluidDexLiteEventPool(
          this.dexKey,
          this.network,
          this.dexHelper,
          this.logger,
          mapKey,
          this.fluidDexLiteIface,
          pool,
          this.dexLiteAddress,
        );

        await eventPool.initialize(blockNumber);
        this.eventPools[mapKey] = eventPool;

        this.logger.debug(`FluidDexLite: Initialized event pool for ${mapKey}`);
      } catch (error) {
        this.logger.error(
          `FluidDexLite: Failed to initialize event pool for ${pool.dexId}`,
          error,
        );
        this.eventPools[
          `${pool.dexKey.token0}_${pool.dexKey.token1}_${pool.dexKey.salt}`
        ] = null;
      }
    }
  }

  // Helper function to calculate dexId like in Solidity: bytes8(keccak256(abi.encode(dexKey)))
  private calculateDexId(dexKey: DexKey): string {
    const encoded = defaultAbiCoder.encode(
      ['address', 'address', 'bytes32'],
      [dexKey.token0, dexKey.token1, dexKey.salt],
    );
    const hash = keccak256(encoded);
    // Take first 8 bytes (16 hex chars)
    return '0x' + hash.slice(2, 18);
  }

  // Helper function to get pool by token addresses
  private getPoolForTokens(
    srcToken: Address,
    destToken: Address,
  ): PoolParams | null {
    const srcAddr = srcToken.toLowerCase();
    const destAddr = destToken.toLowerCase();

    return (
      this.pools.find(pool => {
        const token0 = pool.dexKey.token0.toLowerCase();
        const token1 = pool.dexKey.token1.toLowerCase();
        return (
          (token0 === srcAddr && token1 === destAddr) ||
          (token0 === destAddr && token1 === srcAddr)
        );
      }) || null
    );
  }

  // Helper function to get event pool
  private getEventPool(pool: PoolParams): FluidDexLiteEventPool | null {
    const mapKey = `${pool.dexKey.token0}_${pool.dexKey.token1}_${pool.dexKey.salt}`;
    return this.eventPools[mapKey] || null;
  }

  // Get estimated gas cost for a swap
  private getGasCost(): number {
    // Default gas cost estimate for FluidDexLite swaps
    // This should be calibrated based on actual gas usage
    return 10000;
  }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes.
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const pool = this.getPoolForTokens(srcToken.address, destToken.address);
    if (!pool) {
      return [];
    }

    // Check if pool has liquidity
    const eventPool = this.getEventPool(pool);
    if (!eventPool) {
      return [];
    }

    try {
      const state = eventPool.getState(blockNumber);
      if (!state) {
        return [];
      }

      // Check if pool has sufficient liquidity
      if (state.dexVariables === 0n) {
        return [];
      }

      return [`${this.dexKey}_${pool.dexId}`];
    } catch (error) {
      this.logger.debug(
        `FluidDexLite: Error getting pool state for ${pool.dexId}`,
        error,
      );
      return [];
    }
  }

  // Returns pool prices for amounts.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<FluidDexLiteData>> {
    try {
      const pool = this.getPoolForTokens(srcToken.address, destToken.address);
      if (!pool) {
        return null;
      }

      const poolIdentifier = `${this.dexKey}_${pool.dexId}`;

      // Check if this pool is in limitPools if specified
      if (limitPools && !limitPools.includes(poolIdentifier)) {
        return null;
      }

      const eventPool = this.getEventPool(pool);
      if (!eventPool) {
        return null;
      }

      const state = eventPool.getState(blockNumber);
      if (!state) {
        return null;
      }

      // Check if pool has sufficient liquidity
      if (state.dexVariables === 0n) {
        return null;
      }

      // Determine swap direction
      const swap0To1 =
        pool.dexKey.token0.toLowerCase() === srcToken.address.toLowerCase();

      // Calculate prices using the math library
      const prices: bigint[] = [0n]; // First element is always 0
      const gasCost: number[] = [0]; // First element is always 0

      for (let i = 1; i < amounts.length; i++) {
        try {
          const result = calculateSwap(
            state,
            pool.dexKey,
            pool.dexId,
            swap0To1,
            amounts[i],
            side,
          );

          const outputAmount =
            side === SwapSide.SELL ? result.amountOut : result.amountIn;
          prices.push(outputAmount);
          gasCost.push(this.getGasCost()); // Use a default gas cost
        } catch (error) {
          // If calculation fails for this amount, return 0
          this.logger.debug(
            `FluidDexLite: Error calculating swap for amount ${amounts[i]}`,
            error,
          );
          prices.push(0n);
          gasCost.push(0);
        }
      }

      // Get unit amount (1 token with proper decimals)
      const unitAmount =
        10n **
        BigInt(side === SwapSide.SELL ? srcToken.decimals : destToken.decimals);
      let unit = 0n;

      try {
        const unitResult = calculateSwap(
          state,
          pool.dexKey,
          pool.dexId,
          swap0To1,
          unitAmount,
          side,
        );
        unit =
          side === SwapSide.SELL ? unitResult.amountOut : unitResult.amountIn;
      } catch (error) {
        this.logger.debug('FluidDexLite: Error calculating unit price', error);
      }

      const data: FluidDexLiteData = {
        exchange: this.dexLiteAddress,
        dexKey: pool.dexKey,
        swap0To1,
      };

      return [
        {
          prices,
          unit,
          gasCost,
          exchange: this.dexKey,
          poolIdentifier,
          data,
          poolAddresses: [this.dexLiteAddress],
        },
      ];
    } catch (error) {
      this.logger.error('FluidDexLite: Error in getPricesVolume', error);
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    poolPrices: PoolPrices<FluidDexLiteData>,
  ): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  // Encode params required by the exchange adapter
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: FluidDexLiteData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  // Step 4: Generate calldata for Augustus to swap through FluidDexLite
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: FluidDexLiteData,
    side: SwapSide,
  ): DexExchangeParam {
    const { dexKey, swap0To1 } = data;

    // Validate that the pool actually exists in our loaded pools
    const pool = this.pools.find(
      p =>
        p.dexKey.token0.toLowerCase() === dexKey.token0.toLowerCase() &&
        p.dexKey.token1.toLowerCase() === dexKey.token1.toLowerCase() &&
        p.dexKey.salt.toLowerCase() === dexKey.salt.toLowerCase(),
    );

    if (!pool) {
      throw new Error(
        `FluidDexLite: Pool not found for tokens ${dexKey.token0}/${dexKey.token1} with salt ${dexKey.salt}`,
      );
    }

    // Validate the swap direction matches the token addresses
    const normalizedSrcToken = srcToken.toLowerCase();
    const normalizedToken0 = dexKey.token0.toLowerCase();
    const normalizedToken1 = dexKey.token1.toLowerCase();

    const expectedSwap0To1 = normalizedSrcToken === normalizedToken0;
    if (swap0To1 !== expectedSwap0To1) {
      throw new Error(
        `FluidDexLite: Swap direction mismatch. Expected swap0To1: ${expectedSwap0To1}, got: ${swap0To1}`,
      );
    }

    // Validate that srcToken and destToken are actually part of this pool
    if (
      (normalizedSrcToken !== normalizedToken0 &&
        normalizedSrcToken !== normalizedToken1) ||
      (destToken.toLowerCase() !== normalizedToken0 &&
        destToken.toLowerCase() !== normalizedToken1)
    ) {
      throw new Error(
        `FluidDexLite: Tokens ${srcToken}/${destToken} are not part of pool ${normalizedToken0}/${normalizedToken1}`,
      );
    }

    // Determine swap amount and limits based on side
    let amountSpecified: string;
    let amountLimit: string;

    if (side === SwapSide.SELL) {
      // Exact input: positive amountSpecified, amountLimit is minimum output
      amountSpecified = srcAmount;
      amountLimit = destAmount;
    } else {
      // Exact output: negative amountSpecified, amountLimit is maximum input
      amountSpecified = `-${destAmount}`;
      amountLimit = srcAmount;
    }

    // Encode swapSingle function call
    const swapData = this.fluidDexLiteIface.encodeFunctionData('swapSingle', [
      dexKey, // DexKey calldata dexKey_
      swap0To1, // bool swap0To1_
      amountSpecified, // int256 amountSpecified_
      amountLimit, // uint256 amountLimit_
      recipient, // address to_
      false, // bool isCallback_ (set to false for now)
      '0x', // bytes calldata callbackData_ (empty)
      '0x', // bytes calldata extraData_ (empty)
    ]);

    return {
      needWrapNative: false, // FluidDexLite can handle ETH directly
      dexFuncHasRecipient: true, // Has to_ parameter for recipient
      exchangeData: swapData, // Encoded swapSingle call
      targetExchange: this.dexLiteAddress, // FluidDexLite contract address
      spender: this.dexLiteAddress, // Approve tokens to FluidDexLite contract
      returnAmountPos: extractReturnAmountPosition(
        this.fluidDexLiteIface,
        'swapSingle',
        'amountUnspecified_',
      ),
    };
  }

  // Legacy compatibility method for SimpleExchange
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: FluidDexLiteData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { dexKey, swap0To1 } = data;

    // Determine swap amount and limits based on side
    let amountSpecified: string;
    let amountLimit: string;

    if (side === SwapSide.SELL) {
      // Exact input: positive amountSpecified, amountLimit is minimum output
      amountSpecified = srcAmount;
      amountLimit = destAmount;
    } else {
      // Exact output: negative amountSpecified, amountLimit is maximum input
      amountSpecified = `-${destAmount}`;
      amountLimit = srcAmount;
    }

    // Encode swapSingle function call with Augustus as recipient
    const swapData = this.fluidDexLiteIface.encodeFunctionData('swapSingle', [
      dexKey, // DexKey calldata dexKey_
      swap0To1, // bool swap0To1_
      amountSpecified, // int256 amountSpecified_
      amountLimit, // uint256 amountLimit_
      this.augustusAddress, // address to_ (Augustus for simple swaps)
      false, // bool isCallback_ (set to false for now)
      '0x', // bytes calldata callbackData_ (empty)
      '0x', // bytes calldata extraData_ (empty)
    ]);

    return {
      callees: [this.dexLiteAddress],
      calldata: [swapData],
      values: ['0'],
      networkFee: '0',
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken.
  async updatePoolState(): Promise<void> {
    // TODO: implement if needed
  }

  // Returns list of top pools based on liquidity.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    try {
      const normalizedTokenAddress = tokenAddress.toLowerCase();
      const relevantPools = this.pools.filter(
        pool =>
          pool.dexKey.token0.toLowerCase() === normalizedTokenAddress ||
          pool.dexKey.token1.toLowerCase() === normalizedTokenAddress,
      );

      const poolLiquidity: PoolLiquidity[] = [];
      const currentBlock =
        await this.dexHelper.web3Provider.eth.getBlockNumber();

      for (const pool of relevantPools.slice(0, limit * 2)) {
        // Fetch more to filter out inactive ones
        const eventPool = this.getEventPool(pool);
        if (!eventPool) continue;

        try {
          const state = eventPool.getState(currentBlock);
          if (!state || state.dexVariables === 0n) {
            // Skip pools with no liquidity
            continue;
          }

          // Unpack dex variables to get token supplies
          const unpackedVars = this.unpackDexVariables(state.dexVariables);

          // Log comprehensive decoded dex variables
          const fullUnpackedVars = fullUnpackDexVariables(state.dexVariables);

          this.logger.info(`\n=== COMPLETE DECODED DEX VARIABLES ===`);
          this.logger.info(`Pool ${pool.dexId}:`);
          this.logger.info(`Raw dexVariables: ${state.dexVariables}`);
          this.logger.info(`\n--- Fee & Revenue ---`);
          this.logger.info(`Fee: ${fullUnpackedVars.fee}`);
          this.logger.info(`Revenue Cut: ${fullUnpackedVars.revenueCut}`);
          this.logger.info(
            `Rebalancing Status: ${fullUnpackedVars.rebalancingStatus}`,
          );
          this.logger.info(`\n--- Center Price ---`);
          this.logger.info(
            `Center Price Shift Active: ${fullUnpackedVars.centerPriceShiftActive}`,
          );
          this.logger.info(`Center Price: ${fullUnpackedVars.centerPrice}`);
          this.logger.info(
            `Center Price Contract Address: ${fullUnpackedVars.centerPriceContractAddress}`,
          );
          this.logger.info(`\n--- Range Percents ---`);
          this.logger.info(
            `Range Percent Shift Active: ${fullUnpackedVars.rangePercentShiftActive}`,
          );
          this.logger.info(`Upper Percent: ${fullUnpackedVars.upperPercent}`);
          this.logger.info(`Lower Percent: ${fullUnpackedVars.lowerPercent}`);
          this.logger.info(`\n--- Threshold Percents ---`);
          this.logger.info(
            `Threshold Percent Shift Active: ${fullUnpackedVars.thresholdPercentShiftActive}`,
          );
          this.logger.info(
            `Upper Shift Threshold Percent: ${fullUnpackedVars.upperShiftThresholdPercent}`,
          );
          this.logger.info(
            `Lower Shift Threshold Percent: ${fullUnpackedVars.lowerShiftThresholdPercent}`,
          );
          this.logger.info(`\n--- Token Information ---`);
          this.logger.info(
            `Token0 Decimals: ${fullUnpackedVars.token0Decimals}`,
          );
          this.logger.info(
            `Token1 Decimals: ${fullUnpackedVars.token1Decimals}`,
          );
          this.logger.info(
            `Token0 Total Supply Adjusted: ${fullUnpackedVars.token0TotalSupplyAdjusted}`,
          );
          this.logger.info(
            `Token1 Total Supply Adjusted: ${fullUnpackedVars.token1TotalSupplyAdjusted}`,
          );
          this.logger.info(`=== END COMPLETE DEX VARIABLES ===\n`);

          // Calculate liquidity based on adjusted total supplies
          // These represent the actual liquidity available in the pool
          const token0Supply = unpackedVars.token0TotalSupplyAdjusted;
          const token1Supply = unpackedVars.token1TotalSupplyAdjusted;

          if (token0Supply === 0n || token1Supply === 0n) {
            // Skip pools with no liquidity
            continue;
          }

          // Get decimals for proper scaling
          const token0Decimals = Number(unpackedVars.token0Decimals);
          const token1Decimals = Number(unpackedVars.token1Decimals);

          // Calculate geometric mean of liquidity as a proxy for USD value
          // Convert to 18 decimal standard for calculation
          const token0LiquidityNormalized =
            token0Supply * 10n ** (18n - BigInt(token0Decimals));
          const token1LiquidityNormalized =
            token1Supply * 10n ** (18n - BigInt(token1Decimals));

          // Simple geometric mean calculation (sqrt(a * b))
          const geometricMeanSquared =
            token0LiquidityNormalized * token1LiquidityNormalized;
          const liquidityUSD = Number(
            this.sqrt(geometricMeanSquared) / 10n ** 18n,
          );

          // Log liquidity result for debugging
          this.logger.debug(
            `Pool ${pool.dexId} liquidity: $${liquidityUSD.toLocaleString()}`,
          );

          // Determine connector token (the other token in the pair)
          const connectorToken =
            pool.dexKey.token0.toLowerCase() === normalizedTokenAddress
              ? {
                  address: pool.dexKey.token1,
                  decimals: token1Decimals,
                }
              : {
                  address: pool.dexKey.token0,
                  decimals: token0Decimals,
                };

          poolLiquidity.push({
            exchange: this.dexKey,
            address: this.dexLiteAddress,
            connectorTokens: [connectorToken],
            liquidityUSD,
          });
        } catch (error) {
          this.logger.debug(
            `FluidDexLite: Error getting liquidity for pool ${pool.dexId}`,
            error,
          );
        }
      }

      // Sort by liquidity and return top pools
      return poolLiquidity
        .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
        .slice(0, limit);
    } catch (error) {
      this.logger.error('FluidDexLite: Error in getTopPoolsForToken', error);
      return [];
    }
  }

  // Helper function to unpack dex variables
  private unpackDexVariables(dexVariables: bigint) {
    return {
      token0Decimals:
        (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_DECIMALS)) &
        X5,
      token1Decimals:
        (dexVariables >> BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_DECIMALS)) &
        X5,
      token0TotalSupplyAdjusted:
        (dexVariables >>
          BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_0_TOTAL_SUPPLY_ADJUSTED)) &
        X60,
      token1TotalSupplyAdjusted:
        (dexVariables >>
          BigInt(BITS_DEX_LITE_DEX_VARIABLES_TOKEN_1_TOTAL_SUPPLY_ADJUSTED)) &
        X60,
    };
  }

  // Simple square root implementation for BigInt
  private sqrt(value: bigint): bigint {
    if (value < 0n) return 0n;
    if (value < 2n) return value;

    let x = value;
    let result = value;

    // Newton's method - simplified for BigInt
    while (x > 0n) {
      x = (result + value / result) / 2n;
      if (x >= result) break;
      result = x;
    }

    return result;
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown.
  releaseResources(): AsyncOrSync<void> {
    // Clean up event pools
    Object.values(this.eventPools).forEach(pool => {
      if (pool) {
        // TODO: implement cleanup if needed
      }
    });
  }
}
