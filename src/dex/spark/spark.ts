import { SimpleExchange } from '../simple-exchange';
import { Context, IDex } from '../idex';
import { SparkParams, SparkData, SparkSDaiPoolState } from './types';
import { Network, SwapSide, UNLIMITED_USD_LIQUIDITY } from '../../constants';
import { getDexKeysWithNetwork } from '../../utils';
import { Adapters, SDaiConfig } from './config';
import {
  AdapterExchangeParam,
  Address,
  DexExchangeParam,
  ExchangePrices,
  Logger,
  NumberAsString,
  PoolLiquidity,
  PoolPrices,
  SimpleExchangeParam,
  Token,
} from '../../types';
import { IDexHelper } from '../../dex-helper';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { Interface } from 'ethers/lib/utils';
import { calcChi, RAY, SparkSDaiEventPool } from './spark-sdai-pool';
import { BI_POWS } from '../../bigint-constants';
import { SDAI_DEPOSIT_GAS_COST } from './constants';
import { extractReturnAmountPosition } from '../../executor/utils';

export class Spark
  extends SimpleExchange
  implements IDex<SparkData, SparkParams>
{
  readonly hasConstantPriceLargeAmounts = true;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(SDaiConfig);

  public readonly eventPool: SparkSDaiEventPool;
  logger: Logger;

  constructor(
    protected network: Network,
    dexKey: string,
    readonly dexHelper: IDexHelper,
    protected readonly config = SDaiConfig[dexKey][network],
    readonly daiAddress: string = SDaiConfig[dexKey][network].daiAddress,
    readonly sdaiAddress: string = SDaiConfig[dexKey][network].sdaiAddress,
    readonly potAddress: string = SDaiConfig[dexKey][network].potAddress,
    readonly abiInterface: Interface = SDaiConfig[dexKey][network]
      .poolInterface,

    protected adapters = Adapters[network] || {},
    protected sdaiInterface = SDaiConfig[dexKey][network].exchangeInterface,
    protected swapFunctions = SDaiConfig[dexKey][network].swapFunctions,
    protected referralCode = SDaiConfig[dexKey][network].referralCode,
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.eventPool = new SparkSDaiEventPool(
      this.dexKey,
      this.network,
      `${this.daiAddress}_${this.sdaiAddress}`,
      dexHelper,
      this.potAddress,
      this.abiInterface,
      this.logger,
      config.savingsRate.topic,
      config.savingsRate.symbol,
    );
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] || null;
  }

  isSDai(tokenAddress: Address) {
    return this.sdaiAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isDai(tokenAddress: Address) {
    return this.daiAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isAppropriatePair(srcToken: Token, destToken: Token) {
    return (
      (this.isDai(srcToken.address) && this.isSDai(destToken.address)) ||
      (this.isDai(destToken.address) && this.isSDai(srcToken.address))
    );
  }

  async initializePricing(blockNumber: number) {
    await this.eventPool.initialize(blockNumber);
  }

  getPoolIdentifier(): string {
    return `${this.dexKey}_${this.sdaiAddress}`;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (!this.isAppropriatePair(srcToken, destToken)) {
      return [];
    }

    return [this.getPoolIdentifier()];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<SparkData>> {
    if (!this.isAppropriatePair(srcToken, destToken)) return null;
    const state = await this.eventPool.getOrGenerateState(blockNumber);
    if (!state) return null;

    const isSrcAsset = this.isDai(srcToken.address);

    let calcFunction: Function;

    if (side === SwapSide.SELL) {
      if (isSrcAsset) {
        calcFunction = this.previewDeposit.bind(this);
      } else {
        calcFunction = this.previewRedeem.bind(this);
      }
    } else {
      if (isSrcAsset) {
        calcFunction = this.previewMint.bind(this);
      } else {
        calcFunction = this.previewWithdraw.bind(this);
      }
    }

    return [
      {
        // cannot produce 1:1 price without making an rpc call for block.timestamp and using it for price calculation in `calcChi` function
        prices: amounts.map(amount => calcFunction(amount, state)),
        unit: BI_POWS[18],
        gasCost: SDAI_DEPOSIT_GAS_COST,
        exchange: this.dexKey,
        data: { exchange: `${this.sdaiAddress}` },
        poolAddresses: [`${this.sdaiAddress}`],
        poolIdentifiers: [this.getPoolIdentifier()],
      },
    ];
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<SparkData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    const token = tokenAddress.toLowerCase();

    const isDai = this.isDai(token);
    const isSDai = this.isSDai(token);

    if (!isDai && !isSDai) return [];

    return [
      {
        exchange: this.dexKey,
        address: this.sdaiAddress,
        connectorTokens: [
          {
            decimals: 18,
            address: isSDai ? this.daiAddress : this.sdaiAddress,
          },
        ],
        liquidityUSD: UNLIMITED_USD_LIQUIDITY,
      },
    ];
  }

  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SparkData,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;
    if (this.isDai(srcToken)) {
      const calldata = [isSell ? srcAmount : destAmount, this.augustusAddress];

      if (this.referralCode) {
        calldata.push(this.referralCode);
      }

      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? this.swapFunctions.deposit : this.swapFunctions.mint,
        calldata,
      );
    } else {
      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? this.swapFunctions.redeem : this.swapFunctions.withdraw,
        [
          isSell ? srcAmount : destAmount,
          this.augustusAddress,
          this.augustusAddress,
        ],
      );
    }

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      exchange,
      undefined,
      undefined,
      undefined,
      isSell && this.isDai(destToken),
    );
  }

  getDexParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    recipient: Address,
    data: SparkData,
    side: SwapSide,
    _: Context,
    executorAddress: Address,
  ): DexExchangeParam {
    const isSell = side === SwapSide.SELL;
    const { exchange } = data;

    let swapData: string;

    if (this.isDai(srcToken)) {
      const calldata = [isSell ? srcAmount : destAmount, recipient];

      if (this.referralCode) {
        calldata.push(this.referralCode);
      }

      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? this.swapFunctions.deposit : this.swapFunctions.mint,
        calldata,
      );
    } else {
      swapData = this.sdaiInterface.encodeFunctionData(
        isSell ? this.swapFunctions.redeem : this.swapFunctions.withdraw,
        [isSell ? srcAmount : destAmount, recipient, executorAddress],
      );
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: exchange,
      returnAmountPos: isSell
        ? extractReturnAmountPosition(
            this.sdaiInterface,
            this.isDai(srcToken)
              ? this.swapFunctions.deposit
              : this.swapFunctions.redeem,
            this.isDai(srcToken) ? 'shares' : 'assets',
          )
        : undefined,
      skipApproval: isSell && this.isDai(destToken),
    };
  }

  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: SparkData,
    side: SwapSide,
  ): AdapterExchangeParam {
    const { exchange } = data;

    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          toStaked: 'bool',
        },
      },
      {
        toStaked: this.isDai(srcToken),
      },
    );

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  previewRedeem(shares: bigint, state: SparkSDaiPoolState) {
    return (shares * calcChi(state)) / RAY;
  }

  previewMint(shares: bigint, state: SparkSDaiPoolState) {
    return this.divUp(shares * calcChi(state), RAY);
  }

  previewWithdraw(assets: bigint, state: SparkSDaiPoolState) {
    return this.divUp(assets * RAY, calcChi(state));
  }

  previewDeposit(assets: bigint, state: SparkSDaiPoolState) {
    return (assets * RAY) / calcChi(state);
  }

  divUp(x: bigint, y: bigint): bigint {
    return x !== 0n ? (x - 1n) / y + 1n : 0n;
  }
}
