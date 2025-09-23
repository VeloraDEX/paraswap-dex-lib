import {
  Token,
  Address,
  ExchangePrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
  PoolPrices,
  NumberAsString,
  DexExchangeParam,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import { getDexKeysWithNetwork, getBigIntPow } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  JarvisSwapFunctions,
  JarvisV6Data,
  JarvisV6Params,
  JarvisV6SystemMaxVars,
  PoolConfig,
  PoolState,
} from './types';
import JarvisV6PoolABI from '../../abi/jarvis/jarvis-v6-pool.json';
import { SimpleExchange } from '../simple-exchange';
import { JarvisV6Config, Adapters } from './config';
import { JarvisV6EventPool } from './jarvis-v6-events';
import {
  getJarvisPoolFromTokens,
  getJarvisSwapFunction,
  getOnChainState,
  THIRTY_MINUTES,
  convertToNewDecimals,
} from './utils';
import { Interface } from '@ethersproject/abi';
import { BI_POWS } from '../../bigint-constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { Contract } from 'web3-eth-contract';
import SynthereumPriceFeedABI from '../../abi/jarvis/SynthereumPriceFeed.json';

const POOL_CACHE_REFRESH_INTERVAL = 60 * 5; // 5 minutes

export class JarvisV6
  extends SimpleExchange
  implements IDex<JarvisV6Data, JarvisV6Params>
{
  protected eventPools: { [poolAddress: string]: JarvisV6EventPool };

  // opt out of pool allocation as dex allows for constant price swaps
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(JarvisV6Config);

  protected poolInterface: Interface = new Interface(JarvisV6PoolABI);
  protected priceFeedContract: Contract;

  logger: Logger;
  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
    protected adapters = Adapters[network],
    protected poolConfigs: PoolConfig[] = JarvisV6Config[dexKey][network].pools,
    protected priceFeedAddress: Address = JarvisV6Config[dexKey][network]
      .priceFeedAddress,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPools = {};

    this.priceFeedContract = new dexHelper.web3Provider.eth.Contract(
      SynthereumPriceFeedABI as any,
      priceFeedAddress,
    );

    poolConfigs.forEach(
      pool =>
        (this.eventPools[pool.address.toLowerCase()] = new JarvisV6EventPool(
          dexKey,
          network,
          dexHelper,
          this.logger,
          pool,
          this.priceFeedAddress,
          this.poolInterface,
          this.priceFeedContract,
        )),
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    const poolStates = await getOnChainState(
      this.dexHelper,
      this.poolConfigs,
      blockNumber,
      {
        poolInterface: this.poolInterface,
        priceFeedContract: this.priceFeedContract,
      },
    );

    await Promise.all(
      this.poolConfigs.map(async (pool, index) => {
        const eventPool = this.eventPools[pool.address.toLowerCase()];
        await eventPool.initialize(blockNumber, {
          state: poolStates[index],
        });
      }),
    );
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side];
  }

  getEventPool(srcToken: Token, destToken: Token): JarvisV6EventPool | null {
    const pool = getJarvisPoolFromTokens(srcToken, destToken, this.poolConfigs);
    return this.eventPools[pool?.address.toLowerCase()!];
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
    const eventPool = this.getEventPool(srcToken, destToken);
    if (!eventPool) return [];
    return [eventPool.getIdentifier()];
  }

  async getPoolState(
    pool: JarvisV6EventPool,
    blockNumber: number,
  ): Promise<PoolState> {
    const eventState = pool.getState(blockNumber);
    if (eventState) return eventState;
    const onChainState = await pool.generateState(blockNumber);
    pool.setState(onChainState, blockNumber);
    return onChainState;
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  // Pair
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[], // unusued since DEX is constant price, safe to reuse pools
  ): Promise<null | ExchangePrices<JarvisV6Data>> {
    if (side !== SwapSide.SELL) return null;

    const eventPool = this.getEventPool(srcToken, destToken);
    if (!eventPool) return null;

    const poolAddress = eventPool.poolConfig.address.toLowerCase();
    const poolIdentifier = eventPool.getIdentifier();

    const poolState = await this.getPoolState(eventPool, blockNumber);

    const unitVolume = getBigIntPow(srcToken.decimals);

    const swapFunction = getJarvisSwapFunction(srcToken, eventPool.poolConfig);
    const systemMaxVars = await this.getSystemMaxVars(poolAddress, blockNumber);

    const [unit, ...prices] = this.computePrices(
      [unitVolume, ...amounts],
      swapFunction,
      systemMaxVars,
      eventPool.poolConfig,
      poolState,
    );

    return [
      {
        prices,
        unit,
        data: {
          swapFunction,
          poolAddress,
        },
        poolAddresses: [poolAddress],
        exchange: this.dexKey,
        gasCost: 475 * 1000, //between 450-500k gas
        poolIdentifiers: [poolIdentifier],
      },
    ];
  }

  async getSystemMaxVars(
    poolAddress: Address,
    blockNumber: number,
  ): Promise<JarvisV6SystemMaxVars> {
    const cacheKey = `${this.dexKey}_systemMaxVars_${poolAddress}`;
    const cachedSystemMaxVars = await this.dexHelper.cache.getAndCacheLocally(
      this.dexKey,
      this.network,
      cacheKey,
      POOL_CACHE_REFRESH_INTERVAL,
    );

    if (cachedSystemMaxVars) {
      const { maxTokensCapacity, totalSyntheticTokens } =
        JSON.parse(cachedSystemMaxVars);

      return {
        maxTokensCapacity: BigInt(maxTokensCapacity),
        totalSyntheticTokens: BigInt(totalSyntheticTokens),
      };
    }

    const multiContract = this.dexHelper.multiContract;
    const encodedResp = (await multiContract.methods
      .aggregate([
        {
          target: poolAddress,
          callData: this.poolInterface.encodeFunctionData(
            'maxTokensCapacity',
            [],
          ),
        },
        {
          target: poolAddress,
          callData: this.poolInterface.encodeFunctionData(
            'totalSyntheticTokens',
            [],
          ),
        },
      ])
      .call({}, blockNumber)) as { returnData: [string, string] };

    const maxTokensCapacity = this.poolInterface
      .decodeFunctionResult('maxTokensCapacity', encodedResp.returnData[0])[0]
      .toString();
    const totalSyntheticTokens = this.poolInterface
      .decodeFunctionResult(
        'totalSyntheticTokens',
        encodedResp.returnData[1],
      )[0]
      .toString();

    const systemMaxVarStr = JSON.stringify({
      maxTokensCapacity,
      totalSyntheticTokens,
    });
    this.dexHelper.cache.setexAndCacheLocally(
      this.dexKey,
      this.network,
      cacheKey,
      POOL_CACHE_REFRESH_INTERVAL,
      systemMaxVarStr,
    );

    return {
      maxTokensCapacity: BigInt(maxTokensCapacity),
      totalSyntheticTokens: BigInt(totalSyntheticTokens),
    };
  }

  computePrices(
    amounts: bigint[],
    swapFunction: JarvisSwapFunctions,
    { maxTokensCapacity, totalSyntheticTokens }: JarvisV6SystemMaxVars,
    pool: PoolConfig,
    poolState: PoolState,
  ): bigint[] {
    return amounts.map(amount => {
      if (swapFunction === JarvisSwapFunctions.MINT) {
        return this.computePriceForMint(
          amount,
          maxTokensCapacity,
          poolState,
          pool.collateralToken.decimals,
        );
      }
      if (swapFunction === JarvisSwapFunctions.REDEEM) {
        if (amount > totalSyntheticTokens) return 0n;

        return this.computePriceForRedeem(
          amount,
          poolState,
          pool.collateralToken.decimals,
        );
      }
      return 0n;
    });
  }

  computePriceForMint(
    amount: bigint,
    maxTokensCapacity: bigint,
    poolState: PoolState,
    collateralDecimalsNumber: number,
  ) {
    const feePercentage = poolState.pool.feesPercentage;
    const UsdcPriceFeed = poolState.priceFeed.usdcPrice;
    const syntheticAmount = this.getSyntheticAmountToReceive(
      amount,
      collateralDecimalsNumber,
      UsdcPriceFeed,
      feePercentage,
    );
    return syntheticAmount <= maxTokensCapacity ? syntheticAmount : 0n;
  }

  computePriceForRedeem(
    amount: bigint,
    poolState: PoolState,
    collateralDecimalsNumber: number,
  ) {
    const feePercentage = poolState.pool.feesPercentage;
    const UsdcPriceFeed = poolState.priceFeed.usdcPrice;
    return this.getCollateralAmountToReceive(
      amount,
      collateralDecimalsNumber,
      UsdcPriceFeed,
      feePercentage,
    );
  }

  getSyntheticAmountToReceive(
    collateralAmount: bigint,
    collateralDecimals: number,
    UsdcPriceFeed: bigint,
    feePercentage: bigint,
  ) {
    let collateralAmountIn18Decimals = convertToNewDecimals(
      collateralAmount,
      collateralDecimals,
      18,
    );
    return (
      ((collateralAmountIn18Decimals -
        (collateralAmountIn18Decimals * feePercentage) / BI_POWS[18]) *
        BI_POWS[18]) /
      UsdcPriceFeed
    );
  }

  getCollateralAmountToReceive(
    syntheticAmount: bigint,
    collateralDecimals: number,
    UsdcPriceFeed: bigint,
    feePercentage: bigint,
  ) {
    const result =
      (syntheticAmount * UsdcPriceFeed) / BI_POWS[18] -
      (((syntheticAmount * UsdcPriceFeed) / BI_POWS[18]) * feePercentage) /
        BI_POWS[18];
    if (collateralDecimals === 18) return result;
    return convertToNewDecimals(result, 18, collateralDecimals);
  }

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: JarvisV6Data,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { swapFunction } = data;
    const type = [JarvisSwapFunctions.MINT, JarvisSwapFunctions.REDEEM].indexOf(
      swapFunction,
    );

    if (type === undefined) {
      throw new Error(
        `Jarvis: Invalid OpType ${swapFunction}, Should be one of ['mint', 'redeem']`,
      );
    }

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          opType: 'uint',
          expiration: 'uint128',
        },
      },
      {
        opType: type,
        expiration: (Date.now() / 1000 + THIRTY_MINUTES).toFixed(0),
      },
    );

    return {
      targetExchange: data.poolAddress.toLowerCase(),
      payload,
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
    data: JarvisV6Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { swapFunction } = data;
    const timestamp = (Date.now() / 1000 + THIRTY_MINUTES).toFixed(0);

    let swapFunctionParams: JarvisV6Params;
    switch (swapFunction) {
      case JarvisSwapFunctions.MINT:
        swapFunctionParams = ['1', srcAmount, timestamp, this.augustusAddress];
        break;
      case JarvisSwapFunctions.REDEEM:
        swapFunctionParams = [srcAmount, '1', timestamp, this.augustusAddress];
        break;
      default:
        throw new Error(`Unknown function ${swapFunction}`);
    }
    const swapData = this.poolInterface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      data.poolAddress.toLowerCase(),
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: JarvisV6Data,
    side: SwapSide,
  ): DexExchangeParam {
    const { swapFunction } = data;
    const timestamp = (Date.now() / 1000 + THIRTY_MINUTES).toFixed(0);

    let swapFunctionParams: JarvisV6Params;
    switch (swapFunction) {
      case JarvisSwapFunctions.MINT:
        swapFunctionParams = ['1', srcAmount, timestamp, recipient];
        break;
      case JarvisSwapFunctions.REDEEM:
        swapFunctionParams = [srcAmount, '1', timestamp, recipient];
        break;
      default:
        throw new Error(`Unknown function ${swapFunction}`);
    }
    const exchangeData = this.poolInterface.encodeFunctionData(swapFunction, [
      swapFunctionParams,
    ]);

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData,
      targetExchange: data.poolAddress.toLowerCase(),
      returnAmountPos: undefined,
    };
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    return [];
  }

  getCalldataGasCost(poolPrices: PoolPrices<JarvisV6Data>): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // opType
      CALLDATA_GAS_COST.INDEX +
      // expiration
      CALLDATA_GAS_COST.TIMESTAMP
    );
  }
}
