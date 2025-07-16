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
  NumberAsString,
  TxInfo,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { ApexDefiData, ApexDefiParam, ApexDefiPoolState } from './types';
import { SimpleExchange } from '../simple-exchange';
import { ApexDefiConfig } from './config';
import { ApexDefiEventPool } from './apex-defi-pool';
import { Interface } from '@ethersproject/abi';
import ApexDefiRouterABI from '../../abi/apex-defi/ApexDefiRouter.abi.json';
import ApexDefiTokenABI from '../../abi/apex-defi/ApexDefiToken.abi.json';
import ApexDefiFactoryABI from '../../abi/apex-defi/ApexDefiFactory.abi.json';
import ERC20ABI from '../../abi/erc20.json';
import { ApexDefiFactory, OnPoolCreatedCallback } from './apex-defi-factory';
import {
  calculateFees,
  fetchApexDefiOnChainPoolData,
  getFactoryAddressForToken,
} from './utils';
import { AddressZero } from '@ethersproject/constants';

export class ApexDefi extends SimpleExchange implements IDex<ApexDefiData> {
  readonly eventPools: Record<string, ApexDefiEventPool | null> = {};
  protected supportedTokensMap: { [address: string]: Token } = {};

  protected readonly factory: ApexDefiFactory;

  readonly routerIface: Interface;
  readonly erc20Iface: Interface;
  readonly tokenIface: Interface;
  readonly factoryIface: Interface;

  feeFactor = 10000;
  DefaultApexDefiPoolGasCost = 90 * 1000;

  readonly hasConstantPriceLargeAmounts = false;

  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(ApexDefiConfig);

  logger: Logger;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
  ) {
    super(dexHelper, dexKey);
    this.routerIface = new Interface(ApexDefiRouterABI);
    this.erc20Iface = new Interface(ERC20ABI);
    this.tokenIface = new Interface(ApexDefiTokenABI);
    this.factoryIface = new Interface(ApexDefiFactoryABI);
    this.logger = dexHelper.getLogger(dexKey + '-' + network);

    this.factory = this.getFactoryInstance();
  }

  protected getFactoryInstance(): ApexDefiFactory {
    return new ApexDefiFactory(
      this.dexHelper,
      this.dexKey,
      ApexDefiConfig[this.dexKey][this.network].factoryAddress,
      this.logger,
      this.onPoolCreated().bind(this),
    );
  }

  protected onPoolCreated(): OnPoolCreatedCallback {
    return async ({ pairAddress, blockNumber }) => {
      const poolKey = this.getPoolIdentifier(pairAddress);
      await this.fetchAndInitPool(pairAddress, blockNumber, poolKey);
      this.logger.info(
        `[onPoolCreated] pool=${poolKey}; pairAddress=${pairAddress} initialized`,
      );
    };
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.factory.initialize(blockNumber);
  }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
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
    if (srcToken.address.toLowerCase() === destToken.address.toLowerCase()) {
      return [];
    }

    const pairAddress = this.getPoolAddress(srcToken, destToken);

    return [this.getPoolIdentifier(pairAddress).toLowerCase()];
  }

  protected getPoolIdentifier(pairAddress: Address): string {
    return `${this.dexKey}_${pairAddress}`.toLowerCase();
  }

  protected getPoolAddress(srcToken: Token, destToken: Token): string {
    // ERC314 pairs are always in the format of WETH/token
    // If the srcToken is WETH, then the pair address is the destToken address
    // Otherwise, the pair address is the srcToken address
    if (this.dexHelper.config.isWETH(srcToken.address)) {
      return destToken.address;
    } else {
      return srcToken.address;
    }
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
  ): Promise<null | ExchangePrices<ApexDefiData>> {
    try {
      const [_srcAddress, _destAddress] = this._getLoweredAddresses(
        srcToken,
        destToken,
      );

      if (_srcAddress === _destAddress) return null;

      const poolIdentifier = await this.getPoolIdentifiers(
        srcToken,
        destToken,
        side,
        blockNumber,
      );

      if (limitPools && limitPools.every(p => p !== poolIdentifier[0])) {
        return null;
      }

      const unitAmount = getBigIntPow(
        side === SwapSide.SELL ? srcToken.decimals : destToken.decimals,
      );

      // Get or discover the pool for this token pair
      let pool = this.eventPools[poolIdentifier[0]];

      if (!pool) {
        // Try to discover the pool
        pool = await this.discoverPool(srcToken, destToken, blockNumber);
        if (!pool) {
          return null;
        }
      }

      // Get the pool state
      const state = await pool.getStateOrGenerate(blockNumber);
      if (!state) {
        return null;
      }

      // Calculate prices using the constant product formula
      const prices = await Promise.all(
        amounts.map(amount => {
          if (amount === 0n) return 0n;

          if (side === SwapSide.SELL) {
            return this.getSellPrice(state, amount, srcToken, destToken);
          } else {
            return this.getBuyPrice(state, amount, srcToken, destToken);
          }
        }),
      );

      const unit =
        side === SwapSide.SELL
          ? this.getSellPrice(state, unitAmount, srcToken, destToken)
          : this.getBuyPrice(state, unitAmount, srcToken, destToken);

      // Prepare the exchange data
      const exchangeData: ApexDefiData = {
        path: [
          {
            tokenIn: srcToken.address.toLowerCase(),
            tokenOut: destToken.address.toLowerCase(),
          },
        ],
      };

      return [
        {
          prices,
          unit,
          data: exchangeData,
          exchange: this.dexKey,
          poolIdentifier: poolIdentifier[0],
          gasCost: this.DefaultApexDefiPoolGasCost,
          poolAddresses: [pool.poolAddress],
        },
      ];
    } catch (e) {
      // if the pool is not found, we need to fallback to rpc
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  /**
   * Discover and add a pool for a given token pair
   * This method is called when a pool is not found in the eventPools map
   */
  private async discoverPool(
    srcToken: Token,
    destToken: Token,
    blockNumber: number,
  ): Promise<ApexDefiEventPool | null> {
    const pairAddress = this.getPoolAddress(srcToken, destToken);
    const poolKey = this.getPoolIdentifier(pairAddress);
    if (this.eventPools[poolKey]) return this.eventPools[poolKey];
    return this.fetchAndInitPool(pairAddress, blockNumber, poolKey);
  }

  /**
   * Calculate the output amount for a sell (exact input) swap
   * Uses the constant product formula: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
   */
  private getSellPrice(
    state: ApexDefiPoolState,
    amountIn: bigint,
    srcToken: Token,
    destToken: Token,
  ): bigint {
    const { reserve0, reserve1, baseSwapRate, tradingFee } = state;

    // Validate state
    if (
      !reserve0 ||
      !reserve1 ||
      baseSwapRate === undefined ||
      tradingFee === undefined
    ) {
      this.logger.warn('Invalid pool state for pricing calculation');
      return 0n;
    }

    // Determine which reserve is for input and which is for output
    const isSrcToken0 = this.dexHelper.config.isWETH(srcToken.address);
    const reserveIn = BigInt(isSrcToken0 ? reserve0 : reserve1);
    const reserveOut = BigInt(isSrcToken0 ? reserve1 : reserve0);

    if (reserveIn === 0n || reserveOut === 0n) return 0n;

    // Apply fees (base swap rate + trading fee)
    const baseSwapRateNum =
      typeof baseSwapRate === 'bigint' ? Number(baseSwapRate) : baseSwapRate;
    const tradingFeeNum =
      typeof tradingFee === 'bigint' ? Number(tradingFee) : tradingFee;
    const totalFee = baseSwapRateNum + tradingFeeNum;

    // Validate fee range
    if (totalFee >= this.feeFactor) {
      this.logger.warn('Invalid fee rate detected');
      return 0n;
    }

    const amountInWithFee = amountIn * BigInt(this.feeFactor - totalFee);

    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * BigInt(this.feeFactor) + amountInWithFee;

    return denominator === 0n ? 0n : numerator / denominator;
  }

  /**
   * Calculate the input amount for a buy (exact output) swap
   * Uses the constant product formula: amountIn = (amountOut * reserveIn * feeFactor) / ((reserveOut - amountOut) * (feeFactor - totalFee))
   */
  private getBuyPrice(
    state: ApexDefiPoolState,
    amountOut: bigint,
    srcToken: Token,
    destToken: Token,
  ): bigint {
    const { reserve0, reserve1, baseSwapRate, tradingFee } = state;

    // Validate state
    if (
      !reserve0 ||
      !reserve1 ||
      baseSwapRate === undefined ||
      tradingFee === undefined
    ) {
      this.logger.warn('Invalid pool state for pricing calculation');
      return 0n;
    }

    // Determine which reserve is for input and which is for output
    const isSrcToken0 = this.dexHelper.config.isWETH(srcToken.address);
    const reserveIn = BigInt(isSrcToken0 ? reserve0 : reserve1);
    const reserveOut = BigInt(isSrcToken0 ? reserve1 : reserve0);

    if (reserveIn === 0n || reserveOut === 0n) return 0n;
    if (amountOut >= reserveOut) return 0n;

    // Apply fees (base swap rate + trading fee)
    const baseSwapRateNum =
      typeof baseSwapRate === 'bigint' ? Number(baseSwapRate) : baseSwapRate;
    const tradingFeeNum =
      typeof tradingFee === 'bigint' ? Number(tradingFee) : tradingFee;
    const totalFee = baseSwapRateNum + tradingFeeNum;

    // Validate fee range
    if (totalFee >= this.feeFactor) {
      this.logger.warn('Invalid fee rate detected');
      return 0n;
    }

    // Use the same formula as UniswapV2: numerator = reserveIn * amountOut * feeFactor
    // denominator = (feeFactor - totalFee) * (reserveOut - amountOut)
    const numerator = reserveIn * amountOut * BigInt(this.feeFactor);
    const denominator =
      (BigInt(this.feeFactor) - BigInt(totalFee)) * (reserveOut - amountOut);

    if (denominator <= 0n) return 0n;
    return numerator === 0n ? 0n : 1n + numerator / denominator;
  }

  getCalldataGasCost(poolPrices: PoolPrices<ApexDefiData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> weth
      CALLDATA_GAS_COST.ADDRESS +
      // ParentStruct -> pools[] header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> pools[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> pools[0]
      CALLDATA_GAS_COST.wordNonZeroBytes(22)
    );
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
    data: ApexDefiData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // TODO: complete me!
    const { path } = data;

    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: ApexDefiConfig[this.dexKey][this.network].routerAddress,
      payload,
      networkFee: '0',
    };
  }

  // Encode params required by the exchange adapter for V6
  // This is the main method used for swaps in V6
  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ApexDefiData,
    side: SwapSide,
  ): DexExchangeParam {
    const { path } = data;

    // Determine the swap function based on the side and token types
    let swapFunction: string;
    let swapParams: any[];

    const isSrcAVAX = this.dexHelper.config.isWETH(srcToken);
    const isDestAVAX = this.dexHelper.config.isWETH(destToken);

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX -> Token
      swapFunction = 'swapExactAVAXForTokens';
      swapParams = [
        destAmount, // amountOutMin - will be set by the router
        path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
        recipient,
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token -> AVAX
      swapFunction = 'swapExactTokensForAVAX';
      swapParams = [
        srcAmount,
        destAmount, // amountOutMin - will be set by the router
        path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
        recipient,
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    } else {
      // Token -> Token
      swapFunction = 'swapExactTokensForTokens';
      swapParams = [
        srcAmount,
        destAmount, // amountOutMin - will be set by the router
        path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
        recipient,
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    }

    const exchangeData = this.routerIface.encodeFunctionData(
      swapFunction,
      swapParams,
    );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: ApexDefiConfig[this.dexKey][this.network].routerAddress,
      returnAmountPos: undefined, // ApexDefi returns amounts array, we'll get the last element
    };
  }

  // Encode params for simple swap (V5)
  async getSimpleParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: ApexDefiData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { path } = data;

    // Determine the swap function based on the token types
    let swapFunction: string;
    let swapParams: any[];

    const isSrcAVAX = this.dexHelper.config.isWETH(srcToken);
    const isDestAVAX = this.dexHelper.config.isWETH(destToken);

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX -> Token
      swapFunction = 'swapExactAVAXForTokens';
      swapParams = [
        destAmount,
        path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
        this.augustusAddress, // recipient - will be set by the router
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token -> AVAX
      swapFunction = 'swapExactTokensForAVAX';
      swapParams = [
        srcAmount,
        destAmount,
        path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
        this.augustusAddress, // recipient - will be set by the router
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    } else {
      // Token -> Token
      swapFunction = 'swapExactTokensForTokens';
      swapParams = [
        srcAmount,
        destAmount,
        path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
        this.augustusAddress, // recipient - will be set by the router
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    }

    const swapData = this.routerIface.encodeFunctionData(
      swapFunction,
      swapParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      ApexDefiConfig[this.dexKey][this.network].routerAddress,
      ApexDefiConfig[this.dexKey][this.network].routerAddress,
      '0',
    );
  }

  // Direct swap methods for V5
  getDirectParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    expectedAmount: NumberAsString,
    data: ApexDefiData,
    side: SwapSide,
    permit: string,
    uuid: string,
    feePercent: NumberAsString,
    deadline: NumberAsString,
    partner: string,
    beneficiary: string,
    contractMethod: string,
  ): TxInfo<null> {
    // ApexDefi doesn't support direct swaps in the same way as UniswapV2
    // This method is not implemented for ApexDefi
    throw new Error('Direct swaps not supported for ApexDefi');
  }

  // Direct swap methods for V6
  getDirectParamV6(
    srcToken: Address,
    destToken: Address,
    fromAmount: NumberAsString,
    toAmount: NumberAsString,
    quotedAmount: NumberAsString,
    data: ApexDefiData,
    side: SwapSide,
    permit: string,
    uuid: string,
    partnerAndFee: string,
    beneficiary: string,
    blockNumber: number,
    contractMethod: string,
  ): TxInfo<null> {
    // ApexDefi doesn't support direct swaps in the same way as UniswapV2
    // This method is not implemented for ApexDefi
    throw new Error('Direct swaps not supported for ApexDefi');
  }

  // Static methods for direct function names
  static getDirectFunctionName(): string[] {
    // ApexDefi doesn't support direct swaps
    return [];
  }

  static getDirectFunctionNameV6(): string[] {
    // ApexDefi doesn't support direct swaps
    return [];
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    // Update all existing pools to their latest state
    const blockNumber = await this.dexHelper.web3Provider.eth.getBlockNumber();

    const poolUpdatePromises = Object.values(this.eventPools).map(
      async pool => {
        if (pool) {
          try {
            await pool.getStateOrGenerate(blockNumber);
          } catch (error) {
            this.logger.error(
              `Error updating pool state for ${pool.poolAddress}:`,
              error,
            );
          }
        }
      },
    );

    await Promise.all(poolUpdatePromises);
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  // ApexDefi is a single pool DEX, so we return the token itself as a pool with AVAX
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    try {
      const blockNumber =
        await this.dexHelper.web3Provider.eth.getBlockNumber();

      // Check if the input token is WAVAX
      const isWAVAX = this.dexHelper.config.isWETH(tokenAddress);

      if (isWAVAX) {
        // If asking for WAVAX pools, return all tokens that have WAVAX pairs
        const tokenAddresses = await this.dexHelper.multiContract.methods
          .aggregate([
            {
              target: ApexDefiConfig[this.dexKey][this.network].factoryAddress,
              callData: this.factoryIface.encodeFunctionData(
                'getAllTokens',
                [],
              ),
            },
          ])
          .call({}, blockNumber);

        const tokens = this.factoryIface.decodeFunctionResult(
          'getAllTokens',
          tokenAddresses.returnData[0],
        )[0] as Address[];

        if (!tokens.length) {
          return [];
        }

        // Get reserves for all tokens (limit to requested limit)
        const reservesCallData = this.tokenIface.encodeFunctionData(
          'getReserves',
          [],
        );
        const multiCall = tokens.map(token => ({
          target: token,
          callData: reservesCallData,
        }));

        const result = await this.dexHelper.multiContract.methods
          .aggregate(multiCall)
          .call({}, blockNumber);

        const pools: PoolLiquidity[] = [];

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          const reserves = this.tokenIface.decodeFunctionResult(
            'getReserves',
            result.returnData[i],
          );

          // If reserves are 0, skip this pool
          if (reserves[0] === 0n && reserves[1] === 0n) {
            continue;
          }

          // Calculate liquidity in USD using getTokenUSDPrice
          const liquidityUSD = await this.dexHelper.getTokenUSDPrice(
            {
              address: this.dexHelper.config.data.wrappedNativeTokenAddress,
              decimals: 18,
            },
            reserves[0], // AVAX reserves in wei
          );

          pools.push({
            exchange: this.dexKey,
            address: token.toLowerCase(),
            poolIdentifier: this.getPoolIdentifier(token),
            connectorTokens: [
              {
                address:
                  this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase(),
                decimals: 18,
              },
            ],
            liquidityUSD,
          });
        }

        // Sort by liquidity and return top pools
        return pools
          .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
          .slice(0, limit);
      } else {
        // For non-WAVAX tokens, check if they exist as a pool
        const tokenInfo = await this.dexHelper.multiContract.methods
          .aggregate([
            {
              target: ApexDefiConfig[this.dexKey][this.network].factoryAddress,
              callData: this.factoryIface.encodeFunctionData(
                'tokenInfoByTokenAddress',
                [tokenAddress],
              ),
            },
            {
              target: tokenAddress,
              callData: this.tokenIface.encodeFunctionData('getReserves', []),
            },
          ])
          .call({}, blockNumber);

        // Decode token info
        const tokenData = this.factoryIface.decodeFunctionResult(
          'tokenInfoByTokenAddress',
          tokenInfo.returnData[0],
        );

        // If name is empty, the token doesn't exist in the factory
        if (!tokenData[0] || tokenData[0] === '') {
          return [];
        }

        // Decode reserves
        const reserves = this.tokenIface.decodeFunctionResult(
          'getReserves',
          tokenInfo.returnData[1],
        );

        // If reserves are 0, the pool has no liquidity
        if (reserves[0] === 0n && reserves[1] === 0n) {
          return [];
        }

        // Calculate liquidity in USD using getTokenUSDPrice
        const liquidityUSD = await this.dexHelper.getTokenUSDPrice(
          {
            address: this.dexHelper.config.data.wrappedNativeTokenAddress,
            decimals: 18,
          },
          reserves[0], // AVAX reserves in wei
        );

        return [
          {
            exchange: this.dexKey,
            address: tokenAddress.toLowerCase(),
            poolIdentifier: this.getPoolIdentifier(tokenAddress),
            connectorTokens: [
              {
                address:
                  this.dexHelper.config.data.wrappedNativeTokenAddress.toLowerCase(),
                decimals: 18,
              },
            ],
            liquidityUSD,
          },
        ];
      }
    } catch (error) {
      // If the call fails, the token doesn't exist as a pool
      this.logger.debug(
        `Token ${tokenAddress} is not a valid ApexDefi pool: ${error}`,
      );
      return [];
    }
  }

  // Shared logic for pool discovery/creation
  private async fetchAndInitPool(
    pairAddress: Address,
    blockNumber: number,
    poolKey: string,
  ): Promise<ApexDefiEventPool | null> {
    try {
      const poolData = await fetchApexDefiOnChainPoolData(
        pairAddress,
        this.network,
        blockNumber,
        this.dexHelper,
        this.tokenIface,
        this.factoryIface,
      );

      const eventPool = new ApexDefiEventPool(
        this.dexKey,
        this.network,
        this.dexHelper,
        this.dexHelper.config.data.wrappedNativeTokenAddress,
        pairAddress,
        pairAddress,
        this.logger,
        poolData.factoryAddress,
      );

      await eventPool.initialize(blockNumber, {
        state: {
          reserve0: poolData.reserve0,
          reserve1: poolData.reserve1,
          baseSwapRate: poolData.baseSwapRate,
          protocolFee: poolData.protocolFee,
          lpFee: poolData.lpFee,
          tradingFee: poolData.tradingFee,
          isLegacy: poolData.isLegacy,
        },
      });

      this.eventPools[poolKey] = eventPool;
      return eventPool;
    } catch (error) {
      this.logger.error('Error fetching/initializing pool:', error);
      return null;
    }
  }

  releaseResources(): AsyncOrSync<void> {
    // Clean up event pools
    Object.values(this.eventPools).forEach(pool => {
      if (pool) {
        pool.releaseResources();
      }
    });

    // Clear the pools map
    Object.keys(this.eventPools).forEach(key => {
      delete this.eventPools[key];
    });

    // Clear supported tokens map
    Object.keys(this.supportedTokensMap).forEach(key => {
      delete this.supportedTokensMap[key];
    });

    // Clean up factory if it has releaseResources
    if (this.factory && this.factory.releaseResources) {
      this.factory.releaseResources();
    }
  }

  protected _getLoweredAddresses(srcToken: Token, destToken: Token) {
    return [srcToken.address.toLowerCase(), destToken.address.toLowerCase()];
  }
}
