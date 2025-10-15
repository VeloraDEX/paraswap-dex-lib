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
import ApexDefiWrapperABI from '../../abi/apex-defi/ApexDefiWrapper.abi.json';
import ERC20ABI from '../../abi/erc20.json';
import { ApexDefiFactory, OnPoolCreatedCallback } from './apex-defi-factory';
import { fetchApexDefiOnChainPoolData } from './utils';
import {
  ApexDefiWrapperFactory,
  OnWrapperCreatedCallback,
} from './apex-defi-wrapper-factory';
import { getLocalDeadlineAsFriendlyPlaceholder } from '../simple-exchange';

export class ApexDefi extends SimpleExchange implements IDex<ApexDefiData> {
  readonly eventPools: Record<string, ApexDefiEventPool | null> = {};
  protected supportedTokensMap: { [address: string]: Token } = {};

  protected readonly factory: ApexDefiFactory;
  protected readonly wrapperFactory: ApexDefiWrapperFactory;

  readonly routerIface: Interface;
  readonly erc20Iface: Interface;
  readonly tokenIface: Interface;
  readonly factoryIface: Interface;
  readonly wrapperFactoryIface: Interface;
  readonly wrapperIface: Interface;

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
    this.wrapperIface = new Interface(ApexDefiWrapperABI);
    this.logger = dexHelper.getLogger(dexKey + '-' + network);

    this.factory = this.getFactoryInstance();
    this.wrapperFactory = this.getWrapperFactoryInstance();
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

  protected getWrapperFactoryInstance(): ApexDefiWrapperFactory {
    return new ApexDefiWrapperFactory(
      this.dexHelper,
      this.dexKey,
      ApexDefiConfig[this.dexKey][this.network].wrapperFactoryAddress,
      this.logger,
      this.onWrapperCreated().bind(this),
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

  protected onWrapperCreated(): OnWrapperCreatedCallback {
    return async ({ wrapperInfo, blockNumber }) => {
      this.logger.info(
        `[onWrapperCreated] wrapper=${wrapperInfo.wrapperAddress}; originalToken=${wrapperInfo.originalToken}; wrappedToken=${wrapperInfo.wrappedToken} initialized`,
      );
    };
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    await this.factory.initialize(blockNumber);
    await this.wrapperFactory.initialize(blockNumber);
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

    // Check if tokens are wrappers and get their underlying tokens
    const srcTokenToUse = this.getERC314Token(srcToken.address);
    const destTokenToUse = this.getERC314Token(destToken.address);

    // Check if this is a direct AVAX pair
    const isDirectAVAXPair =
      isETHAddress(srcTokenToUse.address) ||
      isETHAddress(destTokenToUse.address);

    if (isDirectAVAXPair) {
      // Direct AVAX pair - return single pool
      const pairAddress = this.getPoolAddress(srcTokenToUse, destTokenToUse);
      const poolIdentifier = this.getPoolIdentifier(pairAddress).toLowerCase();
      return [poolIdentifier];
    } else {
      // Token-to-token swap - return both AVAX pairs
      const avaxToken = {
        address: ETHER_ADDRESS,
        decimals: 18,
      };

      const srcPoolAddress = this.getPoolAddress(srcTokenToUse, avaxToken);
      const destPoolAddress = this.getPoolAddress(destTokenToUse, avaxToken);

      const srcPoolIdentifier =
        this.getPoolIdentifier(srcPoolAddress).toLowerCase();
      const destPoolIdentifier =
        this.getPoolIdentifier(destPoolAddress).toLowerCase();

      return [srcPoolIdentifier, destPoolIdentifier];
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
    // Buy side is not supported for ApexDefi yet
    // Commenting this out... seems to be working fine via tests?
    // if (side === SwapSide.BUY) return null;

    try {
      // ✅ Check if this is a wrapper/unwrap operation
      const isWrapperOperation = this.isWrapperOperation(srcToken, destToken);

      if (isWrapperOperation) {
        return this.getWrapperPrices(srcToken, destToken, amounts, side);
      }

      const [_srcAddress, _destAddress] = this._getLoweredAddresses(
        srcToken,
        destToken,
      );

      if (_srcAddress === _destAddress) {
        return null;
      }

      // Get underlying ERC314 tokens for pool discovery and pricing
      const srcTokenERC314 = this.getERC314Token(srcToken.address);
      const destTokenERC314 = this.getERC314Token(destToken.address);

      const poolIdentifiers = await this.getPoolIdentifiers(
        srcTokenERC314,
        destTokenERC314,
        side,
        blockNumber,
      );

      // Filter pools based on limitPools if provided
      const validPoolIdentifiers = limitPools
        ? poolIdentifiers.filter(id => limitPools.includes(id))
        : poolIdentifiers;

      if (validPoolIdentifiers.length === 0) {
        this.logger.warn(
          `No valid pool identifiers found for ${srcToken.address} -> ${destToken.address}`,
        );
        return null;
      }

      // Check if this is a direct AVAX pair
      const isDirectAVAXPair =
        isETHAddress(srcTokenERC314.address) ||
        isETHAddress(destTokenERC314.address);

      if (isDirectAVAXPair) {
        return this.getDirectAVAXPairPrices(
          srcTokenERC314,
          destTokenERC314,
          amounts,
          side,
          blockNumber,
          validPoolIdentifiers[0],
          srcToken,
          destToken,
        );
      } else {
        return this.getCrossPairTokenToTokenPrices(
          srcTokenERC314,
          destTokenERC314,
          amounts,
          side,
          blockNumber,
          validPoolIdentifiers,
          srcToken,
          destToken,
        );
      }
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume ${srcToken.symbol || srcToken.address}, ${
          destToken.symbol || destToken.address
        }, ${side}:`,
        e,
      );
      return null;
    }
  }

  private async getDirectAVAXPairPrices(
    srcTokenERC314: Token,
    destTokenERC314: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    poolIdentifier: string,
    originalSrcToken: Token,
    originalDestToken: Token,
  ): Promise<ExchangePrices<ApexDefiData> | null> {
    try {
      // Get or discover the pool
      let pool = this.eventPools[poolIdentifier];
      if (!pool) {
        pool = await this.discoverPool(
          srcTokenERC314,
          destTokenERC314,
          blockNumber,
        );
        if (!pool) {
          this.logger.warn(`Failed to discover pool for ${poolIdentifier}`);
          return null;
        }
      }

      const state = await pool.getStateOrGenerate(blockNumber);
      if (!state) {
        this.logger.warn(`Failed to get pool state for ${poolIdentifier}`);
        return null;
      }

      if (!state.tradingEnabled) {
        this.logger.warn(`Pool ${poolIdentifier} is not trading`);
        return null;
      }

      const { prices, unit } = await this.calculatePrices(
        amounts,
        side,
        originalSrcToken,
        originalDestToken,
        async amount =>
          side === SwapSide.SELL
            ? this.getSellPrice(state, amount, srcTokenERC314, destTokenERC314)
            : this.getBuyPrice(state, amount, srcTokenERC314, destTokenERC314),
        async unitAmount =>
          side === SwapSide.SELL
            ? this.getSellPrice(
                state,
                unitAmount,
                srcTokenERC314,
                destTokenERC314,
              )
            : this.getBuyPrice(
                state,
                unitAmount,
                srcTokenERC314,
                destTokenERC314,
              ),
      );

      const isERC314Pair =
        !this.wrapperFactory.getWrapperByOriginalToken(
          originalSrcToken.address,
        ) &&
        !this.wrapperFactory.getWrapperByOriginalToken(
          originalDestToken.address,
        );

      return [
        {
          prices,
          unit,
          data: {
            path: [
              {
                tokenIn: originalSrcToken.address.toLowerCase(),
                tokenOut: originalDestToken.address.toLowerCase(),
              },
            ],
            swapType: isERC314Pair ? 'direct' : 'router',
          },
          exchange: this.dexKey,
          poolIdentifiers: [poolIdentifier],
          gasCost: ApexDefiConfig[this.dexKey][this.network].poolGasCost,
          poolAddresses: [pool.poolAddress],
        },
      ];
    } catch (e) {
      this.logger.error(
        `Error in getDirectAVAXPairPrices for ${poolIdentifier}:`,
        e,
      );
      return null;
    }
  }

  private async getCrossPairTokenToTokenPrices(
    srcTokenERC314: Token,
    destTokenERC314: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    poolIdentifiers: string[],
    originalSrcToken: Token,
    originalDestToken: Token,
  ): Promise<ExchangePrices<ApexDefiData> | null> {
    const avaxToken = { address: ETHER_ADDRESS, decimals: 18 };

    // Get both pool states
    const [srcPool, destPool] = await Promise.all([
      this.getOrDiscoverPool(
        srcTokenERC314,
        avaxToken,
        blockNumber,
        poolIdentifiers[0],
      ),
      this.getOrDiscoverPool(
        destTokenERC314,
        avaxToken,
        blockNumber,
        poolIdentifiers[1],
      ),
    ]);

    if (!srcPool || !destPool) {
      return null;
    }

    const [srcState, destState] = await Promise.all([
      srcPool.getStateOrGenerate(blockNumber),
      destPool.getStateOrGenerate(blockNumber),
    ]);

    if (!srcState || !destState) {
      return null;
    }

    if (!srcState.tradingEnabled || !destState.tradingEnabled) {
      this.logger.warn('Pool is not trading');
      return null;
    }

    const { prices, unit } = await this.calculatePrices(
      amounts,
      side,
      originalSrcToken,
      originalDestToken,
      async amount =>
        side === SwapSide.SELL
          ? this.calculateCrossPairSellPrice(
              amount,
              srcTokenERC314,
              destTokenERC314,
              srcState,
              destState,
            )
          : this.calculateCrossPairBuyPrice(
              amount,
              srcTokenERC314,
              destTokenERC314,
              srcState,
              destState,
            ),
      async unitAmount =>
        side === SwapSide.SELL
          ? this.calculateCrossPairSellPrice(
              unitAmount,
              srcTokenERC314,
              destTokenERC314,
              srcState,
              destState,
            )
          : this.calculateCrossPairBuyPrice(
              unitAmount,
              srcTokenERC314,
              destTokenERC314,
              srcState,
              destState,
            ),
    );

    const virtualPoolIdentifier =
      `${this.dexKey}_virtual_${srcTokenERC314.address}_${destTokenERC314.address}`.toLowerCase();

    return [
      {
        prices,
        unit,
        data: {
          path: [
            {
              tokenIn: originalSrcToken.address.toLowerCase(),
              tokenOut: ETHER_ADDRESS.toLowerCase(),
            },
            {
              tokenIn: ETHER_ADDRESS.toLowerCase(),
              tokenOut: originalDestToken.address.toLowerCase(),
            },
          ],
          swapType: 'router',
        },
        exchange: this.dexKey,
        poolIdentifiers: [virtualPoolIdentifier],
        gasCost: ApexDefiConfig[this.dexKey][this.network].poolGasCost * 2,
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

    if (this.eventPools[poolKey]) {
      return this.eventPools[poolKey];
    }

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
    const { reserve0, reserve1, baseSwapRate, tradingFee, tradingEnabled } =
      state;

    if (!tradingEnabled) {
      this.logger.warn('Pool is not trading');
      return 0n;
    }

    // Validate state
    if (
      reserve0 == null ||
      reserve1 == null ||
      baseSwapRate == null ||
      tradingFee == null
    ) {
      this.logger.warn('Invalid pool state for pricing calculation');
      return 0n;
    }

    // Determine which reserve is for input and which is for output
    const isSrcToken0 = isETHAddress(srcToken.address);
    const reserveIn = BigInt(isSrcToken0 ? reserve0 : reserve1);
    const reserveOut = BigInt(isSrcToken0 ? reserve1 : reserve0);

    if (reserveIn === 0n || reserveOut === 0n) return 0n;

    const totalFee = baseSwapRate + tradingFee;

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
    const { reserve0, reserve1, baseSwapRate, tradingFee, tradingEnabled } =
      state;

    if (!tradingEnabled) {
      this.logger.warn('Pool is not trading');
      return 0n;
    }

    // Validate state
    if (
      reserve0 == null ||
      reserve1 == null ||
      baseSwapRate == null ||
      tradingFee == null
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

    const totalFee = baseSwapRate + tradingFee;

    // Validate fee range
    if (totalFee >= this.feeFactor) {
      this.logger.warn('Invalid fee rate detected');
      return 0n;
    }

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

    if (!srcPoolState.tradingEnabled || !destPoolState.tradingEnabled) {
      this.logger.warn('Pool is not trading');
      return 0n;
    }

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

    if (!srcPoolState.tradingEnabled || !destPoolState.tradingEnabled) {
      this.logger.warn('Pool is not trading');
      return 0n;
    }

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

  // Common pricing logic for both direct and cross-pair swaps
  private async calculatePrices(
    amounts: bigint[],
    side: SwapSide,
    originalSrcToken: Token,
    originalDestToken: Token,
    priceCalculator: (amount: bigint) => Promise<bigint>,
    unitCalculator: (unitAmount: bigint) => Promise<bigint>,
  ): Promise<{ prices: bigint[]; unit: bigint }> {
    // Convert input amounts to ERC314 decimals (18) for internal calculations
    const erc314Amounts = this.convertAmountsToERC314(
      amounts,
      side === SwapSide.SELL
        ? originalSrcToken.decimals
        : originalDestToken.decimals,
    );

    // Calculate prices in ERC314 space (18 decimals)
    const erc314Prices = await Promise.all(
      erc314Amounts.map(amount => {
        if (amount === 0n) return 0n;
        return priceCalculator(amount);
      }),
    );

    // Convert prices back to original token decimals
    const finalPrices = this.convertPricesFromERC314(
      erc314Prices,
      side === SwapSide.SELL
        ? originalDestToken.decimals
        : originalSrcToken.decimals,
    );

    // Calculate unit price
    const unitAmount = getBigIntPow(
      side === SwapSide.SELL
        ? originalSrcToken.decimals
        : originalDestToken.decimals,
    );
    const erc314UnitAmount = this.convertAmountToERC314(
      unitAmount,
      side === SwapSide.SELL
        ? originalSrcToken.decimals
        : originalDestToken.decimals,
      18,
    );

    const erc314Unit = await unitCalculator(erc314UnitAmount);

    const finalUnit = this.convertAmountFromERC314(
      erc314Unit,
      18,
      side === SwapSide.SELL
        ? originalDestToken.decimals
        : originalSrcToken.decimals,
    );

    return { prices: finalPrices, unit: finalUnit };
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
    // ✅ Handle wrapper operations
    if (data.swapType === 'wrapper') {
      return this.getWrapperSwap(
        srcToken,
        destToken,
        srcAmount,
        destAmount,
        recipient,
        data,
      );
    }

    if (data.swapType === 'direct') {
      return this.getDirectTokenSwap(
        data.path[0].tokenIn,
        data.path[0].tokenOut,
        srcAmount,
        destAmount,
      );
    } else {
      return this.getRouterSwap(srcAmount, destAmount, recipient, data);
    }
  }

  private getDirectTokenSwap(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
  ): DexExchangeParam {
    const isSrcAVAX = isETHAddress(srcToken);
    const isDestAVAX = isETHAddress(destToken);

    let swapFunction: string;
    let swapParams: any[];
    let targetExchange: Address;

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX → Token: call swapNativeToToken on the token
      swapFunction = 'swapNativeToToken';
      swapParams = [
        destAmount, // minimumTokensOut
        getLocalDeadlineAsFriendlyPlaceholder(), // deadline
      ];
      targetExchange = destToken; // Call directly on the token
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token → AVAX: call swapTokenToNative on the token
      swapFunction = 'swapTokenToNative';
      swapParams = [
        srcAmount, // tokensSold
        destAmount, // minimumNativeOut
        getLocalDeadlineAsFriendlyPlaceholder(), // deadline
      ];
      targetExchange = srcToken; // Call directly on the token
    } else {
      throw new Error('Invalid direct swap pair');
    }

    const exchangeData = this.tokenIface.encodeFunctionData(
      swapFunction,
      swapParams,
    );

    return {
      needWrapNative: false,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange,
      returnAmountPos: undefined,
    };
  }

  private getRouterSwap(
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ApexDefiData,
  ): DexExchangeParam {
    const { path } = data;

    // ✅ Convert native AVAX to WAVAX for router calls, but leave ERC20 tokens as-is
    const routerPath = this.fixPathForRouter(
      path.map(p => p.tokenIn).concat(path[path.length - 1].tokenOut),
    );

    // ✅ Determine the correct swap function based on token types
    const isSrcAVAX = isETHAddress(path[0].tokenIn);
    const isDestAVAX = isETHAddress(path[path.length - 1].tokenOut);

    let swapFunction: string;
    let swapParams: any[];

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX -> Token
      swapFunction = 'swapExactAVAXForTokens';
      swapParams = [
        destAmount, // Keep original amount - router handles decimal conversion
        routerPath,
        recipient,
        getLocalDeadlineAsFriendlyPlaceholder(),
      ];
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token -> AVAX
      swapFunction = 'swapExactTokensForAVAX';
      swapParams = [
        srcAmount, // Keep original amount - router handles decimal conversion
        destAmount,
        routerPath,
        recipient,
        getLocalDeadlineAsFriendlyPlaceholder(),
      ];
    } else {
      // Token -> Token (cross-pair via AVAX)
      swapFunction = 'swapExactTokensForTokens';
      swapParams = [
        srcAmount, // Keep original amount - router handles decimal conversion
        destAmount,
        routerPath,
        recipient,
        getLocalDeadlineAsFriendlyPlaceholder(),
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
    // ✅ Handle wrapper operations
    if (data.swapType === 'wrapper') {
      return this.getWrapperSimpleParam(
        srcToken,
        destToken,
        srcAmount,
        destAmount,
        data,
      );
    }

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

    const targetExchange =
      ApexDefiConfig[this.dexKey][this.network].routerAddress;

    if (isSrcAVAX && !isDestAVAX) {
      // AVAX -> Token
      swapFunction = 'swapExactAVAXForTokens';
      swapParams = [
        destAmount,
        routerPath, // Use converted path
        targetExchange, // recipient - will be set by the router
        getLocalDeadlineAsFriendlyPlaceholder(), // deadline: 7 days from now
      ];
    } else if (!isSrcAVAX && isDestAVAX) {
      // Token -> AVAX
      swapFunction = 'swapExactTokensForAVAX';
      swapParams = [
        srcAmount,
        destAmount,
        routerPath, // Use converted path
        targetExchange, // recipient - will be set by the router
        getLocalDeadlineAsFriendlyPlaceholder(), // deadline: 7 days from now
      ];
    } else {
      // Token -> Token
      swapFunction = 'swapExactTokensForTokens';
      swapParams = [
        srcAmount,
        destAmount,
        routerPath, // Use converted path
        targetExchange, // recipient - will be set by the router
        getLocalDeadlineAsFriendlyPlaceholder(), // deadline: 7 days from now
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
      targetExchange,
      targetExchange,
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
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    try {
      const blockNumber =
        await this.dexHelper.web3Provider.eth.getBlockNumber();

      // Check if this token has a wrapper
      const tokenInfo = this.getERC314Token(tokenAddress);
      const hasWrapper = tokenInfo.address !== tokenAddress;

      // Use the underlying ERC314 token for pool lookups
      const tokenToCheck = hasWrapper ? tokenInfo.address : tokenAddress;

      // Check if the input token is AVAX
      const isAVAX = isETHAddress(tokenToCheck);

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
                [tokenToCheck], // Use underlying token
              ),
            },
            {
              target: tokenToCheck, // Use underlying token
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
            address: tokenAddress.toLowerCase(), // Return original token address
            poolIdentifier: this.getPoolIdentifier(tokenToCheck), // Use underlying token for pool ID
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
        this.logger,
      );

      // No pool data found, return null
      if (!poolData) {
        return null;
      }

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
          tradingEnabled: poolData.tradingEnabled,
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

    // Clean up wrapper factory
    if (this.wrapperFactory && this.wrapperFactory.releaseResources) {
      this.wrapperFactory.releaseResources();
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

      // Leave all other tokens as-is (including ERC20 tokens like USDC)
      return token;
    });
  }

  // Helper method to get ERC314 token for pricing/pools
  // Simplified getERC314Token method - always return ERC314 token for pricing
  private getERC314Token(tokenAddress: Address): Token {
    // if token is AVAX, return AVAX
    if (isETHAddress(tokenAddress)) {
      return {
        address: tokenAddress,
        decimals: 18,
      };
    }

    // PRIORITY 1: Check if this is an original token (ERC20) that has a wrapper
    const wrapperAddress =
      this.wrapperFactory.getWrapperByOriginalToken(tokenAddress);

    if (wrapperAddress) {
      const wrapperInfo = this.wrapperFactory.getWrapperInfo(wrapperAddress);

      if (wrapperInfo) {
        return {
          address: wrapperInfo.wrappedToken,
          decimals: wrapperInfo.wrappedTokenDecimals,
        };
      }
    }

    // PRIORITY 2: No wrapper found - this is a native ERC314 token (like APEX)
    return {
      address: tokenAddress,
      decimals: 18,
    };
  }

  // 2. Add decimal conversion helper methods
  private convertAmountToERC314(
    amount: bigint,
    fromDecimals: number,
    toDecimals: number,
  ): bigint {
    if (fromDecimals === toDecimals) return amount;

    if (fromDecimals > toDecimals) {
      return amount / 10n ** BigInt(fromDecimals - toDecimals);
    } else {
      return amount * 10n ** BigInt(toDecimals - fromDecimals);
    }
  }

  private convertAmountFromERC314(
    amount: bigint,
    fromDecimals: number,
    toDecimals: number,
  ): bigint {
    if (fromDecimals === toDecimals) return amount;

    if (fromDecimals > toDecimals) {
      return amount / 10n ** BigInt(fromDecimals - toDecimals);
    } else {
      return amount * 10n ** BigInt(toDecimals - fromDecimals);
    }
  }

  private convertAmountsToERC314(
    amounts: bigint[],
    fromDecimals: number,
  ): bigint[] {
    return amounts.map(amount => {
      if (amount === 0n) return 0n;
      return this.convertAmountToERC314(amount, fromDecimals, 18);
    });
  }

  private convertPricesFromERC314(
    prices: bigint[],
    toDecimals: number,
  ): bigint[] {
    return prices.map(price => {
      if (price === 0n) return 0n;
      return this.convertAmountFromERC314(price, 18, toDecimals);
    });
  }

  // ✅ Simplified wrapper detection using helper
  private isWrapperOperation(srcToken: Token, destToken: Token): boolean {
    return this.wrapperFactory.isWrapperOperation(
      srcToken.address,
      destToken.address,
    );
  }

  // ✅ Fixed wrapper prices to handle both SELL and BUY operations
  private getWrapperPrices(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
  ): ExchangePrices<ApexDefiData> {
    const wrapperPairInfo = this.wrapperFactory.getWrapperPairInfo(
      srcToken.address,
      destToken.address,
    );

    if (!wrapperPairInfo) {
      return [];
    }

    const { wrapperAddress, isWrap } = wrapperPairInfo;

    const prices = amounts.map(amount => {
      if (amount === 0n) return 0n;

      const isSell = side === SwapSide.SELL;
      const fromDecimals = isSell ? srcToken.decimals : destToken.decimals;
      const toDecimals = isSell ? destToken.decimals : srcToken.decimals;

      // For SELL: convert input to output
      // For BUY: convert desired output to required input
      return isWrap
        ? this.convertAmountToERC314(amount, fromDecimals, toDecimals)
        : this.convertAmountFromERC314(amount, fromDecimals, toDecimals);
    });

    const unit = getBigIntPow(
      side === SwapSide.SELL ? srcToken.decimals : destToken.decimals,
    );

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
          swapType: 'wrapper',
          wrapperAddress,
          isWrap,
        },
        exchange: this.dexKey,
        poolIdentifiers: [
          `${this.dexKey}_wrapper_${srcToken.address.toLowerCase()}`,
        ],
        gasCost: 100000,
        poolAddresses: [wrapperAddress],
      },
    ];
  }

  // ✅ Simplified wrapper swap
  private getWrapperSwap(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: ApexDefiData,
  ): DexExchangeParam {
    const { wrapperAddress, isWrap } = data;
    if (!wrapperAddress) throw new Error('Wrapper address not found');
    if (isWrap === undefined) throw new Error('isWrap not found in data');

    const swapFunction = isWrap ? 'wrap' : 'unwrap';
    const swapParams = [srcAmount];

    const exchangeData = this.wrapperIface.encodeFunctionData(
      swapFunction,
      swapParams,
    );

    return {
      needWrapNative: false,
      dexFuncHasRecipient: false,
      exchangeData,
      targetExchange: wrapperAddress,
      returnAmountPos: undefined,
    };
  }

  // ✅ Simplified wrapper simple param
  private async getWrapperSimpleParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: ApexDefiData,
  ): Promise<SimpleExchangeParam> {
    const { wrapperAddress, isWrap } = data;
    if (!wrapperAddress) throw new Error('Wrapper address not found');
    if (isWrap === undefined) throw new Error('isWrap not found in data');

    const swapFunction = isWrap ? 'wrap' : 'unwrap';
    const swapParams = [srcAmount];

    const swapData = this.wrapperIface.encodeFunctionData(
      swapFunction,
      swapParams,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      wrapperAddress,
      wrapperAddress,
      '0',
    );
  }
}
