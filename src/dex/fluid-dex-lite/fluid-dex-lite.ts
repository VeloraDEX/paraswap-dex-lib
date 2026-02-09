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
import { FluidDexLiteData, DexKey, PoolParams } from './types';
import { sqrt, unpackDexVariables } from './fluid-dex-lite-math';
import { SimpleExchange } from '../simple-exchange';
import { FluidDexLiteConfig } from './config';
import { FluidDexLiteEventPool } from './fluid-dex-lite-pool';
import FluidDexLiteABI from '../../abi/fluid-dex-lite/FluidDexLite.abi.json';
import { Interface } from '@ethersproject/abi';
import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256 } from 'web3-utils';
import { calculateSwap } from './fluid-dex-lite-math';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BI_POWS } from '../../bigint-constants';
import { calculateDexId, encodeSlot, readFromStorageCall } from './utils';

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
      const [lengthResult] =
        await this.dexHelper.multiWrapper.tryAggregate<bigint>(
          false,
          [
            readFromStorageCall(
              this.dexLiteAddress,
              this.fluidDexLiteIface,
              encodeSlot(DEX_LITE_DEXES_LIST_SLOT),
            ),
          ],
          blockNumber,
        );

      const arrayLength = Number(lengthResult.returnData);

      if (arrayLength === 0) {
        this.logger.info(`${this.dexKey}: No dex pools found in _dexesList`);
        return;
      }

      const arrayBaseSlot = keccak256(
        defaultAbiCoder.encode(['uint256'], [DEX_LITE_DEXES_LIST_SLOT]),
      );

      const callDataList: ReturnType<typeof readFromStorageCall>[] = [];
      for (let i = 0; i < arrayLength; i++) {
        const baseIndex = BigInt(arrayBaseSlot) + BigInt(i * 3);
        callDataList.push(
          readFromStorageCall(
            this.dexLiteAddress,
            this.fluidDexLiteIface,
            encodeSlot(baseIndex),
          ), // token0
          readFromStorageCall(
            this.dexLiteAddress,
            this.fluidDexLiteIface,
            encodeSlot(baseIndex + 1n),
          ), // token1
          readFromStorageCall(
            this.dexLiteAddress,
            this.fluidDexLiteIface,
            encodeSlot(baseIndex + 2n),
          ), // salt
        );
      }

      const results = await this.dexHelper.multiWrapper.tryAggregate<bigint>(
        false,
        callDataList,
        blockNumber,
        this.dexHelper.multiWrapper.defaultBatchSize,
        false,
      );

      const dexesList: DexKey[] = [];
      for (let i = 0; i < arrayLength; i++) {
        const resultIndex = i * 3;
        if (resultIndex + 2 >= results.length) {
          this.logger.warn(
            `${this.dexKey}: Missing results for pool ${i}, skipping`,
          );
          continue;
        }

        const token0 = results[resultIndex].returnData;
        const token1 = results[resultIndex + 1].returnData;
        const salt = results[resultIndex + 2].returnData;

        if (token0 === 0n || token1 === 0n) {
          this.logger.debug(
            `${this.dexKey}: Invalid token addresses for pool ${i}, skipping`,
          );
          continue;
        }

        dexesList.push({
          token0: '0x' + token0.toString(16).padStart(40, '0'),
          token1: '0x' + token1.toString(16).padStart(40, '0'),
          salt: '0x' + salt.toString(16).padStart(64, '0'),
        });
      }

      this.pools = dexesList.map(dexKey => ({
        dexId: calculateDexId(dexKey),
        dexKey,
      }));

      this.logger.info(`${this.dexKey}: Loaded ${this.pools.length} dex pools`);
    } catch (error) {
      this.logger.error(`${this.dexKey}: Failed to load dexes list`, error);
      throw error;
    }
  }

  // Initialize event pools for tracking state changes
  private async initializeEventPools(
    blockNumber: number,
    subscribe = true,
  ): Promise<void> {
    for (const pool of this.pools) {
      const mapKey =
        `${pool.dexKey.token0}_${pool.dexKey.token1}_${pool.dexKey.salt}`.toLowerCase();

      try {
        let eventPool = this.eventPools[mapKey];

        if (!eventPool) {
          eventPool = new FluidDexLiteEventPool(
            this.dexKey,
            this.network,
            this.dexHelper,
            this.logger,
            mapKey,
            this.fluidDexLiteIface,
            pool,
            this.dexLiteAddress,
          );
          this.eventPools[mapKey] = eventPool;
        }

        if (subscribe) {
          await eventPool.initialize(blockNumber);
        } else {
          const state = await eventPool.generateState(blockNumber);
          eventPool.setState(state, blockNumber);
        }

        this.logger.debug(
          `${this.dexKey}: Initialized event pool for ${mapKey}`,
        );
      } catch (error) {
        this.eventPools[mapKey] = null;
        this.logger.error(
          `${this.dexKey}: Failed to initialize event pool for ${pool.dexId}, ${error}`,
        );
      }
    }
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
    const mapKey =
      `${pool.dexKey.token0}_${pool.dexKey.token1}_${pool.dexKey.salt}`.toLowerCase();
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

      return [`${this.dexKey}_${pool.dexId}`.toLowerCase()];
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
      if (limitPools && !limitPools.length) return [];
      const pool = this.getPoolForTokens(srcToken.address, destToken.address);
      if (!pool) return null;

      const poolIdentifier = `${this.dexKey}_${pool.dexId}`.toLowerCase();
      if (limitPools?.length && !limitPools.includes(poolIdentifier))
        return null;

      const eventPool = this.getEventPool(pool);
      const state = eventPool?.getState(blockNumber);
      if (!state || state.dexVariables === 0n) return null;

      const swap0To1 =
        pool.dexKey.token0.toLowerCase() === srcToken.address.toLowerCase();

      // Initialize result arrays with zero for index 0
      const prices: bigint[] = [0n];
      const gasCost: number[] = [0];

      // Compute swap results for all amounts (except the 0th)
      for (let i = 1; i < amounts.length; i++) {
        try {
          const { amountIn, amountOut } = calculateSwap(
            state,
            swap0To1,
            amounts[i],
            side,
          );
          prices.push(side === SwapSide.SELL ? amountOut : amountIn);
          gasCost.push(this.getGasCost());
        } catch (err) {
          this.logger.error(
            `${this.dexKey}: Error calculating swap for amount ${amounts[i]}`,
            err,
          );
          prices.push(0n);
          gasCost.push(0);
        }
      }

      // Get unit amount (1 token with proper decimals)
      const unitAmount =
        BI_POWS[
          side === SwapSide.SELL ? srcToken.decimals : destToken.decimals
        ];
      let unit = 0n;

      try {
        const { amountIn, amountOut } = calculateSwap(
          state,
          swap0To1,
          unitAmount,
          side,
        );
        unit = side === SwapSide.SELL ? amountOut : amountIn;
      } catch (err) {
        this.logger.debug(`${this.dexKey}: Error calculating unit price`, err);
      }

      return [
        {
          prices,
          unit,
          gasCost,
          exchange: this.dexKey,
          poolIdentifiers: [poolIdentifier],
          data: {
            exchange: this.dexLiteAddress,
            dexKey: pool.dexKey,
            swap0To1,
          },
          poolAddresses: [this.dexLiteAddress],
        },
      ];
    } catch (error) {
      this.logger.error(`${this.dexKey}: Error in getPricesVolume`, error);
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
    const { token0, token1, salt } = dexKey;

    const [t0, t1, s] = [token0, token1, salt].map(t => t.toLowerCase());
    const [src, dest] = [srcToken, destToken].map(t => t.toLowerCase());

    // Ensure the pool exists
    const poolExists = this.pools.some(
      p =>
        p.dexKey.token0.toLowerCase() === t0 &&
        p.dexKey.token1.toLowerCase() === t1 &&
        p.dexKey.salt.toLowerCase() === s,
    );
    if (!poolExists) {
      throw new Error(
        `${this.dexKey}: Pool not found for tokens ${token0}/${token1} with salt ${salt}`,
      );
    }

    // Validate the swap direction matches the token addresses
    if (swap0To1 !== (src === t0)) {
      throw new Error(
        `${this.dexKey}: Swap direction mismatch. Expected swap0To1: ${
          src === t0
        }, got: ${swap0To1}`,
      );
    }

    // Validate that srcToken and destToken are actually part of this pool
    if (![t0, t1].includes(src) || ![t0, t1].includes(dest)) {
      throw new Error(
        `${this.dexKey}: Tokens ${srcToken}/${destToken} are not part of pool ${token0}/${token1}`,
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
      needWrapNative: this.needWrapNative, // FluidDexLite can handle ETH directly
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

  async updatePoolState() {
    const currentBlock = await this.dexHelper.web3Provider.eth.getBlockNumber();
    await this.loadDexesList(currentBlock);
    await this.initializeEventPools(currentBlock, false);
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

      for (const pool of relevantPools.slice(0, limit * 2)) {
        // Fetch more to filter out inactive ones
        const eventPool = this.getEventPool(pool);
        if (!eventPool) continue;

        try {
          const state = eventPool.getStaleState();
          if (!state || state.dexVariables === 0n) {
            // Skip pools with no liquidity
            continue;
          }

          // Unpack dex variables to get token supplies
          const unpackedVars = unpackDexVariables(state.dexVariables);

          // Calculate liquidity based on adjusted total supplies
          // These represent the actual liquidity available in the pool
          const token0Supply = unpackedVars.token0TotalSupplyAdjusted;
          const token1Supply = unpackedVars.token1TotalSupplyAdjusted;

          if (token0Supply === 0n || token1Supply === 0n) {
            // Skip pools with no liquidity
            continue;
          }

          // Get decimals for proper scaling
          const token0Decimals = BigInt(unpackedVars.token0Decimals);
          const token1Decimals = BigInt(unpackedVars.token1Decimals);

          // Calculate geometric mean of liquidity as a proxy for USD value
          // tokenSupply is scaled to 9 decimals for all tokens
          const token0LiquidityNormalized =
            (token0Supply * 10n ** token0Decimals) / 10n ** 9n;

          const token1LiquidityNormalized =
            (token1Supply * 10n ** token1Decimals) / 10n ** 9n;

          const token0LiquidityUSD =
            token0LiquidityNormalized / 10n ** token0Decimals;

          const token1LiquidityUSD =
            token1LiquidityNormalized / 10n ** token1Decimals;

          // Determine connector token (the other token in the pair)
          const connectorToken =
            pool.dexKey.token0.toLowerCase() === normalizedTokenAddress
              ? {
                  address: pool.dexKey.token1,
                  decimals: Number(token1Decimals),
                  liquidityUSD: Number(token1LiquidityUSD),
                }
              : {
                  address: pool.dexKey.token0,
                  decimals: Number(token0Decimals),
                  liquidityUSD: Number(token0LiquidityUSD),
                };

          poolLiquidity.push({
            exchange: this.dexKey,
            address: this.dexLiteAddress,
            connectorTokens: [connectorToken],
            liquidityUSD:
              pool.dexKey.token0.toLowerCase() === normalizedTokenAddress
                ? Number(token0LiquidityUSD)
                : Number(token1LiquidityUSD),
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
}
