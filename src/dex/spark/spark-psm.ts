import { Spark } from './spark';
import { Address, NumberAsString } from '@paraswap/core';
import {
  SparkData,
  SparkParams,
  SparkSDaiPoolState,
  SparkSUSDSPsmFunctions,
} from './types';
import { SwapSide } from '@paraswap/core/build/constants';
import { Context } from '../idex';
import {
  ConnectorToken,
  DexConfigMap,
  DexExchangeParam,
  ExchangePrices,
  PoolLiquidity,
  Token,
} from '../../types';
import { Network, UNLIMITED_USD_LIQUIDITY } from '../../constants';
import { getDexKeysWithNetwork } from '../../utils';
import { Interface } from '@ethersproject/abi';
import SSRAuthOracleAbi from '../../abi/sdai/SSRAuthOracle.abi.json';
import SparkPSM3Abi from '../../abi/sdai/PSM3.abi.json';
import { IDexHelper } from '../../dex-helper';
import { Adapters } from './config';
import { extractReturnAmountPosition } from '../../executor/utils';
import { BI_POWS } from '../../bigint-constants';
import { SDAI_DEPOSIT_GAS_COST } from './constants';

export const sUSDSPsmConfig: DexConfigMap<SparkParams> = {
  SparkPsm: {
    [Network.ARBITRUM]: {
      sdaiAddress: '0xdDb46999F8891663a8F2828d25298f70416d7610', // sUSDS
      sdaiDecimals: 18,
      daiAddress: '0x6491c05A82219b8D1479057361ff1654749b876b', // USDS
      daiDecimals: 18,
      usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
      usdcDecimals: 6,
      potAddress: '0xEE2816c1E1eed14d444552654Ed3027abC033A36', // SSRAuthOracle contract address
      psmAddress: '0x2B05F8e1cACC6974fD79A673a341Fe1f58d27266', // PSM contract address
      savingsRate: {
        symbol: 'ssrOracle',
        topic:
          '0xc234856e2a0c5b406365714ced016892e7d98f7b1d49982cdd8db416a586d811', // SetSUSDSData event
      },
      poolInterface: new Interface(SSRAuthOracleAbi),
      exchangeInterface: new Interface(SparkPSM3Abi),
      swapFunctions: SparkSUSDSPsmFunctions,
      referralCode: '1004',
    },
    [Network.BASE]: {
      sdaiAddress: '0x5875eEE11Cf8398102FdAd704C9E96607675467a', // sUSDS
      sdaiDecimals: 18,
      daiAddress: '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', // USDS
      daiDecimals: 18,
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      usdcDecimals: 6,
      potAddress: '0x65d946e533748A998B1f0E430803e39A6388f7a1', // SSRAuthOracle contract address
      psmAddress: '0x1601843c5E9bC251A3272907010AFa41Fa18347E', // PSM contract address
      savingsRate: {
        symbol: 'ssrOracle',
        topic:
          '0xc234856e2a0c5b406365714ced016892e7d98f7b1d49982cdd8db416a586d811', // SetSUSDSData event
      },
      poolInterface: new Interface(SSRAuthOracleAbi),
      exchangeInterface: new Interface(SparkPSM3Abi),
      swapFunctions: SparkSUSDSPsmFunctions,
      referralCode: '1004',
    },
  },
};

export class SparkPsm extends Spark {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(sUSDSPsmConfig);

  protected readonly usdcAddress: string;
  protected readonly daiPrecision: bigint;
  protected readonly sDaiPrecision: bigint;
  protected readonly usdcPrecision: bigint;

  constructor(
    protected network: Network,
    dexKey: string,
    readonly dexHelper: IDexHelper,
    protected readonly config = sUSDSPsmConfig[dexKey][network],
    readonly daiAddress: string = sUSDSPsmConfig[dexKey][network].daiAddress,
    readonly sdaiAddress: string = sUSDSPsmConfig[dexKey][network].sdaiAddress,
    readonly potAddress: string = sUSDSPsmConfig[dexKey][network].potAddress,
    readonly abiInterface: Interface = sUSDSPsmConfig[dexKey][network]
      .poolInterface,

    protected adapters = Adapters[network] || {},
    protected sdaiInterface = sUSDSPsmConfig[dexKey][network].exchangeInterface,
    protected swapFunctions = sUSDSPsmConfig[dexKey][network].swapFunctions,
    protected referralCode = sUSDSPsmConfig[dexKey][network].referralCode,
  ) {
    super(
      network,
      dexKey,
      dexHelper,
      config,
      daiAddress,
      sdaiAddress,
      potAddress,
      abiInterface,
      adapters,
      sdaiInterface,
      swapFunctions,
      referralCode,
    );

    this.usdcAddress = config.usdcAddress!;
    this.daiPrecision = 10n ** BigInt(config.daiDecimals!);
    this.sDaiPrecision = 10n ** BigInt(config.sdaiDecimals!);
    this.usdcPrecision = 10n ** BigInt(config.usdcDecimals!);
  }

  isUSDC(tokenAddress: Address) {
    return this.usdcAddress.toLowerCase() === tokenAddress.toLowerCase();
  }

  isAppropriateTokenAddress(tokenAddress: string): boolean {
    const supportedTokens = [
      this.daiAddress.toLowerCase(),
      this.usdcAddress.toLowerCase(),
      this.sdaiAddress.toLowerCase(),
    ];

    return supportedTokens.indexOf(tokenAddress.toLowerCase()) > -1;
  }

  isAppropriatePair(srcToken: Token, destToken: Token): boolean {
    if (srcToken.address.toLowerCase() === destToken.address.toLowerCase()) {
      return false;
    }

    return (
      this.isAppropriateTokenAddress(srcToken.address) &&
      this.isAppropriateTokenAddress(destToken.address)
    );
  }

  convertOneToOne(assetPrecision: bigint, convertAssetPrecision: bigint) {
    return (assets: bigint): bigint => {
      return (assets * convertAssetPrecision + assetPrecision) / assetPrecision;
    };
  }

  previewSell(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    state: SparkSDaiPoolState,
  ): bigint[] {
    let calcFunction: Function;

    const isDaiSrcAsset = this.isDai(srcToken.address);
    const isUSDCToUSDS =
      this.isUSDC(srcToken.address) && this.isDai(destToken.address);

    const isUSDSToUSDC =
      this.isDai(srcToken.address) && this.isUSDC(destToken.address);

    const isUSDCSrcAsset = this.isUSDC(srcToken.address);
    const isUSDCDestAsset = this.isUSDC(destToken.address);

    if (isUSDCToUSDS) {
      calcFunction = this.convertOneToOne(
        this.usdcPrecision,
        this.daiPrecision,
      ).bind(this);
    } else if (isUSDSToUSDC) {
      calcFunction = this.convertOneToOne(
        this.daiPrecision,
        this.usdcPrecision,
      ).bind(this);
    } else if (isDaiSrcAsset) {
      calcFunction = this.previewDeposit.bind(this);
    } else {
      if (isUSDCSrcAsset) {
        calcFunction = (assets: bigint, state: SparkSDaiPoolState) => {
          const res = this.previewDeposit(assets, state);
          return (res * this.sDaiPrecision) / this.usdcPrecision;
        };
      } else if (isUSDCDestAsset) {
        calcFunction = (assets: bigint, state: SparkSDaiPoolState) => {
          const res = this.previewRedeem(assets, state);
          return (res * this.usdcPrecision) / this.sDaiPrecision;
        };
      } else {
        calcFunction = this.previewRedeem.bind(this);
      }
    }

    return amounts.map(amount => calcFunction(amount, state));
  }

  previewBuy(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    state: SparkSDaiPoolState,
  ): bigint[] {
    let calcFunction: Function;

    const isDaiSrcAsset = this.isDai(srcToken.address);
    const isUSDCToUSDS =
      this.isUSDC(srcToken.address) && this.isDai(destToken.address);

    const isUSDSToUSDC =
      this.isDai(srcToken.address) && this.isUSDC(destToken.address);

    const isUSDCSrcAsset = this.isUSDC(srcToken.address);
    const isUSDCDestAsset = this.isUSDC(destToken.address);

    if (isUSDCToUSDS) {
      calcFunction = this.convertOneToOne(
        this.daiPrecision,
        this.usdcPrecision,
      ).bind(this);
    } else if (isUSDSToUSDC) {
      calcFunction = this.convertOneToOne(
        this.usdcPrecision,
        this.daiPrecision,
      ).bind(this);
    } else if (isDaiSrcAsset) {
      calcFunction = this.previewMint.bind(this);
    } else {
      if (isUSDCSrcAsset) {
        calcFunction = (assets: bigint, state: SparkSDaiPoolState) => {
          const res = this.previewMint(assets, state);
          return (res * this.usdcPrecision) / this.sDaiPrecision;
        };
      } else if (isUSDCDestAsset) {
        calcFunction = (assets: bigint, state: SparkSDaiPoolState) => {
          const res = this.previewWithdraw(assets, state);
          return (res * this.sDaiPrecision) / this.usdcPrecision;
        };
      } else {
        calcFunction = this.previewWithdraw.bind(this);
      }
    }

    return amounts.map(amount => calcFunction(amount, state));
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

    let results: bigint[];
    if (side === SwapSide.SELL) {
      results = this.previewSell(srcToken, destToken, amounts, state);
    } else {
      results = this.previewBuy(srcToken, destToken, amounts, state);
    }

    return [
      {
        // cannot produce 1:1 price without making an rpc call for block.timestamp and using it for price calculation in `calcChi` function
        prices: results,
        unit: BI_POWS[18],
        gasCost: SDAI_DEPOSIT_GAS_COST,
        exchange: this.dexKey,
        data: { exchange: `${this.sdaiAddress}` },
        poolAddresses: [`${this.sdaiAddress}`],
      },
    ];
  }

  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    if (!this.isAppropriateTokenAddress(tokenAddress)) return [];

    const connectors = [
      {
        decimals: this.config.daiDecimals,
        address: this.daiAddress,
      },
      {
        decimals: this.config.sdaiDecimals,
        address: this.sdaiAddress,
      },
      {
        decimals: this.config.usdcDecimals,
        address: this.usdcAddress,
      },
    ] as ConnectorToken[];

    const allPossiblePools = connectors.map(connector => ({
      exchange: this.dexKey,
      address: this.config.psmAddress!,
      connectorTokens: [{ ...connector }],
      liquidityUSD: UNLIMITED_USD_LIQUIDITY,
    }));

    return allPossiblePools.filter(pool => {
      const token = pool.connectorTokens[0];
      return token.address.toLowerCase() !== tokenAddress.toLowerCase();
    });
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
    let swapData: string;

    if (isSell) {
      swapData = this.sdaiInterface.encodeFunctionData('swapExactIn', [
        srcToken,
        destToken,
        srcAmount,
        destAmount,
        recipient,
        this.config.referralCode,
      ]);
    } else {
      swapData = this.sdaiInterface.encodeFunctionData('swapExactOut', [
        srcToken,
        destToken,
        destAmount,
        srcAmount,
        recipient,
        this.config.referralCode,
      ]);
    }

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: true,
      exchangeData: swapData,
      targetExchange: this.config.psmAddress!,
      returnAmountPos: isSell
        ? extractReturnAmountPosition(
            this.sdaiInterface,
            'swapExactIn',
            'amountOut',
          )
        : undefined,
    };
  }
}
