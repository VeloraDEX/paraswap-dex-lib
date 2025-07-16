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
import { SwapSide, Network, ETHER_ADDRESS } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getBigIntPow, getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { ApexDefiData, ApexDefiPoolState } from './types';
import { SimpleExchange } from '../simple-exchange';
import { ApexDefiConfig } from './config';
import { ApexDefiEventPool } from './apex-defi-pool';
import { Interface } from '@ethersproject/abi';
import ApexDefiRouterABI from '../../abi/apex-defi/ApexDefiRouter.abi.json';
import ApexDefiTokenABI from '../../abi/apex-defi/ApexDefiToken.abi.json';
import ApexDefiFactoryABI from '../../abi/apex-defi/ApexDefiFactory.abi.json';
import ApexDefiWrapperFactoryABI from '../../abi/apex-defi/ApexDefiWrapperFactory.abi.json';
import ERC20ABI from '../../abi/erc20.json';
import { ApexDefiFactory, OnPoolCreatedCallback } from './apex-defi-factory';
import { fetchApexDefiOnChainPoolData } from './utils';

export class ApexDefi extends SimpleExchange implements IDex<ApexDefiData> {
  readonly eventPools: Record<string, ApexDefiEventPool | null> = {};
  protected supportedTokensMap: { [address: string]: Token } = {};

  protected readonly factory: ApexDefiFactory;

  readonly routerIface: Interface;
  readonly erc20Iface: Interface;
  readonly tokenIface: Interface;
  readonly factoryIface: Interface;
  readonly wrapperFactoryIface: Interface;

  feeFactor = 10000;

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
    this.wrapperFactoryIface = new Interface(ApexDefiWrapperFactoryABI);
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

    // Check if this is a direct AVAX pair
    const isDirectAVAXPair =
      isETHAddress(srcToken.address) || isETHAddress(destToken.address);

    if (isDirectAVAXPair) {
      // Direct AVAX pair - return single pool
      const pairAddress = this.getPoolAddress(srcToken, destToken);
      return [this.getPoolIdentifier(pairAddress).toLowerCase()];
    } else {
      // Token-to-token swap - return both AVAX pairs
      const avaxToken = {
        address: ETHER_ADDRESS,
        decimals: 18,
      };

      const srcPoolAddress = this.getPoolAddress(srcToken, avaxToken);
      const destPoolAddress = this.getPoolAddress(destToken, avaxToken);

      return [
        this.getPoolIdentifier(srcPoolAddress).toLowerCase(),
        this.getPoolIdentifier(destPoolAddress).toLowerCase(),
      ];
    }
  }

  protected getPoolIdentifier(pairAddress: Address): string {
    return `${this.dexKey}_${pairAddress}`.toLowerCase();
  }

  protected getPoolAddress(srcToken: Token, destToken: Token): string {
    // ✅ Only handle direct AVAX pairs
    const isSrcNative = isETHAddress(srcToken.address);
    const isDestNative = isETHAddress(destToken.address);

    if (isSrcNative) {
      // AVAX → Token: pool address is the token address
      return destToken.address;
    } else if (isDestNative) {
      // Token → AVAX: pool address is the token address
      return srcToken.address;
    } else {
      // ❌ This should never happen for direct pairs
      throw new Error('getPoolAddress called for non-AVAX pair');
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

      const poolIdentifiers = await this.getPoolIdentifiers(
        srcToken,
        destToken,
        side,
        blockNumber,
      );

      // Filter pools based on limitPools if provided
      const validPoolIdentifiers = limitPools
        ? poolIdentifiers.filter(id => limitPools.includes(id))
        : poolIdentifiers;

      if (validPoolIdentifiers.length === 0) {
        return null;
      }

      // Check if this is a direct AVAX pair
      const isDirectAVAXPair =
        isETHAddress(srcToken.address) || isETHAddress(destToken.address);

      if (isDirectAVAXPair) {
        return this.getDirectAVAXPairPrices(
          srcToken,
          destToken,
          amounts,
          side,
          blockNumber,
          validPoolIdentifiers[0],
        );
      } else {
        return this.getCrossPairTokenToTokenPrices(
          srcToken,
          destToken,
          amounts,
          side,
          blockNumber,
          validPoolIdentifiers,
        );
      }
    } catch (e) {
      this.logger.error(`Error_getPricesVolume:`, e);
      return null;
    }
  }

  private async getDirectAVAXPairPrices(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    poolIdentifier: string,
  ): Promise<ExchangePrices<ApexDefiData> | null> {
    const unitAmount = getBigIntPow(
      side === SwapSide.SELL ? srcToken.decimals : destToken.decimals,
    );

    // Get or discover the pool
    let pool = this.eventPools[poolIdentifier];
    if (!pool) {
      pool = await this.discoverPool(srcToken, destToken, blockNumber);
      if (!pool) return null;
    }

    const state = await pool.getStateOrGenerate(blockNumber);
    if (!state) return null;

    const prices = await Promise.all(
      amounts.map(amount => {
        if (amount === 0n) return 0n;
        return side === SwapSide.SELL
          ? this.getSellPrice(state, amount, srcToken, destToken)
          : this.getBuyPrice(state, amount, srcToken, destToken);
      }),
    );

    const unit =
      side === SwapSide.SELL
        ? this.getSellPrice(state, unitAmount, srcToken, destToken)
        : this.getBuyPrice(state, unitAmount, srcToken, destToken);

    return [
      {
        prices,
        unit,
        data: {
          path: [
            {
              tokenIn: srcToken.address.toLowerCase(),
              tokenOut: destToken.address.toLowerCase(),
            },
          ],
        },
        exchange: this.dexKey,
        poolIdentifier,
        gasCost: ApexDefiConfig[this.dexKey][this.network].poolGasCost,
        poolAddresses: [pool.poolAddress],
      },
    ];
  }

  private async getCrossPairTokenToTokenPrices(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    poolIdentifiers: string[],
  ): Promise<ExchangePrices<ApexDefiData> | null> {
    const avaxToken = {
      address: ETHER_ADDRESS,
      decimals: 18,
    };

    // Get both pool states
    const [srcPool, destPool] = await Promise.all([
      this.getOrDiscoverPool(
        srcToken,
        avaxToken,
        blockNumber,
        poolIdentifiers[0],
      ),
      this.getOrDiscoverPool(
        destToken,
        avaxToken,
        blockNumber,
        poolIdentifiers[1],
      ),
    ]);

    if (!srcPool || !destPool) return null;

    const [srcState, destState] = await Promise.all([
      srcPool.getStateOrGenerate(blockNumber),
      destPool.getStateOrGenerate(blockNumber),
    ]);

    if (!srcState || !destState) return null;

    const prices = await Promise.all(
      amounts.map(amount => {
        if (amount === 0n) return 0n;
        return side === SwapSide.SELL
          ? this.calculateCrossPairSellPrice(
              amount,
              srcToken,
              destToken,
              srcState,
              destState,
            )
          : this.calculateCrossPairBuyPrice(
              amount,
              srcToken,
              destToken,
              srcState,
              destState,
            );
      }),
    );

    const unitAmount = getBigIntPow(
      side === SwapSide.SELL ? srcToken.decimals : destToken.decimals,
    );

    const unit =
      side === SwapSide.SELL
        ? this.calculateCrossPairSellPrice(
            unitAmount,
            srcToken,
            destToken,
            srcState,
            destState,
          )
        : this.calculateCrossPairBuyPrice(
            unitAmount,
            srcToken,
            destToken,
            srcState,
            destState,
          );

    const virtualPoolIdentifier =
      `${this.dexKey}_virtual_${srcToken.address}_${destToken.address}`.toLowerCase();

    return [
      {
        prices,
        unit,
        data: {
          path: [
            {
              tokenIn: srcToken.address.toLowerCase(),
              tokenOut: destToken.address.toLowerCase(),
            },
          ],
        },
        exchange: this.dexKey,
        poolIdentifier: virtualPoolIdentifier,
        gasCost: ApexDefiConfig[this.dexKey][this.network].poolGasCost * 1.5,
        poolAddresses: [srcPool.poolAddress, destPool.poolAddress],
      },
    ];
  }

  private async getOrDiscoverPool(
    token: Token,
    avaxToken: Token,
    blockNumber: number,
    poolIdentifier: string,
  ): Promise<ApexDefiEventPool | null> {
    let pool = this.eventPools[poolIdentifier];
    if (!pool) {
      pool = await this.discoverPool(token, avaxToken, blockNumber);
    }
    return pool;
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
    const isSrcToken0 = isETHAddress(srcToken.address);
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
    const isSrcToken0 = isETHAddress(srcToken.address);
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

  private calculateCrossPairSellPrice(
    amountIn: bigint,
    srcToken: Token,
    destToken: Token,
    srcPoolState: ApexDefiPoolState,
    destPoolState: ApexDefiPoolState,
  ): bigint {
    const avaxToken = {
      address: ETHER_ADDRESS,
      decimals: 18,
    };

    // Step 1: Calculate tokenA → AVAX (with fees)
    const avaxReceived = this.getSellPrice(
      srcPoolState,
      amountIn,
      srcToken,
      avaxToken,
    );

    if (avaxReceived === 0n) return 0n;

    // Step 2: Calculate AVAX → tokenB (with fees)
    const finalOutput = this.getSellPrice(
      destPoolState,
      avaxReceived,
      avaxToken,
      destToken,
    );

    return finalOutput;
  }

  private calculateCrossPairBuyPrice(
    amountOut: bigint,
    srcToken: Token,
    destToken: Token,
    srcPoolState: ApexDefiPoolState,
    destPoolState: ApexDefiPoolState,
  ): bigint {
    const avaxToken = {
      address: ETHER_ADDRESS,
      decimals: 18,
    };

    // Step 1: Calculate AVAX → tokenB (reverse with fees)
    const avaxNeeded = this.getBuyPrice(
      destPoolState,
      amountOut,
      avaxToken,
      destToken,
    );

    if (avaxNeeded === 0n) return 0n;

    // Step 2: Calculate tokenA → AVAX (reverse with fees)
    const finalInput = this.getBuyPrice(
      srcPoolState,
      avaxNeeded,
      srcToken,
      avaxToken,
    );

    return finalInput;
  }

  getCalldataGasCost(poolPrices: PoolPrices<ApexDefiData>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> avax
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

    // ✅ Convert native AVAX to WAVAX for router calls
    const routerPath = this.fixPathForRouter(
      path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
    );

    // Determine the swap function based on the side and token types
    let swapFunction: string;
    let swapParams: any[];

    const isSrcAVAX = isETHAddress(srcToken);
    const isDestAVAX = isETHAddress(destToken);

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX -> Token
      swapFunction = 'swapExactAVAXForTokens';
      swapParams = [
        destAmount,
        routerPath, // Use converted path
        recipient,
        Math.floor(Date.now() / 1000) + 300,
      ];
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token -> AVAX
      swapFunction = 'swapExactTokensForAVAX';
      swapParams = [
        srcAmount,
        destAmount,
        routerPath, // Use converted path
        recipient,
        Math.floor(Date.now() / 1000) + 300,
      ];
    } else {
      // Token -> Token
      swapFunction = 'swapExactTokensForTokens';
      swapParams = [
        srcAmount,
        destAmount,
        routerPath, // Use converted path
        recipient,
        Math.floor(Date.now() / 1000) + 300,
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
      returnAmountPos: undefined,
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

    // ✅ Convert native AVAX to WAVAX for router calls
    const routerPath = this.fixPathForRouter(
      path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
    );

    // Determine the swap function based on the token types
    let swapFunction: string;
    let swapParams: any[];

    const isSrcAVAX = isETHAddress(srcToken);
    const isDestAVAX = isETHAddress(destToken);

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX -> Token
      swapFunction = 'swapExactAVAXForTokens';
      swapParams = [
        destAmount,
        routerPath, // Use converted path
        this.augustusAddress, // recipient - will be set by the router
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token -> AVAX
      swapFunction = 'swapExactTokensForAVAX';
      swapParams = [
        srcAmount,
        destAmount,
        routerPath, // Use converted path
        this.augustusAddress, // recipient - will be set by the router
        Math.floor(Date.now() / 1000) + 300, // deadline: 5 minutes from now
      ];
    } else {
      // Token -> Token
      swapFunction = 'swapExactTokensForTokens';
      swapParams = [
        srcAmount,
        destAmount,
        routerPath, // Use converted path
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

      // Check if the input token is AVAX
      const isAVAX = isETHAddress(tokenAddress);

      if (isAVAX) {
        // If asking for AVAX pools, return all tokens that have AVAX pairs
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
        // For non-AVAX tokens, check if they exist as a pool
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

  public fixPathForRouter(path: Address[]): Address[] {
    return path.map(token => {
      // Only convert native AVAX to WAVAX for router calls
      if (token.toLowerCase() === ETHER_ADDRESS.toLowerCase()) {
        return this.dexHelper.config.data.wrappedNativeTokenAddress;
      }
      return token;
    });
  }
}
