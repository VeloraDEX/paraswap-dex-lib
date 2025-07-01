import { Interface, JsonFragment, AbiCoder } from '@ethersproject/abi';
import { NumberAsString } from '@paraswap/core';
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
import {
  SwapSide,
  Network,
  ETHER_ADDRESS,
  NULL_ADDRESS,
} from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import _ from 'lodash';
import { getDexKeysWithNetwork, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { KelpData, lrtDepositPoolFunctions, wstETHFunctions } from './types';
import { SimpleExchange } from '../simple-exchange';
import { KelpConfig } from './config';
import { KelpEventPool } from './kelp-pool';
import { WethFunctions } from '../weth/types';
import ERC20ABI from '../../abi/erc20.json';
import wstEthAbi from '../../abi/wstETH.json';
import lrtDepositPoolAbi from '../../abi/kelp/LRTDepositPool.json';
import { Contract } from 'web3-eth-contract';
import lrtOracleAbi from '../../abi/kelp/LRTOracle.json';
import { BI_POWS } from '../../bigint-constants';
import { AsyncOrSync } from 'ts-essentials';

export class Kelp extends SimpleExchange implements IDex<KelpData> {
  static dexKeys = ['Kelp'];
  protected kelpPool: KelpEventPool;

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;

  readonly isFeeOnTransferSupported = false;

  erc20Interface: Interface;
  wstEthInterface: Interface;
  lrtDepositPoolInterface: Interface;
  lrtDepositPoolAddress: Address;
  rsETHAddress: Address;
  wethAddress: Address;
  stETHAddress: Address;
  wstETHAddress: Address;
  ETHxAddress: Address;

  referralId = '';
  logger: Logger;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(_.pick(KelpConfig, ['Kelp']));

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected config = KelpConfig[dexKey][network],
  ) {
    super(dexHelper, dexKey);
    this.network = dexHelper.config.data.network;
    this.ETHxAddress = this.config.ETHx.toLowerCase();
    this.rsETHAddress = this.config.rsETH.toLowerCase();
    this.wethAddress = this.config.weth.toLowerCase();
    this.stETHAddress = this.config.stETH.toLowerCase();
    this.wstETHAddress = this.config.wstETH.toLowerCase();
    this.erc20Interface = new Interface(ERC20ABI as JsonFragment[]);
    this.wstEthInterface = new Interface(wstEthAbi as JsonFragment[]);
    this.lrtDepositPoolInterface = new Interface(
      lrtDepositPoolAbi as JsonFragment[],
    );
    this.lrtDepositPoolAddress = this.config.lrtDepositPool.toLowerCase();
    this.logger = dexHelper.getLogger(dexKey);
    this.kelpPool = new KelpEventPool(
      dexKey,
      network,
      dexHelper,
      this.logger,
      this.config.lrtOracle.toLowerCase(),
      new Interface(lrtOracleAbi as JsonFragment[]),
    );
  }

  getAdapterParam(
    srcToken: Address,
    destToken: Address,
    srcAmount: NumberAsString,
    destAmount: NumberAsString,
    data: KelpData,
    side: SwapSide,
  ): AdapterExchangeParam {
    return {
      targetExchange: NULL_ADDRESS,
      payload: '0x',
      networkFee: '0',
    };
  }

  async initializePricing(blockNumber: number) {
    await this.kelpPool.initialize(blockNumber);
  }

  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    if (side === SwapSide.BUY) return [];

    if (!this.isEligibleSwap(srcToken, destToken)) return [];

    return [`${this.dexKey}_${this.lrtDepositPoolAddress}`];
  }

  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<KelpData>> {
    if (side === SwapSide.BUY) return null;
    if (!this.isEligibleSwap(srcToken, destToken)) return null;

    const pool = this.kelpPool;
    if (!pool.getState(blockNumber)) return null;

    const unitIn = BI_POWS[18];
    const unitOut = pool.getPrice(blockNumber, unitIn);

    const amountsOutPromises = amounts.map(amountIn =>
      this.getRsETHAmountToMint(
        this.dexHelper.multiContract,
        srcToken.address,
        amountIn,
      ),
    );
    const amountsOut = await Promise.all(amountsOutPromises);

    return [
      {
        // @ts-ignore
        prices: amountsOut,
        unit: unitOut,
        data: {},
        exchange: this.dexKey,
        poolIdentifier:
          `${srcToken.address}_${destToken.address}`.toLowerCase(),
        gasCost: 850_000,
        poolAddresses: [destToken.address],
      },
    ];
  }

  async getDexParam(
    srcToken: Address,
    _destToken: Address,
    srcAmount: NumberAsString,
    _destAmount: NumberAsString,
    _recipient: Address,
    _data: KelpData,
    _side: SwapSide,
  ): Promise<DexExchangeParam> {
    if (_side === SwapSide.BUY) throw new Error(`Buy not supported`);

    const actualSrcToken = await this.getActualSrcToken(srcToken);
    const actualSrcAmount = await this.getActualSrcAmount(
      srcToken,
      BigInt(srcAmount),
    );

    const minRSETHAmountExpected = await this.getRsETHAmountToMint(
      this.dexHelper.multiContract,
      actualSrcToken,
      actualSrcAmount,
    );

    const swapData =
      isETHAddress(srcToken) || this.isWETH(srcToken)
        ? this.lrtDepositPoolInterface.encodeFunctionData(
            lrtDepositPoolFunctions.depositETH,
            [minRSETHAmountExpected, this.referralId],
          )
        : this.lrtDepositPoolInterface.encodeFunctionData(
            lrtDepositPoolFunctions.depositAsset,
            [
              actualSrcToken,
              actualSrcAmount,
              minRSETHAmountExpected,
              this.referralId,
            ],
          );

    return {
      needWrapNative: this.needWrapNative,
      dexFuncHasRecipient: false,
      exchangeData: swapData,
      targetExchange: this.lrtDepositPoolAddress.toLowerCase(),
      preSwapUnwrapCalldata: this.isWETH(srcToken)
        ? this.erc20Interface.encodeFunctionData(WethFunctions.withdraw, [
            srcAmount,
          ])
        : this.isWstETH(srcToken)
        ? this.wstEthInterface.encodeFunctionData(wstETHFunctions.unwrap, [
            srcAmount,
          ])
        : undefined,
      returnAmountPos: undefined,
    };
  }

  async updatePoolState(): Promise<void> {
    return Promise.resolve();
  }

  getCalldataGasCost(poolPrices: PoolPrices<KelpData>): number | number[] {
    return CALLDATA_GAS_COST.DEX_NO_PAYLOAD;
  }

  getTopPoolsForToken(
    tokenAddress: string,
    limit: number,
  ): AsyncOrSync<PoolLiquidity[]> {
    if (this.isSupportedAsset(tokenAddress.toLowerCase())) {
      return [
        {
          exchange: this.dexKey,
          address: this.config.rsETH,
          connectorTokens: [
            {
              address: this.config.rsETH,
              decimals: 18,
            },
          ],
          liquidityUSD: 1000000000,
        },
      ];
    }

    if (tokenAddress.toLowerCase() === this.rsETHAddress.toLowerCase()) {
      const eth = ETHER_ADDRESS;
      const weth = this.wethAddress;
      const stETH = this.stETHAddress;
      const wstETH = this.wstETHAddress;
      const ETHx = this.ETHxAddress;

      return [eth, weth, stETH, wstETH, ETHx].map(t => ({
        exchange: this.dexKey,
        address: this.config.rsETH,
        connectorTokens: [{ address: t, decimals: 18 }],
        liquidityUSD: 1000000000,
      }));
    }

    return [];
  }

  isEligibleSwap(srcToken: Token | string, destToken: Token | string): boolean {
    const srcTokenAddress = (
      typeof srcToken === 'string' ? srcToken : srcToken.address
    ).toLowerCase();
    const destTokenAddress = (
      typeof destToken === 'string' ? destToken : destToken.address
    ).toLowerCase();

    return (
      this.isSupportedAsset(srcTokenAddress) &&
      destTokenAddress === this.rsETHAddress
    );
  }

  isWETH(tokenAddress: string) {
    return tokenAddress.toLowerCase() === this.wethAddress;
  }

  isStETH(tokenAddress: string) {
    return tokenAddress.toLowerCase() === this.stETHAddress;
  }

  isWstETH(tokenAddress: string) {
    return tokenAddress.toLowerCase() === this.wstETHAddress;
  }

  isETHx(tokenAddress: string) {
    return tokenAddress.toLowerCase() === this.ETHxAddress;
  }

  isSupportedAsset(tokenAddress: string) {
    const formattedTokenAddress = tokenAddress.toLowerCase();

    return (
      isETHAddress(formattedTokenAddress) ||
      this.isWETH(formattedTokenAddress) ||
      this.isStETH(formattedTokenAddress) ||
      this.isWstETH(formattedTokenAddress) ||
      this.isETHx(formattedTokenAddress)
    );
  }

  async getActualSrcToken(srcToken: Address): Promise<Address> {
    return this.isWETH(srcToken)
      ? ETHER_ADDRESS
      : this.isWstETH(srcToken)
      ? this.stETHAddress
      : srcToken;
  }

  async getActualSrcAmount(
    srcToken: Address,
    srcAmount: bigint,
  ): Promise<bigint> {
    return this.isWstETH(srcToken)
      ? await this.getStETHByWstETH(this.dexHelper.multiContract, srcAmount)
      : srcAmount;
  }

  async getRsETHAmountToMint(
    multiContract: Contract,
    srcToken: Address,
    srcAmount: bigint,
  ): Promise<bigint> {
    const actualSrcToken = await this.getActualSrcToken(srcToken);
    const actualSrcAmount = await this.getActualSrcAmount(srcToken, srcAmount);

    const data: { returnData: any[] } = await multiContract.methods
      .aggregate([
        {
          target: this.lrtDepositPoolAddress,
          callData: this.lrtDepositPoolInterface.encodeFunctionData(
            lrtDepositPoolFunctions.getRsETHAmountToMint,
            [actualSrcToken, actualSrcAmount],
          ),
        },
      ])
      .call();

    const coder = new AbiCoder();
    const decodedData = coder.decode(['uint256'], data.returnData[0]);

    return BigInt(decodedData[0].toString());
  }

  async getStETHByWstETH(
    multiContract: Contract,
    amount: bigint,
  ): Promise<bigint> {
    const data: { returnData: any[] } = await multiContract.methods
      .aggregate([
        {
          target: this.wstETHAddress,
          callData: this.wstEthInterface.encodeFunctionData(
            wstETHFunctions.getStETHByWstETH,
            [amount],
          ),
        },
      ])
      .call();

    const coder = new AbiCoder();
    const decodedData = coder.decode(['uint256'], data.returnData[0]);

    return BigInt(decodedData[0].toString());
  }
}
